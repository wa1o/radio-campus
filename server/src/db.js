import pg from 'pg';
import fs from 'node:fs';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : false,
});

export const query = (text, params) => pool.query(text, params);

export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('No se pudo revertir la transacción', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  const sql = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}