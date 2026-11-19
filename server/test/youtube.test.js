import assert from 'node:assert/strict';
import test from 'node:test';
import { markAgeRestrictedTracks, normalizePlaylistItems, parseYouTubePlaylistId } from '../src/youtube.js';

test('accepts playlist URLs from YouTube and YouTube Music', () => {
  assert.equal(parseYouTubePlaylistId('https://www.youtube.com/playlist?list=PLabc_123'), 'PLabc_123');
  assert.equal(parseYouTubePlaylistId('https://music.youtube.com/playlist?list=PLxyz-789'), 'PLxyz-789');
});

test('rejects non-YouTube links and video URLs without a playlist', () => {
  assert.throws(() => parseYouTubePlaylistId('https://example.com/playlist?list=PLabc123'), /playlist pública/);
  assert.throws(() => parseYouTubePlaylistId('https://www.youtube.com/watch?v=abcdefghijk'), /playlist pública/);
});

test('normalizes playlist items and skips unavailable or duplicate videos', () => {
  const tracks = normalizePlaylistItems([
    { snippet: { title: 'Canción', channelTitle: 'Canal', resourceId: { videoId: 'abcdefghijk' } } },
    { snippet: { title: 'Duplicada', resourceId: { videoId: 'abcdefghijk' } } },
    { snippet: { title: 'Deleted video', resourceId: { videoId: 'lmnopqrstuv' } } },
    { snippet: { title: 'Sin referencia', resourceId: {} } },
  ]);
  assert.deepEqual(tracks, [{
    provider: 'youtube',
    title: 'Canción',
    artist: 'Canal',
    stream_ref: 'abcdefghijk',
    restrictions: [],
    active: true,
  }]);
});

test('marks only YouTube age-restricted videos as explicit', () => {
  const tracks = [
    { stream_ref: 'abcdefghijk', restrictions: [] },
    { stream_ref: 'lmnopqrstuv', restrictions: [] },
  ];
  assert.deepEqual(markAgeRestrictedTracks(tracks, [
    { id: 'abcdefghijk', contentDetails: { contentRating: { ytRating: 'ytAgeRestricted' } } },
    { id: 'lmnopqrstuv', contentDetails: { contentRating: { ytRating: 'ytGeneral' } } },
  ]), [
    { stream_ref: 'abcdefghijk', restrictions: ['explicit'] },
    { stream_ref: 'lmnopqrstuv', restrictions: [] },
  ]);
});
