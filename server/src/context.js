import { query } from './db.js';
import { getSettings } from './settings.js';

const TZ = process.env.STATION_TZ || 'America/Mexico_City';
const WEATHER_TTL_MS = 10 * 60 * 1000;
let weather = { at: 0, temp: null, ok: false };

async function getTemperature() {
  if (Date.now() - weather.at < WEATHER_TTL_MS) return weather;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${process.env.STATION_LAT}&longitude=${process.env.STATION_LON}&current=temperature_2m`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    weather = { at: Date.now(), temp: json.current.temperature_2m, ok: true };
  } catch {
    weather = { at: Date.now(), temp: null, ok: false };
  }
  return weather;
}

export function localClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return { hhmm: `${get('hour')}:${get('minute')}` };
}

export function inTimeRange(hhmm, from, to) {
  if (!from || !to) return true;
  return from <= to ? hhmm >= from && hhmm < to : hhmm >= from || hhmm < to;
}

async function activeEventTypes() {
  const { rows } = await query('SELECT DISTINCT type FROM events WHERE now() BETWEEN starts_at AND ends_at');
  return rows.map(r => r.type);
}

async function getContext() {
  const [w, eventTypes] = await Promise.all([getTemperature(), activeEventTypes().catch(() => null)]);
  return {
    hhmm: localClock().hhmm,
    temp: w.temp,
    weatherOk: w.ok,
    eventTypes: eventTypes ?? [],
    eventsOk: eventTypes !== null,
  };
}

function ruleMatches(cond, ctx) {
  if ((cond.time_from || cond.time_to) && !inTimeRange(ctx.hhmm, cond.time_from, cond.time_to)) return false;
  if (cond.temp_min != null || cond.temp_max != null) {
    if (ctx.temp == null) return false;
    if (cond.temp_min != null && ctx.temp < cond.temp_min) return false;
    if (cond.temp_max != null && ctx.temp > cond.temp_max) return false;
  }
  if (cond.event_type && !ctx.eventTypes.includes(cond.event_type)) return false;
  return true;
}

function passesFilters(song, f) {
  const allowed = (list, value) => !list?.length || list.includes(value);
  return allowed(f.genres, song.genre)
    && allowed(f.energy, song.energy)
    && allowed(f.moods, song.mood)
    && (!f.themes?.length || song.themes.some(t => f.themes.includes(t)));
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export async function fallbackSongs(settings, blocked = new Set()) {
  if (!settings.fallback_playlist_id) return [];
  const { rows } = await query(
    'SELECT s.* FROM songs s JOIN playlist_songs ps ON ps.song_id = s.id WHERE ps.playlist_id = $1 AND s.active',
    [settings.fallback_playlist_id],
  );
  const fresh = rows.filter(r => !blocked.has(r.id));
  return fresh.length >= 2 ? fresh : rows;
}

export async function pickCandidates(excludeIds = []) {
  const settings = await getSettings();
  const ctx = await getContext();
  const degraded = !ctx.weatherOk || !ctx.eventsOk;

  const { rows: rules } = await query('SELECT * FROM context_rules WHERE active ORDER BY priority DESC, id');
  const rule = rules.find(r => ruleMatches(r.condition, ctx));

  const { rows: recent } = await query('SELECT song_id FROM plays ORDER BY started_at DESC LIMIT $1', [settings.recent_window]);
  const blocked = new Set([...recent.map(r => r.song_id), ...excludeIds]);

  const { rows: songs } = await query(
    'SELECT * FROM songs WHERE active AND NOT (restrictions && $1::text[])',
    [settings.excluded_restrictions],
  );

  let pool = degraded ? [] : songs.filter(s => !blocked.has(s.id) && (!rule || passesFilters(s, rule.filters)));
  let ruleName = rule ? rule.name : 'sin regla';

  if (pool.length < 2) {
    pool = (await fallbackSongs(settings, blocked)).filter(s => !excludeIds.includes(s.id));
    ruleName = degraded ? 'respaldo (sin datos de contexto)' : 'respaldo';
  }

  return { candidates: shuffle(pool).slice(0, 2), ruleName, context: ctx };
}