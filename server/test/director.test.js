import assert from 'node:assert/strict';
import test from 'node:test';
import { Director } from '../src/director.js';

test('reproduce canciones de la playlist en orden y volver a la programación al terminar', async () => {
  const director = new Director({ emit() {} });
  const songs = [{ id: 1 }, { id: 2 }];
  const played = [];
  let bootstrapped = false;
  director.playlistPlayback = { id: 7, name: 'Favoritas', songs, index: -1 };
  director.playSong = async (song, _roundId, source) => played.push({ song, source });
  director.openRound = async () => assert.fail('No debe abrir rondas durante la playlist');
  director.bootstrap = async () => { bootstrapped = true; };

  await director.playNext();
  await director.playNext();
  assert.deepEqual(played, [
    { song: songs[0], source: 'playlist' },
    { song: songs[1], source: 'playlist' },
  ]);
  assert.equal(director.playlistPlayback.index, 1);

  await director.playNext();
  assert.equal(director.playlistPlayback, null);
  assert.equal(bootstrapped, true);
});
