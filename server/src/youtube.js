import { transaction } from './db.js';
import { cleanTrack, suggestTags } from './songtools.js';

const MAX_PLAYLIST_ITEMS = 500;
const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

export function parseYouTubePlaylistId(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw httpError(400, 'Ingresa un enlace válido a una playlist de YouTube');
  }

  const hosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'];
  const id = url.searchParams.get('list');
  if (!hosts.includes(url.hostname.toLowerCase()) || !id || !/^[\w-]+$/.test(id)) {
    throw httpError(400, 'El enlace debe ser una playlist pública de YouTube o YouTube Music');
  }
  return id;
}

export function normalizePlaylistItems(items) {
  const tracks = [];
  const seen = new Set();
  for (const item of items) {
    const snippet = item?.snippet;
    const videoId = snippet?.resourceId?.videoId;
    const title = snippet?.title?.trim();
    if (
      !videoId
      || !/^[\w-]{11}$/.test(videoId)
      || !title
      || /^(deleted video|private video)$/i.test(title)
      || seen.has(videoId)
    ) continue;

    seen.add(videoId);
    tracks.push({
      provider: 'youtube',
      title,
      artist: snippet.videoOwnerChannelTitle?.trim() || snippet.channelTitle?.trim() || 'Canal de YouTube',
      stream_ref: videoId,
      restrictions: [],
      active: true,
    });
  }
  return tracks;
}

export function markAgeRestrictedTracks(tracks, videos) {
  const restricted = new Set(
    videos
      .filter(video => video.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted')
      .map(video => video.id),
  );
  return tracks.map(track => ({
    ...track,
    restrictions: restricted.has(track.stream_ref) ? ['explicit'] : [],
  }));
}

export async function youtubeRequest(resource, params) {
  if (!process.env.YOUTUBE_API_KEY) {
    throw httpError(503, 'Configura YOUTUBE_API_KEY en .env para importar playlists');
  }

  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  for (const [key, value] of Object.entries({ ...params, key: process.env.YOUTUBE_API_KEY })) {
    url.searchParams.set(key, value);
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    console.error('No se pudo conectar con YouTube Data API', error);
    throw httpError(502, 'No se pudo conectar con YouTube; intenta de nuevo más tarde');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw httpError(502, 'YouTube devolvió una respuesta inválida');
  }
  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded') {
      throw httpError(429, 'Se agotó la cuota diaria de YouTube Data API');
    }
    if (response.status === 403) {
      throw httpError(502, 'YouTube rechazó la solicitud; revisa la API key y que YouTube Data API v3 esté habilitada');
    }
    if (response.status === 404) {
      throw httpError(404, 'No se encontró la playlist de YouTube');
    }
    throw httpError(502, `YouTube no pudo completar la importación (HTTP ${response.status})`);
  }
  return data;
}

export async function importYouTubePlaylist(playlistUrl) {
  const playlistId = parseYouTubePlaylistId(playlistUrl);
  const playlistResponse = await youtubeRequest('playlists', {
    part: 'snippet',
    id: playlistId,
    maxResults: '1',
  });
  const playlist = playlistResponse.items?.[0];
  if (!playlist) throw httpError(404, 'No se encontró la playlist; comprueba que sea pública');

  const rawItems = [];
  let pageToken;
  do {
    const page = await youtubeRequest('playlistItems', {
      part: 'snippet',
      playlistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    rawItems.push(...(page.items || []));
    pageToken = page.nextPageToken;
  } while (pageToken && rawItems.length < MAX_PLAYLIST_ITEMS);

  let tracks = normalizePlaylistItems(rawItems.slice(0, MAX_PLAYLIST_ITEMS));
  if (!tracks.length) throw httpError(422, 'La playlist no contiene videos importables');
  const ratedVideos = [];
  for (let i = 0; i < tracks.length; i += 50) {
    const batch = tracks.slice(i, i + 50);
    const ratings = await youtubeRequest('videos', {
      part: 'contentDetails,topicDetails',
      id: batch.map(track => track.stream_ref).join(','),
    });
    ratedVideos.push(...(ratings.items || []));
  }
  tracks = markAgeRestrictedTracks(tracks, ratedVideos);
  // Limpia títulos y sugiere etiquetas (género, energía, ambiente) para las nuevas.
  const topicsById = new Map(ratedVideos.map(v => [v.id, v.topicDetails?.topicCategories || []]));
  tracks = tracks.map(track => {
    const tags = suggestTags({ title: track.title, topics: topicsById.get(track.stream_ref) || [], ageRestricted: track.restrictions.includes('explicit') });
    return { ...track, ...cleanTrack(track.title, track.artist), ...tags };
  });
  const truncated = rawItems.length > MAX_PLAYLIST_ITEMS || Boolean(pageToken);
  const references = tracks.map(track => track.stream_ref);

  const imported = await transaction(async client => {
    const existing = await client.query(
      'SELECT id, stream_ref, restrictions FROM songs WHERE provider = $1 AND stream_ref = ANY($2::text[])',
      ['youtube', references],
    );
    const idsByRef = new Map(existing.rows.map(row => [row.stream_ref, row.id]));
    const newTracks = tracks.filter(track => !idsByRef.has(track.stream_ref));
    const restrictedRefs = tracks
      .filter(track => track.restrictions.includes('explicit'))
      .map(track => track.stream_ref);

    if (restrictedRefs.length) {
      await client.query(
        `UPDATE songs
         SET restrictions = array_append(restrictions, 'explicit')
         WHERE provider = 'youtube' AND stream_ref = ANY($1::text[])
           AND NOT ('explicit' = ANY(restrictions))`,
        [restrictedRefs],
      );
    }

    if (newTracks.length) {
      const values = [];
      const placeholders = newTracks.map((track, index) => {
        const base = index * 10;
        values.push(track.provider, track.title, track.artist, track.stream_ref, track.restrictions, track.active, track.genre, track.energy, track.mood, track.themes);
        return `(${Array.from({ length: 10 }, (_, i) => `$${base + i + 1}`).join(', ')})`;
      });
      const inserted = await client.query(
        `INSERT INTO songs (provider, title, artist, stream_ref, restrictions, active, genre, energy, mood, themes) VALUES ${placeholders.join(', ')} RETURNING id, stream_ref`,
        values,
      );
      for (const row of inserted.rows) idsByRef.set(row.stream_ref, row.id);
    }

    const { rows } = await client.query(
      'INSERT INTO playlists (name) VALUES ($1) RETURNING id',
      [playlist.snippet?.title?.trim() || 'Playlist de YouTube'],
    );
    const songIds = tracks.map(track => idsByRef.get(track.stream_ref));
    await client.query(
      'INSERT INTO playlist_songs (playlist_id, song_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
      [rows[0].id, songIds],
    );
    return {
      playlistId: rows[0].id,
      playlistName: playlist.snippet?.title?.trim() || 'Playlist de YouTube',
      added: newTracks.length,
      alreadyInCatalog: existing.rows.length,
      tracksInPlaylist: tracks.length,
      explicitRestricted: restrictedRefs.length,
    };
  });

  return {
    ...imported,
    skipped: Math.max(0, rawItems.length - tracks.length),
    truncated,
  };
}
