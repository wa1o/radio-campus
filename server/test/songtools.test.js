import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVideoId, parseVideoList, cleanTrack, suggestTags } from '../src/songtools.js';
import { templateLine, sanitize } from '../src/dj.js';

test('reconoce IDs y enlaces de YouTube en varios formatos', () => {
  for (const v of [
    'dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'youtube.com/embed/dQw4w9WgXcQ',
  ]) assert.equal(parseVideoId(v), 'dQw4w9WgXcQ', v);
  assert.equal(parseVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseVideoId('hola'), null);
});

test('separa una lista pegada y quita duplicados', () => {
  const { ids, invalid } = parseVideoList('https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ, kJQP7kiw5Fk  basura');
  assert.deepEqual(ids, ['dQw4w9WgXcQ', 'kJQP7kiw5Fk']);
  assert.deepEqual(invalid, ['basura']);
});

test('limpia títulos de YouTube y separa artista', () => {
  assert.deepEqual(cleanTrack('Queen – Bohemian Rhapsody (Official Video Remastered)', 'Queen Official'), { title: 'Bohemian Rhapsody', artist: 'Queen' });
  assert.deepEqual(cleanTrack('Luis Fonsi - Despacito ft. Daddy Yankee', 'LuisFonsiVEVO'), { title: 'Despacito ft. Daddy Yankee', artist: 'Luis Fonsi' });
  assert.deepEqual(cleanTrack('Levitating [Lyrics]', 'Dua Lipa'), { title: 'Levitating', artist: 'Dua Lipa' });
  assert.deepEqual(cleanTrack('Song Name - Remastered 2011', 'The Band - Topic'), { title: 'Song Name - Remastered 2011', artist: 'The Band' });
});

test('sugiere etiquetas con temas de YouTube y palabras clave', () => {
  assert.deepEqual(suggestTags({ title: 'Bohemian Rhapsody', topics: ['https://en.wikipedia.org/wiki/Rock_music'] }),
    { genre: 'rock', energy: 'high', mood: 'enérgico', themes: [], restrictions: [] });
  assert.equal(suggestTags({ title: 'Lofi beats para estudiar' }).energy, 'low');
  assert.equal(suggestTags({ title: 'Peso Pluma - corrido' }).genre, 'regional mexicano');
  assert.deepEqual(suggestTags({ title: 'Feliz Navidad (Explicit)' }).themes, ['navidad']);
  assert.deepEqual(suggestTags({ title: 'X', ageRestricted: true }).restrictions, ['explicit']);
  assert.equal(suggestTags({ title: 'Algo', topics: [] }).genre, null);
});

test('el locutor de plantillas usa los datos reales y termina invitando a votar', () => {
  const line = templateLine({
    station: 'Radio IEST', hour: 9, previous: { title: 'Levitating', artist: 'Dua Lipa' },
    next: { title: 'La Bamba', artist: 'Ritchie Valens' }, byVote: true, votes: 12, totalVotes: 20, temp: 30, event: null,
  });
  assert.match(line, /Levitating/);
  assert.match(line, /12 votos/);
  assert.match(line, /La Bamba/);
  assert.match(line, /QR/);
});

test('limpia la respuesta de la IA', () => {
  assert.equal(sanitize('**¡Hola, campus!** 🎉 Sigue "La Bamba".'), '¡Hola, campus! Sigue La Bamba.');
  assert.equal(sanitize('ok'), null);
});

test('el locutor usa Gemini si hay clave y vuelve a las plantillas si falla', async () => {
  const { writeDjLine } = await import('../src/dj.js');
  const director = { nowPlaying: { title: 'Levitating', artist: 'Dua Lipa' }, round: null, context: { hhmm: '10:00', temp: 25 }, info: { events: [] } };
  const settings = { dj_use_ai: true, dj_station_name: 'Radio IEST' };
  const realFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'prueba';
  try {
    let sentPrompt = '';
    globalThis.fetch = async (_url, init) => {
      sentPrompt = JSON.parse(init.body).contents[0].parts[0].text;
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '¡Qué tal, campus! Eso fue Levitating. Escanea el QR y vota.' }] } }] }) };
    };
    const ai = await writeDjLine(director, settings);
    assert.equal(ai.source, 'ia');
    assert.match(sentPrompt, /Levitating/);
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const fallback = await writeDjLine(director, settings);
    assert.equal(fallback.source, 'plantilla');
    assert.match(fallback.text, /Levitating/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test('acepta solo etiquetas válidas de la IA', async () => {
  const { parseAiTags } = await import('../src/songtools.js');
  const out = parseAiTags('```json\n[{"id":1,"genre":"Pop","energy":"high","mood":"Alegre"},{"id":2,"energy":"altísima"},{"id":99,"genre":"rock"}]\n```', [1, 2]);
  assert.deepEqual(out, [
    { id: 1, genre: 'pop', energy: 'high', mood: 'alegre' },
    { id: 2, genre: null, energy: null, mood: null },
  ]);
  assert.deepEqual(parseAiTags('no es json', [1]), []);
});
