import { useEffect, useState } from 'react';
import { useStation, useCountdown, ConnectionBadge } from '../socket.jsx';

export default function Vote() {
  const { state, connected, offset } = useStation({});
  const secs = useCountdown(state, offset);
  const [mine, setMine] = useState({});
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const round = state?.round;

  useEffect(() => {
    setError(null);
    if (round?.id) fetch('/api/vote/mine').then(r => r.json()).then(setMine).catch(() => {});
  }, [round?.id]);

  const open = round?.status === 'open' && !state.paused && secs > 0;
  const voted = round && mine.roundId === round.id ? round.candidates.find(c => c.id === mine.songId) : null;

  async function vote(songId) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error);
      else setMine({ roundId: json.roundId, songId });
    } catch {
      setError('Sin conexión, intenta de nuevo');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="vote">
      <header className="row">
        <h1>Radio del campus</h1>
        <ConnectionBadge connected={connected} />
      </header>
      {!state ? (
        <p>Conectando…</p>
      ) : (
        <>
          <p className="muted">
            Sonando: {state.nowPlaying ? `${state.nowPlaying.title} — ${state.nowPlaying.artist}` : '—'}
          </p>
          {!round && <p>No hay una votación activa en este momento.</p>}
          {round && (
            <>
              <p className="timer-small">
                {open ? `Quedan ${secs} s` : state.paused ? 'Votación en pausa' : 'Ronda cerrada'}
              </p>
              {round.candidates.map(c => (
                <button
                  key={c.id}
                  className={`option ${voted?.id === c.id ? 'chosen' : ''}`}
                  disabled={!open || !!voted || sending}
                  onClick={() => vote(c.id)}
                >
                  <strong>{c.title}</strong>
                  <span>{c.artist}</span>
                </button>
              ))}
              {voted && <p className="ok">¡Voto registrado por «{voted.title}»!</p>}
              {round.status === 'closed' && round.winner && (
                <p className="ok">Ganó: {round.winner.title} ({round.resolution})</p>
              )}
            </>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}