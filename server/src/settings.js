import { query } from './db.js';

export const DEFAULTS = {
  round_seconds: 90,
  tie_break: 'random',
  no_votes: 'random',
  recent_window: 10,
  excluded_restrictions: ['explicit'],
  fallback_playlist_id: null,
  context_override: null,
};

export async function getSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  const settings = { ...DEFAULTS };
  for (const row of rows) if (row.key in DEFAULTS) settings[row.key] = row.value;
  return settings;
}

export async function saveSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [key, JSON.stringify(value)],
    );
  }
  return getSettings();
}