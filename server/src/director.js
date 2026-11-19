import { query } from './db.js';
import { getSettings } from './settings.js';
import { pickCandidates, fallbackSongs, localClock, inTimeRange } from './context.js';

const RETRY_MS = 30_000;
const pub = s => (s ? { id: s.id, title: s.title, artist: s.artist, provider: s.provider || 'youtube' } : null);
const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

export class Director {
  constructor(io) {
    this.io = io;
    this.phase = 'idle';
    this.paused = false;
    this.pendingAdvance = false;
    this.nowPlaying = null;
    this.playId = null;
    this.round = null;
    this.roundTimer = null;
    this.retryTimer = null;
    this.remainingMs = null;
    this.forcedNext = null;
    this.announcement = null;
    this.screenOnline = false;
    this.ruleName = null;
    this.context = null;
    this.lastError = null;
    this.info = { events: [], notices: [] };
    this.busy = Promise.resolve();
  }

  run(fn) {
    const p = this.busy.then(fn);
    this.busy = p.catch(err => this.fail(err));
    return p;
  }

  fail(err) {
    if (err.expose) return;
    console.error(err);
    this.lastError = err.message;
    this.broadcast();
  }

  async init() {
    await query("UPDATE rounds SET status = 'aborted', closed_at = now() WHERE status = 'open'");
    await query('UPDATE plays SET ended_at = now() WHERE ended_at IS NULL');
    await this.refreshInfo();
  }

  publicState() {
    const r = this.round;
    return {
      phase: this.phase,
      paused: this.paused,
      screenOnline: this.screenOnline,
      serverTime: Date.now(),
      nowPlaying: pub(this.nowPlaying),
      round: r && {
        id: r.id,
        status: r.status,
        endsAt: r.endsAt,
        remainingMs: this.paused ? this.remainingMs : null,
        candidates: r.candidates.map(pub),
        counts: r.counts,
        winner: pub(r.winner),
        resolution: r.resolution,
      },
      forcedNext: pub(this.forcedNext),
      announcement: this.announcement,
      ruleName: this.ruleName,
      context: this.context && {
        hhmm: this.context.hhmm,
        temp: this.context.temp,
        eventTypes: this.context.eventTypes,
        simulated: this.context.simulated,
        degraded: !this.context.weatherOk || !this.context.eventsOk,
      },
      info: this.info,
      lastError: this.lastError,
    };
  }

  broadcast() {
    this.io.emit('state', this.publicState());
  }

  sendScreen(command) {
    this.io.to('screen').emit('command', command);
  }

  currentCommand() {
    if (this.phase === 'playing') {
      return {
        type: 'play',
        playId: this.playId,
        provider: this.nowPlaying.provider || 'youtube',
        streamRef: this.nowPlaying.stream_ref,
        paused: this.paused,
      };
    }
    if (this.phase === 'announcement') {
      return { type: 'announcement', id: this.announcement.id, url: `/api/announcements/${this.announcement.id}/audio`, paused: this.paused };
    }
    return { type: 'stop' };
  }

  async refreshInfo() {
    const events = await query('SELECT name, type, starts_at FROM events WHERE ends_at >= now() ORDER BY starts_at LIMIT 3');
    const notices = await query(
      "SELECT text FROM announcements WHERE status = 'approved' AND (valid_from IS NULL OR valid_from <= now()) AND (valid_to IS NULL OR valid_to >= now()) ORDER BY id DESC LIMIT 5",
    );
    this.info = { events: events.rows, notices: notices.rows.map(r => r.text) };
  }

  infoChanged() {
    return this.run(async () => {
      await this.refreshInfo();
      this.broadcast();
    });
  }

  async screenConnected() {
    this.screenOnline = true;
    if (this.phase === 'idle' && !this.paused) await this.bootstrap();
    else this.sendScreen(this.currentCommand());
    this.broadcast();
  }

  screenDisconnected(remaining) {
    this.screenOnline = remaining > 0;
    this.broadcast();
  }

  retryLater(message) {
    this.lastError = message;
    this.phase = 'idle';
    this.broadcast();
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.run(async () => {
      if (this.phase === 'idle' && this.screenOnline && !this.paused) await this.bootstrap();
    }), RETRY_MS);
  }

  async bootstrap() {
    const { candidates, ruleName, context } = await pickCandidates([]);
    this.ruleName = ruleName;
    this.context = context;
    if (!candidates.length) return this.retryLater('No hay canciones elegibles ni lista de respaldo');
    await this.playSong(candidates[0], null, 'inicio');
    await this.openRound();
  }

  async playSong(song, roundId, source) {
    const { rows } = await query('INSERT INTO plays (song_id, round_id, source) VALUES ($1, $2, $3) RETURNING id', [song.id, roundId, source]);
    this.playId = rows[0].id;
    this.nowPlaying = song;
    this.phase = 'playing';
    this.announcement = null;
    this.sendScreen(this.currentCommand());
  }

  async openRound() {
    const settings = await getSettings();
    const { candidates, ruleName, context } = await pickCandidates([this.nowPlaying.id]);
    this.ruleName = ruleName;
    this.context = context;
    if (candidates.length < 2) {
      this.round = null;
      this.lastError = 'No hay suficientes canciones para abrir una ronda';
      return this.broadcast();
    }
    const ms = settings.round_seconds * 1000;
    const endsAt = new Date(Date.now() + ms);
    const { rows } = await query(
      'INSERT INTO rounds (candidate_a, candidate_b, ends_at, rule_name) VALUES ($1, $2, $3, $4) RETURNING id',
      [candidates[0].id, candidates[1].id, endsAt, ruleName],
    );
    this.round = {
      id: rows[0].id,
      candidates,
      endsAt: endsAt.getTime(),
      status: 'open',
      counts: { [candidates[0].id]: 0, [candidates[1].id]: 0 },
      winner: null,
      resolution: null,
    };
    if (this.paused) this.remainingMs = ms;
    else this.armTimer(ms);
    await this.refreshInfo();
    this.broadcast();
  }

  armTimer(ms) {
    clearTimeout(this.roundTimer);
    const id = this.round.id;
    this.roundTimer = setTimeout(() => this.run(() => this.closeRound(id)), ms);
  }

  async closeRound(roundId) {
    const r = this.round;
    if (!r || r.id !== roundId || r.status !== 'open') return;
    clearTimeout(this.roundTimer);
    const settings = await getSettings();
    const { rows } = await query('SELECT song_id, count(*)::int AS n FROM votes WHERE round_id = $1 GROUP BY song_id', [r.id]);
    const counts = Object.fromEntries(r.candidates.map(c => [c.id, 0]));
    for (const row of rows) counts[row.song_id] = row.n;

    const [a, b] = r.candidates;
    let outcome;
    if (counts[a.id] + counts[b.id] === 0) outcome = await this.resolveNoVotes(settings, r);
    else if (counts[a.id] === counts[b.id]) outcome = await this.resolveTie(settings, r);
    else outcome = { winner: counts[a.id] > counts[b.id] ? a : b, resolution: 'votos' };

    await query(
      "UPDATE rounds SET status = 'closed', closed_at = now(), votes_a = $2, votes_b = $3, winner_id = $4, resolution = $5 WHERE id = $1",
      [r.id, counts[a.id], counts[b.id], outcome.winner.id, outcome.resolution],
    );
    Object.assign(r, { status: 'closed', counts, winner: outcome.winner, resolution: outcome.resolution });
    this.remainingMs = null;
    this.broadcast();
  }

  async resolveTie(settings, r) {
    const [a, b] = r.candidates;
    if (settings.tie_break === 'first') return { winner: a, resolution: 'empate: primera opción' };
    if (settings.tie_break === 'least_played') {
      const { rows } = await query('SELECT song_id, count(*)::int AS n FROM plays WHERE song_id = ANY($1) GROUP BY song_id', [[a.id, b.id]]);
      const plays = id => rows.find(x => x.song_id === id)?.n ?? 0;
      if (plays(a.id) !== plays(b.id)) {
        return { winner: plays(a.id) < plays(b.id) ? a : b, resolution: 'empate: la menos reproducida' };
      }
    }
    return { winner: Math.random() < 0.5 ? a : b, resolution: 'empate: aleatorio' };
  }

  async resolveNoVotes(settings, r) {
    if (settings.no_votes === 'fallback') {
      const exclude = new Set([...r.candidates.map(c => c.id), this.nowPlaying?.id]);
      const pool = (await fallbackSongs(settings, exclude)).filter(s => !exclude.has(s.id));
      if (pool.length) return { winner: pool[Math.floor(Math.random() * pool.length)], resolution: 'sin votos: respaldo' };
    }
    return { winner: r.candidates[Math.floor(Math.random() * 2)], resolution: 'sin votos: aleatorio' };
  }

  async songEnded(playId) {
    if (this.phase !== 'playing' || playId !== this.playId) return;
    await query('UPDATE plays SET ended_at = now() WHERE id = $1', [playId]);
    if (this.round?.status === 'open') await this.closeRound(this.round.id);
    await this.advance();
  }

  async advance() {
    if (this.paused) {
      this.pendingAdvance = true;
      return this.broadcast();
    }
    const due = await this.dueAnnouncement();
    if (due) return this.playAnnouncement(due);
    await this.playNext();
  }

  async playNext() {
    let next = null;
    let source = 'votación';
    if (this.forcedNext) {
      next = this.forcedNext;
      source = 'admin';
      this.forcedNext = null;
    } else if (this.round?.status === 'closed') {
      next = this.round.winner;
    }
    const roundId = source === 'votación' && next ? this.round.id : null;
    this.round = null;
    if (!next) return this.bootstrap();
    await this.playSong(next, roundId, source);
    await this.openRound();
  }

  async dueAnnouncement() {
    const { rows } = await query(`
      SELECT a.id, a.text, a.hour_from, a.hour_to FROM announcements a
      WHERE a.status = 'approved' AND a.audio IS NOT NULL
        AND (a.valid_from IS NULL OR a.valid_from <= now())
        AND (a.valid_to IS NULL OR a.valid_to >= now())
        AND (SELECT count(*) FROM plays p WHERE p.started_at > COALESCE(a.last_played_at, '-infinity')) >= a.every_n_songs
      ORDER BY a.last_played_at NULLS FIRST, a.id`);
    const { hhmm } = localClock();
    const due = rows.find(a => inTimeRange(hhmm, a.hour_from?.slice(0, 5), a.hour_to?.slice(0, 5)));
    return due ? { id: due.id, text: due.text } : null;
  }

  async playAnnouncement(announcement) {
    this.phase = 'announcement';
    this.announcement = announcement;
    this.sendScreen(this.currentCommand());
    this.broadcast();
  }

  async announcementEnded(id) {
    if (this.phase !== 'announcement' || this.announcement?.id !== id) return;
    await query('UPDATE announcements SET last_played_at = now() WHERE id = $1', [id]);
    await query('INSERT INTO announcement_plays (announcement_id) VALUES ($1)', [id]);
    this.announcement = null;
    await this.playNext();
  }

  async playerError({ playId, id, message }) {
    this.lastError = `Error del reproductor: ${message}`;
    if (this.phase === 'playing' && playId === this.playId) await this.songEnded(playId);
    else if (this.phase === 'announcement' && id === this.announcement?.id) await this.announcementEnded(id);
    else this.broadcast();
  }

  async vote(songId, voterToken, ip) {
    const r = this.round;
    if (!r || r.status !== 'open' || this.paused || Date.now() >= r.endsAt) {
      return { ok: false, status: 409, error: 'La ronda está cerrada' };
    }
    if (!r.candidates.some(c => c.id === songId)) return { ok: false, status: 400, error: 'Opción no válida' };
    const res = await query(
      'INSERT INTO votes (round_id, song_id, voter_token, ip) VALUES ($1, $2, $3, $4) ON CONFLICT (round_id, voter_token) DO NOTHING',
      [r.id, songId, voterToken, ip],
    );
    if (!res.rowCount) return { ok: false, status: 409, error: 'Ya votaste en esta ronda' };
    r.counts[songId] += 1;
    this.broadcast();
    return { ok: true, roundId: r.id };
  }

  async pause() {
    if (this.paused) return;
    this.paused = true;
    if (this.round?.status === 'open') {
      this.remainingMs = Math.max(0, this.round.endsAt - Date.now());
      clearTimeout(this.roundTimer);
    }
    this.sendScreen({ type: 'pause' });
    this.broadcast();
  }

  async resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.round?.status === 'open' && this.remainingMs != null) {
      this.round.endsAt = Date.now() + this.remainingMs;
      await query('UPDATE rounds SET ends_at = $2 WHERE id = $1', [this.round.id, new Date(this.round.endsAt)]);
      this.armTimer(this.remainingMs);
      this.remainingMs = null;
    }
    if (this.pendingAdvance) {
      this.pendingAdvance = false;
      await this.advance();
    } else if (this.phase === 'idle' && this.screenOnline) {
      await this.bootstrap();
    } else {
      this.sendScreen({ type: 'resume' });
    }
    this.broadcast();
  }

  async skip() {
    if (this.phase === 'playing') await this.songEnded(this.playId);
    else if (this.phase === 'announcement') await this.announcementEnded(this.announcement.id);
    else if (this.screenOnline) await this.bootstrap();
  }

  // Descarta la ronda abierta y propone dos opciones nuevas con el contexto
  // actual (útil tras cambiar reglas, eventos o la simulación de contexto).
  async reroll() {
    if (this.phase !== 'playing') throw httpError(409, 'Solo se puede regenerar la ronda mientras suena una canción');
    if (this.round?.status === 'open') {
      clearTimeout(this.roundTimer);
      await query("UPDATE rounds SET status = 'aborted', closed_at = now(), resolution = 'regenerada por el administrador' WHERE id = $1", [this.round.id]);
    } else if (this.round?.status === 'closed') {
      throw httpError(409, 'La ronda ya cerró; la ganadora sonará a continuación');
    }
    this.round = null;
    this.remainingMs = null;
    await this.openRound();
  }

  async setNext(songId) {
    const { rows } = await query('SELECT * FROM songs WHERE id = $1 AND active', [songId]);
    if (!rows[0]) throw httpError(404, 'Canción no encontrada o inactiva');
    this.forcedNext = rows[0];
    this.broadcast();
  }
}