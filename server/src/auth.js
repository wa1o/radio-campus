import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

export async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await query('INSERT INTO admins (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [ADMIN_EMAIL, hash]);
}

export async function login(email, password) {
  const { rows } = await query('SELECT * FROM admins WHERE email = $1', [email]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) return null;
  return jwt.sign({ sub: rows[0].id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
}

export function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'admin') throw new Error();
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: 'No autorizado' });
  }
}