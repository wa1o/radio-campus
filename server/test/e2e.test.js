// Prueba de integración de una ronda completa contra un PostgreSQL real.
// Se ejecuta solo si existe TEST_DATABASE_URL (¡la base se vacía!):
//   TEST_DATABASE_URL=postgres://... npm run test:e2e
// La pantalla pública se simula con un cliente Socket.IO: los comandos de
// reproducción se verifican, pero el audio real se comprueba en el navegador.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { io } from 'socket.io-client';

const DB = process.env.TEST_DATABASE_URL;
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const ENV = {
  ...process.env,
  DATABASE_URL: DB,
  PGSSL: 'false',
  PORT: String(PORT),
  JWT_SECRET: 'test-secret',
  SCREEN_KEY: 'test-screen',
  ADMIN_EMAIL: 'admin@test.mx',
  ADMIN_PASSWORD: 'test-password',
  STATION_LAT: '22.2553',
  STATION_LON: '-97.8686',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('   ·', ...a);

let server;
async function startServer() {
  server = spawn(process.execPath, ['src/index.js'], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error('El servidor no arrancó');
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await once(server, 'exit');
}

// Cada "dispositivo" guarda su propia cookie voter_token.
function device(name) {
  let cookie = '';
  return {
    name,
    async vote(songId) {
      const res = await fetch(`${BASE}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
        body: JSON.stringify({ songId }),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    },
  };
}

let token;
async function admin(path, method = 'GET', body) {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return json;
}

function screen() {
  const socket = io(BASE, { auth: { role: 'screen', key: 'test-screen' }, transports: ['websocket'] });
  const commands = [];
  let state = null;
  const waiters = [];
  socket.on('command', c => { commands.push(c); waiters.splice(0).forEach(w => w()); });
  socket.on('state', s => { state = s; waiters.splice(0).forEach(w => w()); });
  const until = async (pred, label, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const out = pred();
      if (out) return out;
      await new Promise(r => { waiters.push(r); setTimeout(r, 200); });
    }
    throw new Error(`Tiempo agotado esperando: ${label}`);
  };
  return { socket, commands, get state() { return state; }, until };
}

test('ronda completa con varios dispositivos, contexto, anuncios y persistencia', { skip: !DB && 'define TEST_DATABASE_URL', timeout: 90_000 }, async t => {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  t.after(async () => { await stopServer(); await db.end(); });

  await startServer();
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ENV.ADMIN_EMAIL, password: ENV.ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  token = (await login.json()).token;
  const unauth = await fetch(`${BASE}/api/admin/songs`);
  assert.equal(unauth.status, 401, 'el panel exige autenticación');
  log('login de administrador OK; /api/admin sin token → 401');

  // Catálogo etiquetado
  const tracks = [
    ['Pop 1', 'pop', 'high', 'alegre'], ['Pop 2', 'pop', 'high', 'alegre'], ['Pop 3', 'pop', 'medium', 'alegre'],
    ['Rock 1', 'rock', 'high', 'intenso'], ['Instrumental 1', 'instrumental', 'low', 'tranquilo'],
    ['Instrumental 2', 'instrumental', 'low', 'tranquilo'], ['Instrumental 3', 'instrumental', 'low', 'tranquilo'],
    ['Explícita', 'pop', 'high', 'alegre', ['explicit']],
  ];
  const songs = [];
  for (const [title, genre, energy, mood, restrictions = []] of tracks) {
    songs.push(await admin('/songs', 'POST', {
      title, artist: 'Artista de prueba', provider: 'licensed_audio', stream_ref: `https://audio.example.edu/${encodeURIComponent(title)}.mp3`,
      genre, energy, mood, themes: [], restrictions, active: true,
    }));
  }
  const byId = Object.fromEntries(songs.map(s => [s.id, s]));
  const playlist = await admin('/playlists', 'POST', { name: 'Respaldo' });
  for (const s of songs.slice(0, 4)) await admin(`/playlists/${playlist.id}/songs`, 'POST', { songId: s.id });

  await admin('/context_rules', 'POST', { name: 'Día energético', priority: 1, condition: {}, filters: { genres: ['pop', 'rock'] }, active: true });
  await admin('/context_rules', 'POST', { name: 'Exámenes', priority: 10, condition: { event_type: 'exam', exclusive: true }, filters: { genres: ['instrumental'], energy: ['low'] }, active: true });
  await admin('/settings', 'PUT', {
    round_seconds: 3, tie_break: 'least_played', no_votes: 'fallback', recent_window: 0,
    excluded_restrictions: ['explicit'], fallback_playlist_id: playlist.id, dj_enabled: false,
    context_override: { temp: 26 },
  });
  log(`catálogo: ${songs.length} canciones, 2 reglas, lista de respaldo #${playlist.id}`);

  // La pantalla se conecta y arranca la programación
  const scr = screen();
  t.after(() => scr.socket.close());
  const first = await scr.until(() => scr.commands.find(c => c.type === 'play'), 'primer comando play');
  const round1 = await scr.until(() => scr.state?.round?.status === 'open' && scr.state.round, 'ronda abierta');
  assert.equal(round1.candidates.length, 2);
  for (const c of round1.candidates) {
    assert.ok(['pop', 'rock'].includes(byId[c.id].genre), 'la regla contextual filtra los géneros');
    assert.notEqual(byId[c.id].title, 'Explícita', 'se excluye contenido restringido');
    assert.notEqual(c.id, songs.find(s => s.stream_ref === first.streamRef).id, 'no repite la canción actual');
  }
  log(`ronda #${round1.id}: ${round1.candidates.map(c => c.title).join(' vs ')} (regla: ${scr.state.ruleName})`);

  // Votos desde tres dispositivos distintos
  const [a, b] = round1.candidates;
  const phones = ['teléfono A', 'teléfono B', 'teléfono C'].map(device);
  assert.equal((await phones[0].vote(a.id)).status, 200);
  assert.equal((await phones[1].vote(a.id)).status, 200);
  assert.equal((await phones[2].vote(b.id)).status, 200);
  const dup = await phones[0].vote(b.id);
  assert.equal(dup.status, 409, 'un dispositivo no puede votar dos veces');
  assert.equal((await device('teléfono D').vote(9999)).status, 400, 'se rechaza una opción que no está en la ronda');
  log(`votos: ${a.title}=2, ${b.title}=1; voto repetido → 409 «${dup.body.error}»`);

  // Cierre automático en el servidor y resultado
  const closed = await scr.until(() => scr.state?.round?.id === round1.id && scr.state.round.status === 'closed' && scr.state.round, 'cierre automático');
  assert.equal(closed.winner.id, a.id);
  assert.equal(closed.resolution, 'votos');
  const late = await device('teléfono tardío').vote(a.id);
  assert.equal(late.status, 409, 'no se aceptan votos tras el cierre');
  log(`cierre automático: ganó «${closed.winner.title}» (${closed.resolution}); voto tardío → 409`);

  // Termina la canción → suena la ganadora
  scr.socket.emit('songEnded', { playId: first.playId });
  const second = await scr.until(() => scr.commands.find(c => c.type === 'play' && c.playId !== first.playId), 'reproducción de la ganadora');
  assert.equal(second.streamRef, byId[a.id].stream_ref);
  log(`reproduce la ganadora: ${second.streamRef}`);

  // Cambio de contexto: evento de exámenes simulado → solo instrumental
  const round2 = await scr.until(() => scr.state?.round?.status === 'open' && scr.state.round.id !== round1.id && scr.state.round, 'ronda 2');
  await admin('/settings', 'PUT', { context_override: { temp: 26, event_type: 'exam' } });
  await admin('/control/reroll', 'POST');
  const round3 = await scr.until(() => scr.state?.round?.status === 'open' && scr.state.round.id !== round2.id && scr.state.round, 'ronda regenerada');
  for (const c of round3.candidates) assert.equal(byId[c.id].genre, 'instrumental');
  assert.equal(scr.state.ruleName, 'Exámenes');
  log(`contexto cambiado a exámenes: ${round2.candidates.map(c => c.title).join(' vs ')} → ${round3.candidates.map(c => c.title).join(' vs ')}`);

  // Ronda sin votos → regla configurada (lista de respaldo)
  const noVotes = await scr.until(() => scr.state?.round?.id === round3.id && scr.state.round.status === 'closed' && scr.state.round, 'cierre sin votos');
  assert.equal(noVotes.resolution, 'sin votos: respaldo');
  log(`ronda sin votos → «${noVotes.winner.title}» (${noVotes.resolution})`);

  // Anuncio autorizado entre canciones (la pantalla usa la voz del navegador)
  const ann = await admin('/announcements', 'POST', { text: 'Recuerda votar por la siguiente canción', every_n_songs: 1 });
  await admin(`/announcements/${ann.id}/approve`, 'POST');
  const expired = await admin('/announcements', 'POST', { text: 'Anuncio vencido', every_n_songs: 1, valid_to: '2020-01-01T00:00:00Z' });
  await db.query("UPDATE announcements SET status = 'approved' WHERE id = $1", [expired.id]);
  scr.socket.emit('songEnded', { playId: second.playId });
  const annCmd = await scr.until(() => scr.commands.find(c => c.type === 'announcement'), 'comando de anuncio');
  assert.equal(annCmd.id, ann.id, 'se reproduce el anuncio vigente, no el vencido');
  assert.equal(annCmd.text, 'Recuerda votar por la siguiente canción');
  scr.socket.emit('announcementEnded', { id: ann.id });
  const third = await scr.until(() => scr.commands.at(-1).type === 'play' && scr.commands.at(-1).playId !== second.playId && scr.commands.at(-1), 'música tras el anuncio');
  assert.equal(third.streamRef, byId[noVotes.winner.id].stream_ref, 'tras el anuncio suena la ganadora, sin superponerse');
  log(`anuncio #${ann.id} entre canciones; luego suena «${noVotes.winner.title}»`);

  // Locutor automático: habla entre canciones con los datos reales (plantillas, sin GEMINI_API_KEY)
  await admin(`/announcements/${ann.id}/unapprove`, 'POST');
  await admin('/settings', 'PUT', { dj_enabled: true, dj_every_n_songs: 1, dj_station_name: 'Radio Prueba' });
  const round4 = await scr.until(() => scr.state?.round?.status === 'open' && scr.state.round, 'ronda 4');
  await device('teléfono E').vote(round4.candidates[1].id);
  scr.socket.emit('songEnded', { playId: third.playId });
  const djCmd = await scr.until(() => scr.commands.find(c => c.type === 'announcement' && c.kind === 'dj'), 'locución del locutor');
  assert.match(djCmd.text, new RegExp(round4.candidates[1].title), 'el locutor presenta a la ganadora');
  assert.match(djCmd.text, /QR/);
  await scr.until(() => scr.state?.announcement?.kind === 'dj', 'estado con locutor');
  scr.socket.emit('announcementEnded', { id: djCmd.id });
  const fourth = await scr.until(() => scr.commands.at(-1).type === 'play' && scr.commands.at(-1).playId !== third.playId && scr.commands.at(-1), 'música tras el locutor');
  assert.equal(fourth.streamRef, byId[round4.candidates[1].id].stream_ref);
  log(`locutor: «${djCmd.text}»`);

  // Persistencia: reiniciar el servidor conserva ajustes y datos
  const before = await admin('/settings');
  const stats = await admin('/stats');
  await stopServer();
  await startServer();
  assert.deepEqual(await admin('/settings'), before);
  assert.equal((await admin('/songs')).length, songs.length);
  assert.ok((await admin('/stats')).summary.rounds >= stats.summary.rounds);
  log(`tras reiniciar: ajustes iguales, ${songs.length} canciones, ${stats.summary.rounds} rondas cerradas en historial`);

  // Respaldo y restauración
  const backup = await admin('/backup');
  await db.query('UPDATE context_rules SET priority = 0');
  await admin('/restore', 'POST', backup);
  const rules = await admin('/context_rules');
  assert.equal(rules.find(r => r.name === 'Exámenes').priority, 10);
  log(`respaldo exportado (${backup.songs.length} canciones, ${backup.context_rules.length} reglas) y restaurado`);

  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(health.ok, true);
});
