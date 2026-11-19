import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useStation, useCountdown, ConnectionBadge } from '../socket.jsx';
import { speak } from '../speech.js';

let ytPromise;
function loadYouTube() {
  if (!ytPromise) {
    ytPromise = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('No se pudo cargar el reproductor de YouTube'));
      document.head.appendChild(script);
    });
  }
  return ytPromise;
}

const fmtDate = v => new Date(v).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const formatTime = value => {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

export default function Screen() {
  const key = new URLSearchParams(window.location.search).get('key');
  const [started, setStarted] = useState(false);
  if (!started) {
    return (
      <div className="screen start">
        <button onClick={() => setStarted(true)}>Preparar pantalla</button>
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
  const speechUtterance = useRef(null);
  const audioUnlockedRef = useRef(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playbackMessage, setPlaybackMessage] = useState(null);
  const [position, setPosition] = useState({ current: 0, duration: 0 });
  const [authError, setAuthError] = useState(null);

  const emit = (event, data) => socketRef.current?.emit(event, data);

  function setSoundUnlocked(value) {
    audioUnlockedRef.current = value;
    setAudioUnlocked(value);
  }

  function activateAudio() {
    const current = cmd.current;
    if (current?.type !== 'play') {
      setPlaybackMessage('La canción todavía no está lista para reproducirse.');
      return;
    }

    setPlaybackMessage(null);
    if (current.provider === 'licensed_audio') {
      audio.current.play().then(() => setSoundUnlocked(true)).catch(err => {
        if (err.name === 'NotAllowedError') {
          setPlaybackMessage('El navegador bloqueó el audio. Vuelve a tocar «Activar audio».');
        } else {
          setPlaybackMessage(`No se pudo reproducir el audio: ${err.message}`);
          emit('playerError', { playId: current.playId, message: err.message });
        }
      });
      return;
    }

    if (!player.current?.playVideo) {
      setPlaybackMessage('El reproductor de YouTube todavía está cargando.');
      return;
    }
    player.current.unMute?.();
    player.current.playVideo();
    setSoundUnlocked(true);
  }

  function startAnnouncement(c) {
    try {
      speechUtterance.current = speak(c.text, {
        onEnd: () => {
          if (cmd.current?.type === 'announcement' && cmd.current.id === c.id) {
            speechUtterance.current = null;
            emit('announcementEnded', { id: c.id });
          }
        },
        onError: event => {
          if (cmd.current?.type === 'announcement' && cmd.current.id === c.id) {
            emit('playerError', { id: c.id, message: `No se pudo reproducir la voz (${event.error})` });
          }
        },
      });
    } catch (err) {
      emit('playerError', { id: c.id, message: err.message });
    }
  }

  function apply(c) {
    const p = player.current;
    const a = audio.current;
    if (!c) return;
    switch (c.type) {
      case 'play':
        window.speechSynthesis?.cancel();
        speechUtterance.current = null;
        setPlaybackMessage(null);
        a.pause();
        if (c.provider === 'licensed_audio') {
          p?.stopVideo();
          a.src = c.streamRef;
          if (!c.paused && audioUnlockedRef.current) {
            a.play().catch(err => {
              setPlaybackMessage(`No se pudo reproducir el audio: ${err.message}`);
              emit('playerError', { playId: c.playId, message: err.message });
            });
          }
        } else if (p?.loadVideoById) {
          a.removeAttribute('src');
          a.load();
          if (c.paused) p.cueVideoById(c.streamRef);
          else if (audioUnlockedRef.current) p.loadVideoById(c.streamRef);
          else p.cueVideoById(c.streamRef);
        }
        break;
      case 'announcement':
        p?.stopVideo();
        a.pause();
        a.removeAttribute('src');
        a.load();
        window.speechSynthesis?.cancel();
        speechUtterance.current = null;
        if (!c.paused) startAnnouncement(c);
        break;
      case 'pause':
        p?.pauseVideo();
        a.pause();
        window.speechSynthesis?.pause();
        break;
      case 'resume':
        if (cmd.current?.type === 'announcement') {
          if (speechUtterance.current) window.speechSynthesis?.resume();
          else startAnnouncement(cmd.current);
        }
        else if (cmd.current?.provider === 'licensed_audio' && audioUnlockedRef.current) {
          a.play().catch(err => emit('playerError', { playId: cmd.current.playId, message: err.message }));
        } else if (audioUnlockedRef.current) p?.playVideo();
        else setPlaybackMessage('Toca «Activar audio» para continuar la reproducción.');
        break;
      default:
        p?.stopVideo();
        a.pause();
        a.removeAttribute('src');
        a.load();
        window.speechSynthesis?.cancel();
        speechUtterance.current = null;
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
        setPlaybackMessage('No se pudo cargar el audio licenciado.');
        emit('playerError', { playId: cmd.current.playId, message: 'No se pudo cargar el audio licenciado' });
      }
    };

    loadYouTube().then(YT => {
      if (!ytBox.current) return;
      const el = document.createElement('div');
      ytBox.current.appendChild(el);
      player.current = new YT.Player(el, {
        // Las políticas del reproductor de YouTube exigen un tamaño mínimo de 200×200 px y que sea visible.
        width: 356,
        height: 200,
        playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1 },
        events: {
          onReady: () => {
            setPlayerReady(true);
            apply(cmd.current);
          },
          onStateChange: e => {
            if (e.data === YT.PlayerState.PLAYING) {
              setSoundUnlocked(true);
              setPlaybackMessage(null);
            }
            if (e.data === YT.PlayerState.ENDED && cmd.current?.type === 'play') emit('songEnded', { playId: cmd.current.playId });
          },
          onError: e => {
            if (cmd.current?.type === 'play') {
              const message = `YouTube código ${e.data}`;
              setPlaybackMessage(`No se pudo reproducir este video (${e.data}).`);
              emit('playerError', { playId: cmd.current.playId, message });
            }
          },
          onAutoplayBlocked: () => {
            setSoundUnlocked(false);
            setPlaybackMessage('El navegador bloqueó el inicio automático. Toca «Activar audio».');
          },
        },
      });
    }).catch(err => setPlaybackMessage(err.message));

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
      window.speechSynthesis?.cancel();
      player.current?.destroy?.();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (cmd.current?.type !== 'play') {
        setPosition({ current: 0, duration: 0 });
        return;
      }

      if (cmd.current.provider === 'licensed_audio') {
        const audioPlayer = audio.current;
        setPosition({
          current: Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0,
          duration: Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0,
        });
      } else if (player.current?.getCurrentTime && player.current?.getDuration) {
        setPosition({
          current: player.current.getCurrentTime() || 0,
          duration: player.current.getDuration() || 0,
        });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (authError) return <div className="screen start"><p>{authError}</p></div>;

  const round = state?.round;
  const total = round ? Object.values(round.counts).reduce((x, y) => x + y, 0) : 0;
  const progress = position.duration ? Math.min(100, (position.current / position.duration) * 100) : 0;
  const voteUrl = `${window.location.origin}/vote`;

  return (
    <div className="screen">
      <header className="screen-now">
        <div className="now-playing">
          {state?.nowPlaying?.thumbnailUrl && (
            <img className="now-playing-thumbnail" src={state.nowPlaying.thumbnailUrl} alt={`Miniatura de ${state.nowPlaying.title}`} />
          )}
          <div>
            <span className="label">Sonando ahora</span>
            <h1>{state?.nowPlaying?.title ?? 'En espera'}</h1>
            <h2>{state?.nowPlaying?.artist ?? ''}</h2>
            <div className="track-progress" aria-label="Progreso de la canción">
              <div className="track-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}>
                <div style={{ width: `${progress}%` }} />
              </div>
              <div className="track-progress-time">
                <span>{formatTime(position.current)}</span>
                <span>{position.duration ? formatTime(position.duration) : '--:--'}</span>
              </div>
            </div>
          </div>
        </div>
        <ConnectionBadge connected={connected} />
      </header>

      <main className="screen-main">
        <section className="screen-round">
          {(playbackMessage || state?.lastError) && (
            <div className="screen-error" role="status">{playbackMessage || state.lastError}</div>
          )}
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
          {state?.phase === 'playing' && !audioUnlocked && (
            <button className="screen-audio-button" disabled={state.nowPlaying?.provider !== 'licensed_audio' && !playerReady} onClick={activateAudio}>
              {state.nowPlaying?.provider !== 'licensed_audio' && !playerReady ? 'Cargando reproductor…' : 'Activar audio'}
            </button>
          )}
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