import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useStation, useCountdown, ConnectionBadge } from '../socket.jsx';

let ytPromise;
function loadYouTube() {
  if (!ytPromise) {
    ytPromise = new Promise(resolve => {
      if (window.YT?.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    });
  }
  return ytPromise;
}

const fmtDate = v => new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

export default function Screen() {
  const key = new URLSearchParams(window.location.search).get('key');
  const [started, setStarted] = useState(false);
  if (!started) {
    return (
      <div className="screen start">
        <button onClick={() => setStarted(true)}>Activar pantalla</button>
      </div>
    );
  }
  return <ScreenLive screenKey={key} />;
}

function ScreenLive({ screenKey }) {
  const { state, connected, offset, socketRef } = useStation({ role: 'screen', key: screenKey });
  const secs = useCountdown(state, offset);
  const ytBox = useRef(null);
  const player = useRef(null);
  const audio = useRef(new Audio());
  const cmd = useRef(null);
  const [authError, setAuthError] = useState(null);

  const emit = (event, data) => socketRef.current?.emit(event, data);

  function apply(c) {
    const p = player.current;
    const a = audio.current;
    if (!c) return;
    switch (c.type) {
      case 'play':
        a.pause();
        if (c.provider === 'licensed_audio') {
          p?.stopVideo();
          a.src = c.streamRef;
          if (!c.paused) {
            a.play().catch(err => emit('playerError', { playId: c.playId, message: err.message }));
          }
        } else if (p?.loadVideoById) {
          a.removeAttribute('src');
          a.load();
          if (c.paused) p.cueVideoById(c.streamRef);
          else p.loadVideoById(c.streamRef);
        }
        break;
      case 'announcement':
        p?.stopVideo();
        a.src = c.url;
        if (!c.paused) a.play().catch(err => emit('playerError', { id: c.id, message: err.message }));
        break;
      case 'pause':
        p?.pauseVideo();
        a.pause();
        break;
      case 'resume':
        if (cmd.current?.type === 'announcement') a.play().catch(() => {});
        else if (cmd.current?.provider === 'licensed_audio') a.play().catch(err => emit('playerError', { playId: cmd.current.playId, message: err.message }));
        else p?.playVideo();
        break;
      default:
        p?.stopVideo();
        a.pause();
        a.removeAttribute('src');
        a.load();
    }
  }

  useEffect(() => {
    const a = audio.current;
    a.onended = () => {
      if (cmd.current?.type === 'announcement') emit('announcementEnded', { id: cmd.current.id });
      else if (cmd.current?.type === 'play' && cmd.current.provider === 'licensed_audio') {
        emit('songEnded', { playId: cmd.current.playId });
      }
    };
    a.onerror = () => {
      if (cmd.current?.type === 'announcement') emit('playerError', { id: cmd.current.id, message: 'No se pudo cargar el audio del anuncio' });
      else if (cmd.current?.type === 'play' && cmd.current.provider === 'licensed_audio') {
        emit('playerError', { playId: cmd.current.playId, message: 'No se pudo cargar el audio licenciado' });
      }
    };

    loadYouTube().then(YT => {
      if (!ytBox.current) return;
      const el = document.createElement('div');
      ytBox.current.appendChild(el);
      player.current = new YT.Player(el, {
        width: 320,
        height: 180,
        playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1 },
        events: {
          onReady: () => apply(cmd.current),
          onStateChange: e => {
            if (e.data === YT.PlayerState.ENDED && cmd.current?.type === 'play') emit('songEnded', { playId: cmd.current.playId });
          },
          onError: e => {
            if (cmd.current?.type === 'play') emit('playerError', { playId: cmd.current.playId, message: `YouTube código ${e.data}` });
          },
        },
      });
    });

    const socket = socketRef.current;
    const onCommand = c => {
      if (c.type === 'pause' || c.type === 'resume') {
        if (cmd.current) cmd.current = { ...cmd.current, paused: c.type === 'pause' };
      } else {
        cmd.current = c;
      }
      apply(c);
    };
    socket.on('command', onCommand);
    socket.on('authError', setAuthError);
    return () => {
      socket.off('command', onCommand);
      socket.off('authError', setAuthError);
      a.pause();
      player.current?.destroy?.();
    };
  }, []);

  if (authError) return <div className="screen start"><p>{authError}</p></div>;

  const round = state?.round;
  const total = round ? Object.values(round.counts).reduce((x, y) => x + y, 0) : 0;
  const voteUrl = `${window.location.origin}/vote`;

  return (
    <div className="screen">
      <header className="screen-now">
        <div>
          <span className="label">Sonando ahora</span>
          <h1>{state?.nowPlaying?.title ?? 'En espera'}</h1>
          <h2>{state?.nowPlaying?.artist ?? ''}</h2>
        </div>
        <ConnectionBadge connected={connected} />
      </header>

      <main className="screen-main">
        <section className="screen-round">
          {state?.phase === 'announcement' && <div className="banner">Aviso: {state.announcement?.text}</div>}
          {state?.paused && <div className="banner">Programación en pausa</div>}
          {round ? (
            <>
              <div className="label">{round.status === 'open' ? 'Vota por la siguiente canción' : 'Resultado de la ronda'}</div>
              <div className="candidates">
                {round.candidates.map(c => {
                  const n = round.counts[c.id] ?? 0;
                  const pct = total ? Math.round((n * 100) / total) : 0;
                  return (
                    <div key={c.id} className={`candidate ${round.winner?.id === c.id ? 'winner' : ''}`}>
                      <strong>{c.title}</strong>
                      <span>{c.artist}</span>
                      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
                      <span className="count">{n} votos · {pct}%</span>
                    </div>
                  );
                })}
              </div>
              {round.status === 'open'
                ? <div className="timer">{secs}s</div>
                : <div className="result">Siguiente: <strong>{round.winner?.title}</strong> ({round.resolution})</div>}
            </>
          ) : (
            <p className="muted">Preparando la siguiente ronda…</p>
          )}
        </section>

        <aside className="screen-side">
          <QRCodeSVG value={voteUrl} size={220} includeMargin />
          <p className="muted">{voteUrl.replace(/^https?:\/\//, '')}</p>
          <div ref={ytBox} className="yt-box" />
          {state?.nowPlaying?.provider === 'licensed_audio' && <p className="player-source">Audio licenciado</p>}
          <h3>Próximos eventos</h3>
          <ul>
            {state?.info.events.map(e => <li key={`${e.name}-${e.starts_at}`}>{e.name} · {fmtDate(e.starts_at)}</li>)}
          </ul>
          <h3>Avisos</h3>
          <ul>
            {state?.info.notices.map(n => <li key={n}>{n}</li>)}
          </ul>
        </aside>
      </main>
    </div>
  );
}