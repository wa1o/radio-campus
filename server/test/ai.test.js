import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySongs, isUnknownArtist } from '../src/ai.js';

test('la IA propone el artista y distingue nombres desconocidos', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'test-model';
  let prompt = '';

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    prompt = body.contents[0].parts[0].text;
    assert.equal(body.generationConfig.responseSchema.items.properties.artist.type, 'STRING');
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify([{
          id: 1, artist: 'Artista real', genre: 'pop', energy: 'medium', mood: 'alegre',
          themes: [], explicit: 'no',
        }]) }] } }],
      }),
    };
  };

  try {
    const result = await classifySongs([{ id: 1, title: 'Canción', artist: 'Desconocido' }]);
    assert.equal(result[0].artist, 'Artista real');
    assert.match(prompt, /no el nombre del canal/);
    assert.equal(isUnknownArtist('Canal de YouTube'), true);
    assert.equal(isUnknownArtist('Desconocido'), true);
    assert.equal(isUnknownArtist('Dua Lipa'), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
