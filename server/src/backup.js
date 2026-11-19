import { query, transaction } from './db.js';

// Tablas de configuración incluidas en el respaldo, en orden de dependencias.
// No incluye administradores (contraseñas) ni el historial de rondas y votos.
const TABLES = {
  songs: ['id', 'title', 'artist', 'provider', 'stream_ref', 'genre', 'energy', 'mood', 'themes', 'restrictions', 'active', 'created_at'],
  playlists: ['id', 'name'],
  events: ['id', 'name', 'type', 'starts_at', 'ends_at'],
  context_rules: ['id', 'name', 'priority', 'condition', 'filters', 'active'],
  announcements: ['id', 'text', 'status', 'audio', 'audio_mime', 'valid_from', 'valid_to', 'hour_from', 'hour_to', 'every_n_songs', 'created_at'],
};
const JSON_COLUMNS = new Set(['condition', 'filters']);
export const BACKUP_VERSION = 1;

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

export async function exportBackup() {
  const data = { version: BACKUP_VERSION, exported_at: new Date().toISOString() };
  for (const [table, cols] of Object.entries(TABLES)) {
    const { rows } = await query(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY id`);
    data[table] = rows.map(row => (row.audio ? { ...row, audio: row.audio.toString('base64') } : row));
  }
  data.playlist_songs = (await query('SELECT playlist_id, song_id FROM playlist_songs ORDER BY playlist_id, song_id')).rows;
  data.settings = (await query('SELECT key, value FROM settings ORDER BY key')).rows;
  return data;
}

// Restaura combinando: actualiza los registros con el mismo id e inserta los
// que falten. No borra registros existentes, para no romper el historial.
export async function importBackup(data) {
  if (!data || data.version !== BACKUP_VERSION) throw httpError(400, 'Archivo de respaldo no válido o de otra versión');
  return transaction(async client => {
    const counts = {};
    for (const [table, cols] of Object.entries(TABLES)) {
      const rows = Array.isArray(data[table]) ? data[table] : [];
      const updates = cols.filter(c => c !== 'id').map(c => `${c} = EXCLUDED.${c}`).join(', ');
      for (const row of rows) {
        const values = cols.map(c => {
          const v = row[c] ?? null;
          if (c === 'audio' && v) return Buffer.from(v, 'base64');
          if (JSON_COLUMNS.has(c)) return JSON.stringify(v ?? {});
          return v;
        });
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updates}`,
          values,
        );
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM ${table}), 1))`);
      counts[table] = rows.length;
    }
    const links = Array.isArray(data.playlist_songs) ? data.playlist_songs : [];
    for (const link of links) {
      await client.query('INSERT INTO playlist_songs (playlist_id, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [link.playlist_id, link.song_id]);
    }
    counts.playlist_songs = links.length;
    for (const { key, value } of Array.isArray(data.settings) ? data.settings : []) {
      await client.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [key, JSON.stringify(value)],
      );
    }
    counts.settings = data.settings?.length ?? 0;
    return counts;
  });
}
