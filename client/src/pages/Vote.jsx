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

  const now = state?.nowPlaying;
  const fraction = round?.durationMs ? Math.max(0, Math.min(1, (secs * 1000) / round.durationMs)) : 0;

  return (
    <div className="vote">
      <header className="vote-head">
        <div className="brand">
          <span className={`on-air-dot ${connected ? 'live' : ''}`} />
          <h1>Radio del campus</h1>
        </div>
        {!connected && <ConnectionBadge connected={connected} />}
      </header>

      {!state ? (
        <p className="hint">Conectando con la radio…</p>
      ) : (
        <>
          <section className="now-mini" aria-label="Sonando ahora">
            {now?.thumbnailUrl && <img src={now.thumbnailUrl} alt="" />}
            <div>
              <span>{state.phase === 'announcement' ? (state.announcement?.kind === 'dj' ? 'Habla el locutor' : 'Aviso') : 'Sonando ahora'}</span>
              <strong>{now ? now.title : 'En espera'}</strong>
              {now && <small>{now.artist}</small>}
            </div>
          </section>

          {!round && <p className="hint">No hay una votación abierta ahora. Vuelve en cuanto empiece la siguiente canción.</p>}
          {round && (
            <section className="ballot">
              <div className="ballot-head">
                <h2>{open ? (voted ? 'Tu voto ya cuenta' : '¿Qué suena después?') : round.status === 'closed' ? 'Votación cerrada' : 'Votación en pausa'}</h2>
                {open && <span className="secs">{secs} s</span>}
              </div>
              {open && <div className="time-left" aria-hidden="true"><div style={{ transform: `scaleX(${fraction})` }} /></div>}
              {round.candidates.map(c => (
                <button
                  key={c.id}
                  className={`option ${voted?.id === c.id ? 'chosen' : ''} ${round.winner?.id === c.id ? 'won' : ''}`}
                  disabled={!open || !!voted || sending}
                  onClick={() => vote(c.id)}
                >
                  {c.thumbnailUrl && <img src={c.thumbnailUrl} alt="" />}
                  <span className="option-text">
                    <strong>{c.title}</strong>
                    <span>{c.artist}</span>
                  </span>
                  {voted?.id === c.id && <span className="tick" aria-label="Tu voto">✓</span>}
                </button>
              ))}
              {voted && open && <p className="ok">Votaste por «{voted.title}». El resultado sale al terminar la cuenta.</p>}
              {round.status === 'closed' && round.winner && (
                <p className="ok">Ganó «{round.winner.title}». Suena en cuanto termine esta canción.</p>
              )}
            </section>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
