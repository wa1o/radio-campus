// Herramientas para agregar canciones con el menor trabajo manual posible:
// enlaces o IDs de YouTube, búsqueda, limpieza de títulos y etiquetas sugeridas.
import { query, transaction } from './db.js';
import { youtubeRequest } from './youtube.js';

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });
const hasKey = () => Boolean(process.env.YOUTUBE_API_KEY);

// ---------- Identificadores ----------

export function parseVideoId(input) {
  const value = String(input ?? '').trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  let url;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1, 12);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v')
      || url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1]
      || null;
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// Separa una lista pegada (una por línea, comas o espacios) en IDs únicos.
export function parseVideoList(text) {
  const ids = [];
  const invalid = [];
  for (const token of String(text ?? '').split(/[\s,]+/).filter(Boolean)) {
    const id = parseVideoId(token);
    if (!id) invalid.push(token);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

// ---------- Limpieza de títulos ----------

const NOISE = /\s*[([](?:[^)\]]*\b(?:official|oficial|video|v[ií]deo|audio|lyrics?|letra|visuali[sz]er|hd|hq|4k|remaster(?:ed|izado)?(?: \d{4})?|en vivo|live|clip|videoclip|mv)\b[^)\]]*)[)\]]/gi;

export function cleanTrack(rawTitle, rawChannel = '') {
  let title = String(rawTitle ?? '').replace(NOISE, '').replace(/\s+/g, ' ').trim();
  const autoChannel = /\s+-\s+Topic$/i.test(String(rawChannel ?? ''));
  let artist = String(rawChannel ?? '')
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/VEVO$/i, '')
    .replace(/\s*(official|oficial)$/i, '')
    .trim();
  const dash = !autoChannel && title.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (dash) {
    artist = dash[1].trim();
    title = dash[2].trim();
  }
  title = title.replace(/\s*[-–|]\s*$/, '').replace(/^["“']|["”']$/g, '').trim();
  return { title: title || String(rawTitle ?? '').trim(), artist: artist || 'Desconocido' };
}

// ---------- Etiquetas sugeridas ----------

const TOPIC_GENRES = [
  [/Hip_hop_music/, 'hip hop'], [/Electronic_music/, 'electrónica'], [/Classical_music/, 'clásica'],
  [/Jazz/, 'jazz'], [/Reggae/, 'reggae'], [/Rhythm_and_blues|Soul_music/, 'r&b'], [/Rock_music/, 'rock'],
  [/Country_music/, 'country'], [/Blues/, 'blues'], [/Christian_music|Gospel/, 'cristiana'],
  [/Soundtrack/, 'soundtrack'], [/Independent_music/, 'indie'], [/Music_of_Latin_America/, 'latina'],
  [/Pop_music/, 'pop'],
];
const KEYWORD_GENRES = [
  [/reggaet[oó]n|perreo/i, 'reggaetón'], [/cumbia/i, 'cumbia'], [/salsa\b/i, 'salsa'], [/bachata/i, 'bachata'],
  [/corrido|banda\b|norteñ|mariachi|ranchera|sierreñ/i, 'regional mexicano'],
  [/lo-?fi/i, 'lofi'], [/\binstrumental\b/i, 'instrumental'], [/\bpiano\b/i, 'instrumental'],
];
const GENRE_ENERGY = {
  'reggaetón': 'high', 'electrónica': 'high', 'hip hop': 'high', rock: 'high', cumbia: 'high', salsa: 'high',
  latina: 'high', 'regional mexicano': 'medium', pop: 'medium', indie: 'medium', 'r&b': 'medium', reggae: 'medium',
  country: 'medium', bachata: 'medium', blues: 'medium', cristiana: 'medium',
  'clásica': 'low', jazz: 'low', lofi: 'low', instrumental: 'low', soundtrack: 'low',
};
const MOOD_BY_ENERGY = { high: 'enérgico', medium: 'alegre', low: 'tranquilo' };

export function suggestTags({ title = '', topics = [], ageRestricted = false }) {
  const topicText = topics.join(' ');
  const genre = KEYWORD_GENRES.find(([re]) => re.test(title))?.[1]
    ?? TOPIC_GENRES.find(([re]) => re.test(topicText))?.[1]
    ?? null;
  let energy = genre ? GENRE_ENERGY[genre] ?? 'medium' : null;
  if (/ac[uú]stic|unplugged|relax|sleep|calm|balada|piano/i.test(title)) energy = 'low';
  else if (/remix|club|workout|edm|fiesta|party|mashup/i.test(title)) energy = 'high';
  const themes = [];
  if (/navidad|navideñ|christmas|villancico|xmas/i.test(title)) themes.push('navidad');
  if (/halloween|d[ií]a de muertos/i.test(title)) themes.push('halloween');
  const restrictions = ageRestricted || /\bexplicit\b|expl[ií]cit/i.test(title) ? ['explicit'] : [];
  return { genre, energy, mood: energy ? MOOD_BY_ENERGY[energy] : null, themes, restrictions };
}

// ---------- Datos de YouTube ----------

const isoSeconds = iso => {
  const m = String(iso ?? '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
};

async function detailsWithKey(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const data = await youtubeRequest('videos', {
      part: 'snippet,contentDetails,topicDetails,status',
      id: ids.slice(i, i + 50).join(','),
    });
    for (const v of data.items || []) {
      out.set(v.id, {
        id: v.id,
        rawTitle: v.snippet?.title,
        channel: v.snippet?.channelTitle,
        seconds: isoSeconds(v.contentDetails?.duration),
        ageRestricted: v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
        topics: v.topicDetails?.topicCategories || [],
        embeddable: v.status?.embeddable !== false && v.status?.privacyStatus !== 'private',
      });
    }
  }
  return out;
}

// Sin clave de API: oEmbed público (solo título y canal; responde 401/404 si
// el video no existe o no permite insertarse).
async function detailsWithoutKey(ids) {
  const out = new Map();
  await Promise.all(ids.map(async id => {
    try {
      const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      out.set(id, { id, rawTitle: data.title, channel: data.author_name, seconds: null, ageRestricted: false, topics: [], embeddable: true });
    } catch {}
  }));
  return out;
}

export const fetchDetails = ids => (hasKey() ? detailsWithKey(ids) : detailsWithoutKey(ids));

export function toSong(detail) {
  const { title, artist } = cleanTrack(detail.rawTitle, detail.channel);
  return { provider: 'youtube', stream_ref: detail.id, title, artist, ...suggestTags({ title: detail.rawTitle, topics: detail.topics, ageRestricted: detail.ageRestricted }) };
}

// ---------- Operaciones ----------

export async function addSongsFromText(text, { playlistId = null } = {}) {
  const { ids, invalid } = parseVideoList(text);
  if (!ids.length) throw httpError(400, 'Pega al menos un enlace o ID de video de YouTube');
  if (ids.length > 200) throw httpError(400, 'Agrega como máximo 200 videos por vez');
  const details = await fetchDetails(ids);
  const failed = invalid.map(ref => ({ ref, reason: 'no es un enlace de YouTube' }));
  const songs = [];
  for (const id of ids) {
    const d = details.get(id);
    if (!d) failed.push({ ref: id, reason: 'no existe, es privado o no permite insertarse' });
    else if (!d.embeddable) failed.push({ ref: id, reason: 'el dueño no permite reproducirlo fuera de YouTube' });
    else songs.push(toSong(d));
  }
  return { ...(await saveSongs(songs, playlistId)), failed };
}

export async function saveSongs(songs, playlistId = null) {
  return transaction(async client => {
    const refs = songs.map(s => s.stream_ref);
    const { rows: existing } = await client.query("SELECT id, stream_ref FROM songs WHERE provider = 'youtube' AND stream_ref = ANY($1::text[])", [refs]);
    const idByRef = new Map(existing.map(r => [r.stream_ref, r.id]));
    const added = [];
    for (const s of songs) {
      if (idByRef.has(s.stream_ref)) continue;
      const { rows } = await client.query(
        `INSERT INTO songs (provider, stream_ref, title, artist, genre, energy, mood, themes, restrictions, active)
         VALUES ('youtube', $1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING id, title, artist, genre, energy, mood, restrictions`,
        [s.stream_ref, s.title, s.artist, s.genre, s.energy, s.mood, s.themes, s.restrictions],
      );
      idByRef.set(s.stream_ref, rows[0].id);
      added.push(rows[0]);
    }
    if (playlistId) {
      await client.query(
        'INSERT INTO playlist_songs (playlist_id, song_id) SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING',
        [playlistId, refs.map(r => idByRef.get(r)).filter(Boolean)],
      );
    }
    return { added, alreadyInCatalog: existing.length };
  });
}

export async function searchYouTube(q) {
  const text = String(q ?? '').trim();
  if (text.length < 2) throw httpError(400, 'Escribe al menos dos letras para buscar');
  if (!hasKey()) throw httpError(503, 'La búsqueda necesita YOUTUBE_API_KEY. Mientras tanto, pega enlaces de YouTube.');
  const data = await youtubeRequest('search', {
    part: 'snippet', type: 'video', videoCategoryId: '10', videoEmbeddable: 'true',
    regionCode: 'MX', relevanceLanguage: 'es', maxResults: '12', q: text,
  });
  const ids = (data.items || []).map(i => i.id?.videoId).filter(Boolean);
  const details = await detailsWithKey(ids);
  const { rows } = await query("SELECT stream_ref FROM songs WHERE provider = 'youtube' AND stream_ref = ANY($1::text[])", [ids]);
  const inCatalog = new Set(rows.map(r => r.stream_ref));
  return ids.map(id => details.get(id)).filter(d => d?.embeddable).map(d => ({
    ...toSong(d),
    seconds: d.seconds,
    thumbnailUrl: `https://i.ytimg.com/vi/${d.id}/mqdefault.jpg`,
    inCatalog: inCatalog.has(d.id),
  }));
}

// Completa etiquetas vacías del catálogo sin tocar las que ya puso el administrador.
export async function autotagCatalog() {
  const { rows } = await query(
    "SELECT id, stream_ref, title FROM songs WHERE provider = 'youtube' AND (genre IS NULL OR energy IS NULL OR mood IS NULL) ORDER BY id LIMIT 500",
  );
  if (!rows.length) return { updated: 0, pending: 0 };
  const details = await fetchDetails(rows.map(r => r.stream_ref));
  let updated = 0;
  for (const song of rows) {
    const d = details.get(song.stream_ref);
    const tags = suggestTags({ title: d?.rawTitle ?? song.title, topics: d?.topics ?? [], ageRestricted: d?.ageRestricted });
    const res = await query(
      `UPDATE songs SET
         genre = COALESCE(genre, $2), energy = COALESCE(energy, $3), mood = COALESCE(mood, $4),
         themes = CASE WHEN cardinality(themes) = 0 THEN $5::text[] ELSE themes END,
         restrictions = CASE WHEN $6 AND NOT ('explicit' = ANY(restrictions)) THEN array_append(restrictions, 'explicit') ELSE restrictions END
       WHERE id = $1 AND ($2::text IS NOT NULL OR $3::text IS NOT NULL OR $6)`,
      [song.id, tags.genre, tags.energy, tags.mood, tags.themes, tags.restrictions.includes('explicit')],
    );
    updated += res.rowCount;
  }
  // Lo que siga sin género se le pregunta a Gemini (si está configurado).
  updated += await aiTagMissing();
  const { rows: [left] } = await query("SELECT count(*)::int AS n FROM songs WHERE genre IS NULL OR energy IS NULL");
  return { updated, pending: left.n };
}

const ENERGIES = ['low', 'medium', 'high'];

export function parseAiTags(text, ids) {
  let list;
  try {
    list = JSON.parse(String(text).replace(/^```(?:json)?|```$/g, '').trim());
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(t => ids.includes(Number(t?.id)))
    .map(t => ({
      id: Number(t.id),
      genre: typeof t.genre === 'string' && t.genre.length <= 30 ? t.genre.toLowerCase().trim() : null,
      energy: ENERGIES.includes(t.energy) ? t.energy : null,
      mood: typeof t.mood === 'string' && t.mood.length <= 30 ? t.mood.toLowerCase().trim() : null,
    }));
}

async function aiTagMissing() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return 0;
  const { rows } = await query('SELECT id, title, artist FROM songs WHERE genre IS NULL OR energy IS NULL OR mood IS NULL ORDER BY id LIMIT 60');
  if (!rows.length) return 0;
  const prompt = [
    'Clasifica cada canción para la radio de una universidad mexicana. Responde SOLO un arreglo JSON de objetos {"id", "genre", "energy", "mood"}.',
    `genre: una palabra o dos en español y minúsculas, de preferencia una de: ${Object.keys(GENRE_ENERGY).join(', ')}.`,
    'energy: "low", "medium" o "high". mood: un adjetivo en español (tranquilo, alegre, enérgico, romántico, nostálgico, intenso).',
    'Si no conoces la canción, deduce por el artista; si no puedes, usa null.',
    JSON.stringify(rows),
  ].join('\n');
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-flash-lite-latest'}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const tags = parseAiTags(data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '', rows.map(r => r.id));
    let n = 0;
    for (const t of tags) {
      const r = await query(
        'UPDATE songs SET genre = COALESCE(genre, $2), energy = COALESCE(energy, $3), mood = COALESCE(mood, $4) WHERE id = $1 AND ($2::text IS NOT NULL OR $3::text IS NOT NULL OR $4::text IS NOT NULL)',
        [t.id, t.genre, t.energy, t.mood],
      );
      n += r.rowCount;
    }
    return n;
  } catch (err) {
    console.warn('No se pudieron sugerir etiquetas con Gemini:', err.message);
    return 0;
  }
}
