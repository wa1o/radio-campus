import './env.js';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import { migrate } from './db.js';
import { seedAdmin } from './auth.js';
import { Director } from './director.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const server = http.createServer(app);
const io = new Server(server);
const director = new Director(io);

app.use('/api', publicRoutes(director));
app.use('/api/admin', adminRoutes(director));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
app.use(express.static(dist));
app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.use((err, _req, res, _next) => {
  if (err.code === '23503') return res.status(409).json({ error: 'El registro está en uso; desactívalo en lugar de eliminarlo' });
  if (/^2[23]/.test(err.code || '')) return res.status(400).json({ error: `Datos inválidos: ${err.message}` });
  if (!err.expose) console.error(err);
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Error interno' });
});

io.on('connection', socket => {
  socket.emit('state', director.publicState());
  const { role, key } = socket.handshake.auth || {};
  if (role !== 'screen') return;

  if (key !== process.env.SCREEN_KEY) {
    socket.emit('authError', 'Clave de pantalla inválida');
    socket.disconnect(true);
    return;
  }
  socket.join('screen');
  director.run(() => director.screenConnected());
  socket.on('songEnded', ({ playId } = {}) => director.run(() => director.songEnded(playId)));
  socket.on('announcementEnded', ({ id } = {}) => director.run(() => director.announcementEnded(id)));
  socket.on('playerError', (data = {}) => director.run(() => director.playerError(data)));
  socket.on('disconnect', () => {
    director.run(() => director.screenDisconnected(io.sockets.adapter.rooms.get('screen')?.size ?? 0));
  });
});

await migrate();
await seedAdmin();
await director.init();
const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Servidor escuchando en el puerto ${port}`));