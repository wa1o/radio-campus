import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { login } from '../auth.js';

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default function publicRoutes(director) {
  const r = Router();

  r.get('/state', (_req, res) => res.json(director.publicState()));

  r.post('/vote', rateLimit({ windowMs: 60_000, limit: 20 }), wrap(async (req, res) => {
    let token = req.cookies.voter_token;
    if (!token || !UUID.test(token)) {
      token = crypto.randomUUID();
      res.cookie('voter_token', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 30 * 864e5 });
    }
    const songId = Number(req.body?.songId);
    const out = await director.run(() => director.vote(songId, token, req.ip));
    if (!out.ok) return res.status(out.status).json({ error: out.error });
    res.json(out);
  }));

  r.get('/vote/mine', wrap(async (req, res) => {
    const round = director.round;
    const token = req.cookies.voter_token;
    if (!round || !token) return res.json({});
    const { rows } = await query(
      'SELECT round_id AS "roundId", song_id AS "songId" FROM votes WHERE round_id = $1 AND voter_token = $2',
      [round.id, token],
    );
    res.json(rows[0] ?? {});
  }));

  r.post('/login', rateLimit({ windowMs: 15 * 60_000, limit: 10 }), wrap(async (req, res) => {
    const token = await login(String(req.body?.email || ''), String(req.body?.password || ''));
    if (!token) return res.status(401).json({ error: 'Credenciales inválidas' });
    res.json({ token });
  }));

  r.get('/announcements/:id/audio', wrap(async (req, res) => {
    const { rows } = await query(
      "SELECT audio, audio_mime FROM announcements WHERE id = $1 AND status = 'approved' AND audio IS NOT NULL",
      [req.params.id],
    );
    if (!rows[0]) return res.sendStatus(404);
    res.type(rows[0].audio_mime).send(rows[0].audio);
  }));

  return r;
}