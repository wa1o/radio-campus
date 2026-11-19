import { Router } from 'express';
import { query } from '../db.js';
import { requireAdmin } from '../auth.js';
import { getSettings, saveSettings } from '../settings.js';
import { synthesize } from '../tts.js';
import { importYouTubePlaylist } from '../youtube.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

function crud(r, table, defaults, onChange = () => {}, validate = () => {}) {
  const fields = Object.keys(defaults);
  const values = body => fields.map(f => (body?.[f] === undefined || body?.[f] === '' || body?.[f] === null ? defaults[f] : body[f]));
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
  const assignments = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');

  r.get(`/${table}`, wrap(async (_req, res) => {
    res.json((await query(`SELECT * FROM ${table} ORDER BY id DESC`)).rows);
  }));
  r.post(`/${table}`, wrap(async (req, res) => {
    validate(req.body);
    const { rows } = await query(`INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`, values(req.body));
    onChange();
    res.status(201).json(rows[0]);
  }));
  r.put(`/${table}/:id`, wrap(async (req, res) => {
    validate(req.body);
    const { rows } = await query(`UPDATE ${table} SET ${assignments} WHERE id = $${fields.length + 1} RETURNING *`, [...values(req.body), req.params.id]);
    if (!rows[0]) return res.sendStatus(404);
    onChange();
    res.json(rows[0]);
  }));
  r.delete(`/${table}/:id`, wrap(async (req, res) => {
    await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    onChange();
    res.sendStatus(204);
  }));
}

export default function adminRoutes(director) {
  const r = Router();
  r.use(requireAdmin);
  const infoChanged = () => director.infoChanged();

  crud(r, 'songs', {
    title: null, artist: null, provider: 'youtube', stream_ref: null, genre: null, energy: null, mood: null,
    themes: [], restrictions: [], active: true,
  }, () => {}, body => {
    const provider = body?.provider || 'youtube';
    const ref = String(body?.stream_ref || '');
    if (!['youtube', 'licensed_audio'].includes(provider)) {
      throw httpError(400, 'Proveedor de música no válido');
    }
    if (provider === 'youtube' && !/^[\w-]{11}$/.test(ref)) {
      throw httpError(400, 'Ingresa un ID de video de YouTube válido');
    }
    if (provider === 'licensed_audio') {
      let url;
      try {
        url = new URL(ref);
      } catch {
        throw httpError(400, 'Ingresa la URL directa del audio con licencia');
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw httpError(400, 'La URL del audio debe ser HTTP o HTTPS y no incluir credenciales');
      }
    }
  });

  r.post('/import/youtube-playlist', wrap(async (req, res) => {
    const result = await importYouTubePlaylist(req.body?.url);
    res.status(201).json(result);
  }));
  crud(r, 'playlists', { name: null });
  crud(r, 'events', { name: null, type: null, starts_at: null, ends_at: null }, infoChanged);
  crud(r, 'context_rules', { name: null, priority: 0, condition: {}, filters: {}, active: true });

  r.get('/playlists/:id/songs', wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT s.* FROM songs s JOIN playlist_songs ps ON ps.song_id = s.id WHERE ps.playlist_id = $1 ORDER BY s.title',
      [req.params.id],
    );
    res.json(rows);
  }));
  r.post('/playlists/:id/songs', wrap(async (req, res) => {
    await query('INSERT INTO playlist_songs (playlist_id, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, req.body?.songId]);
    res.status(201).json({ ok: true });
  }));
  r.delete('/playlists/:id/songs/:songId', wrap(async (req, res) => {
    await query('DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2', [req.params.id, req.params.songId]);
    res.sendStatus(204);
  }));

  const ANN = 'id, text, status, valid_from, valid_to, hour_from, hour_to, every_n_songs, last_played_at, created_at, audio IS NOT NULL AS has_audio';
  const annValues = b => [
    b?.text || null, b?.valid_from || null, b?.valid_to || null,
    b?.hour_from || null, b?.hour_to || null, Number(b?.every_n_songs) || 3,
  ];

  r.get('/announcements', wrap(async (_req, res) => {
    res.json((await query(`SELECT ${ANN} FROM announcements ORDER BY id DESC`)).rows);
  }));
  r.post('/announcements', wrap(async (req, res) => {
    const { rows } = await query(
      `INSERT INTO announcements (text, valid_from, valid_to, hour_from, hour_to, every_n_songs) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ANN}`,
      annValues(req.body),
    );
    res.status(201).json(rows[0]);
  }));
  r.put('/announcements/:id', wrap(async (req, res) => {
    const { rows } = await query(
      `UPDATE announcements SET
         audio = CASE WHEN text IS DISTINCT FROM $1 THEN NULL ELSE audio END,
         status = CASE WHEN text IS DISTINCT FROM $1 THEN 'draft' ELSE status END,
         text = $1, valid_from = $2, valid_to = $3, hour_from = $4, hour_to = $5, every_n_songs = $6
       WHERE id = $7 RETURNING ${ANN}`,
      [...annValues(req.body), req.params.id],
    );
    if (!rows[0]) return res.sendStatus(404);
    infoChanged();
    res.json(rows[0]);
  }));
  r.delete('/announcements/:id', wrap(async (req, res) => {
    await query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    infoChanged();
    res.sendStatus(204);
  }));
  r.post('/announcements/:id/tts', wrap(async (req, res) => {
    const { rows } = await query('SELECT text FROM announcements WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.sendStatus(404);
    let out;
    try {
      out = await synthesize(rows[0].text);
    } catch (err) {
      return res.status(502).json({ error: `No se pudo generar la voz: ${err.message}` });
    }
    await query('UPDATE announcements SET audio = $1, audio_mime = $2 WHERE id = $3', [out.audio, out.mime, req.params.id]);
    res.json({ ok: true });
  }));
  r.get('/announcements/:id/audio', wrap(async (req, res) => {
    const { rows } = await query('SELECT audio, audio_mime FROM announcements WHERE id = $1 AND audio IS NOT NULL', [req.params.id]);
    if (!rows[0]) return res.sendStatus(404);
    res.type(rows[0].audio_mime).send(rows[0].audio);
  }));
  r.post('/announcements/:id/approve', wrap(async (req, res) => {
    const { rowCount } = await query("UPDATE announcements SET status = 'approved' WHERE id = $1 AND audio IS NOT NULL", [req.params.id]);
    if (!rowCount) return res.status(400).json({ error: 'Genera y revisa la voz antes de aprobar' });
    infoChanged();
    res.json({ ok: true });
  }));
  r.post('/announcements/:id/unapprove', wrap(async (req, res) => {
    await query("UPDATE announcements SET status = 'draft' WHERE id = $1", [req.params.id]);
    infoChanged();
    res.json({ ok: true });
  }));

  r.get('/settings', wrap(async (_req, res) => res.json(await getSettings())));
  r.put('/settings', wrap(async (req, res) => res.json(await saveSettings(req.body || {}))));

  r.post('/control/:action', wrap(async (req, res) => {
    const actions = {
      pause: () => director.pause(),
      resume: () => director.resume(),
      skip: () => director.skip(),
      next: () => director.setNext(Number(req.body?.songId)),
    };
    const action = actions[req.params.action];
    if (!action) return res.sendStatus(404);
    await director.run(action);
    res.json(director.publicState());
  }));

  r.get('/stats', wrap(async (_req, res) => {
    const summary = (await query(`
      SELECT count(*)::int AS rounds,
             count(*) FILTER (WHERE votes_a + votes_b = 0)::int AS empty_rounds,
             COALESCE(sum(votes_a + votes_b), 0)::int AS votes,
             COALESCE(round(avg(votes_a + votes_b), 2), 0) AS avg_votes
      FROM rounds WHERE status = 'closed'`)).rows[0];
    const history = (await query(`
      SELECT r.id, r.opened_at, r.status, r.votes_a, r.votes_b, r.resolution, r.rule_name,
             a.title AS a_title, b.title AS b_title, w.title AS winner_title
      FROM rounds r
      JOIN songs a ON a.id = r.candidate_a
      JOIN songs b ON b.id = r.candidate_b
      LEFT JOIN songs w ON w.id = r.winner_id
      ORDER BY r.id DESC LIMIT 50`)).rows;
    const plays = (await query(`
      SELECT p.id, p.started_at, p.source, s.title, s.artist
      FROM plays p JOIN songs s ON s.id = p.song_id
      ORDER BY p.id DESC LIMIT 50`)).rows;
    res.json({ summary, history, plays });
  }));

  r.get('/rounds/:id/votes', wrap(async (req, res) => {
    const { rows } = await query(
      'SELECT v.id, v.created_at, s.title FROM votes v JOIN songs s ON s.id = v.song_id WHERE v.round_id = $1 ORDER BY v.id',
      [req.params.id],
    );
    res.json(rows);
  }));

  return r;
}