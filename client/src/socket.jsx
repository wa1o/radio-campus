import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useStation(auth) {
  const socketRef = useRef(null);
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const socket = io({ auth });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('state', st => {
      setState(st);
      setOffset(st.serverTime - Date.now());
    });
    return () => socket.disconnect();
  }, []);

  return { state, connected, offset, socketRef };
}

export function useCountdown(state, offset) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const round = state?.round;
  if (!round || round.status !== 'open') return 0;
  if (state.paused) return Math.ceil((round.remainingMs ?? 0) / 1000);
  return Math.max(0, Math.ceil((round.endsAt - (now + offset)) / 1000));
}

export function ConnectionBadge({ connected }) {
  return (
    <span className={`badge ${connected ? 'on' : 'off'}`}>
      {connected ? 'Conectado' : 'Sin conexión · reconectando…'}
    </span>
  );
}