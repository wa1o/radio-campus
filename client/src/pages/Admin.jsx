import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../api.js';
import { useStation, ConnectionBadge } from '../socket.jsx';
import { speak, spanishVoices } from '../speech.js';

const ENERGY = [['', '—'], ['low', 'Baja'], ['medium', 'Media'], ['high', 'Alta']];
const EVENT_TYPES = [['exam', 'Exámenes'], ['holiday', 'Festividad'], ['event', 'Evento']];
const EVENT_LABEL = Object.fromEntries(EVENT_TYPES);
const PHASES = { idle: 'En espera', playing: 'Reproduciendo', announcement: 'Anuncio' };
const NAV = [
  ['', 'Control'], ['songs', 'Canciones'], ['playlists', 'Listas'], ['rules', 'Reglas'],
  ['events', 'Eventos'], ['announcements', 'Anuncios'], ['stats', 'Estadísticas'], ['settings', 'Ajustes'],
];

const fmt = v => (v ? new Date(v).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const pad = n => String(n).padStart(2, '0');
const toLocalInput = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const getPath = (obj, path) => path.split('.').reduce((v, k) => v?.[k], obj);
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach(k => { cur[k] ??= {}; cur = cur[k]; });
  cur[keys.at(-1)] = value;
}

function toForm(row, fields) {
  const form = { id: row?.id };
  for (const d of fields) {
    const v = row ? getPath(row, d.path) : d.default;
    if (d.type === 'tags') form[d.path] = (v ?? []).join(', ');
    else if (d.type === 'datetime') form[d.path] = toLocalInput(v);
    else if (d.type === 'time') form[d.path] = (v ?? '').slice(0, 5);
    else if (d.type === 'checkbox') form[d.path] = !!v;
    else form[d.path] = v ?? '';
  }
  return form;
}

function toBody(form, fields) {
  const body = {};
  for (const d of fields) {
    const v = form[d.path];
    let out;
    if (d.type === 'tags') out = v.split(',').map(s => s.trim()).filter(Boolean);
    else if (d.type === 'number') out = v === '' ? null : Number(v);
    else if (d.type === 'datetime') out = v ? new Date(v).toISOString() : null;
    else if (d.type === 'checkbox') out = v;
    else out = v === '' ? null : v;
    setPath(body, d.path, out);
  }
  return body;
}

function Field({ d, value, onChange }) {
  if (d.type === 'checkbox') {
    return <label className="check"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} /> {d.label}</label>;
  }
  const common = { value, required: d.required, onChange: e => onChange(e.target.value) };
  const inputType = { number: 'number', datetime: 'datetime-local', time: 'time' }[d.type] || 'text';
  const resolvedInputType = d.type === 'url' ? 'url' : inputType;
  return (
    <label>
      {d.label}
      {d.type === 'select' ? (
        <select {...common}>{d.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      ) : d.type === 'textarea' ? (
        <textarea rows={3} {...common} />
      ) : (
        <input type={resolvedInputType} step={d.type === 'number' ? 'any' : undefined} {...common} />
      )}
    </label>
  );
}

function Crud({ resource, title, fields, columns, actions, refreshKey = 0, headerExtra = null }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);

  const load = () => api(`/admin/${resource}`).then(setRows).catch(e => setError(e.message));
  useEffect(() => { load(); }, [resource, refreshKey]);

  const run = async fn => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    }
  };
  const save = e => {
    e.preventDefault();
    run(async () => {
      await api(`/admin/${resource}${form.id ? `/${form.id}` : ''}`, { method: form.id ? 'PUT' : 'POST', body: toBody(form, fields) });
      setForm(null);
    });
  };
  const remove = id => {
    if (confirm('¿Eliminar este registro?')) run(() => api(`/admin/${resource}/${id}`, { method: 'DELETE' }));
  };

  return (
    <section className="crud">
      <div className="section-head">
        <h2>{title} <span className="count">{rows.length}</span></h2>
        <div className="head-actions">
          {headerExtra?.(run)}
          <button onClick={() => setForm(toForm(null, fields))}>Nuevo</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {form && (
        <form className="card form" onSubmit={save}>
          {fields.map(d => {
            const field = d.path === 'stream_ref'
              ? {
                ...d,
                type: form.provider === 'licensed_audio' ? 'url' : 'text',
                label: form.provider === 'licensed_audio' ? 'URL directa del audio licenciado' : 'Enlace o ID del video de YouTube',
              }
              : d;
            return <Field key={field.path} d={field} value={form[field.path]} onChange={v => setForm({ ...form, [field.path]: v })} />;
          })}
          <div className="row">
            <button type="submit">Guardar</button>
            <button type="button" className="secondary" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}
      <div className="table-wrap">
      <table>
        <thead><tr>{columns.map(([h]) => <th key={h}>{h}</th>)}<th /></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td className="empty" colSpan={columns.length + 1}>Todavía no hay registros. Usa «Nuevo» para agregar el primero.</td></tr>
          ) : rows.map(row => (
            <tr key={row.id}>
              {columns.map(([h, fn]) => <td key={h}>{fn(row)}</td>)}
              <td className="actions">
                {actions?.(row, run)}
                <button className="secondary" onClick={() => setForm(toForm(row, fields))}>Editar</button>
                <button className="danger" onClick={() => remove(row.id)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

const songFields = [
  { path: 'title', label: 'Título', required: true },
  { path: 'artist', label: 'Artista', required: true },
  {
    path: 'provider',
    label: 'Proveedor de música',
    type: 'select',
    options: [['youtube', 'YouTube'], ['licensed_audio', 'Audio licenciado (URL directa)']],
    default: 'youtube',
  },
  { path: 'stream_ref', label: 'Enlace o ID del video de YouTube', required: true },
  { path: 'genre', label: 'Género' },
  { path: 'energy', label: 'Energía', type: 'select', options: ENERGY },
  { path: 'mood', label: 'Ambiente' },
  { path: 'themes', label: 'Temáticas (separadas por coma)', type: 'tags' },
  { path: 'restrictions', label: 'Restricciones (separadas por coma)', type: 'tags' },
  { path: 'active', label: 'Activa', type: 'checkbox', default: true },
];

function usePlaylists() {
  const [playlists, setPlaylists] = useState([]);
  useEffect(() => { api('/admin/playlists').then(setPlaylists).catch(() => {}); }, []);
  return playlists;
}

const fmtDuration = s => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const tagLine = s => [s.genre, { low: 'energía baja', medium: 'energía media', high: 'energía alta' }[s.energy], s.mood,
  s.restrictions?.includes('explicit') && 'explícita', s.restrictions?.includes('revisar') && 'por revisar']
  .filter(Boolean).join(', ') || 'sin etiquetas sugeridas';

function SongAdder({ onAdded }) {
  const [mode, setMode] = useState('links');
  const [playlistId, setPlaylistId] = useState('');
  const playlists = usePlaylists();
  const modes = [['links', 'Pegar enlaces'], ['search', 'Buscar en YouTube'], ['playlist', 'Playlist completa']];
  return (
    <section className="card adder">
      <div className="adder-head">
        <h2>Agregar canciones</h2>
        <p>Pega enlaces, busca o importa una playlist. El título, el artista y las etiquetas se llenan solos; luego puedes corregirlos.</p>
      </div>
      <div className="tabs" role="tablist">
        {modes.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={mode === key} className={mode === key ? 'tab active' : 'tab'} onClick={() => setMode(key)}>{label}</button>
        ))}
      </div>
      {mode !== 'playlist' && (
        <label className="inline">Agregar también a la lista
          <select value={playlistId} onChange={e => setPlaylistId(e.target.value)}>
            <option value="">— solo al catálogo —</option>
            {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {mode === 'links' && <LinkAdder playlistId={playlistId} onAdded={onAdded} />}
      {mode === 'search' && <SearchAdder playlistId={playlistId} onAdded={onAdded} />}
      {mode === 'playlist' && <PlaylistImporter onImported={onAdded} />}
    </section>
  );
}

function LinkAdder({ playlistId, onAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const out = await api('/admin/import/youtube-videos', { method: 'POST', body: { text, playlistId: playlistId || null } });
      setResult(out);
      if (!out.failed.length) setText('');
      onAdded();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="adder-body" onSubmit={submit}>
      <label>Enlaces o IDs de YouTube, uno por línea
        <textarea rows={5} value={text} onChange={e => setText(e.target.value)} placeholder={'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…'} required />
      </label>
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? 'Agregando…' : 'Agregar canciones'}</button>
        <span className="muted">Acepta enlaces de YouTube, YouTube Music y Shorts.</span>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && (
        <div className="notice success" role="status">
          <p>{result.added.length} agregadas{result.alreadyInCatalog ? `, ${result.alreadyInCatalog} ya estaban en el catálogo` : ''}.</p>
          {!!result.added.length && <ul>{result.added.map(s => <li key={s.id}><b>{s.title}</b> — {s.artist} <span className="muted">({tagLine(s)})</span></li>)}</ul>}
          {!!result.failed.length && <ul className="failed">{result.failed.map(f => <li key={f.ref}>{f.ref}: {f.reason}</li>)}</ul>}
        </div>
      )}
    </form>
  );
}

function SearchAdder({ playlistId, onAdded }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const search = async e => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      setResults(await api(`/admin/youtube/search?q=${encodeURIComponent(q)}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const add = async song => {
    setError(null);
    try {
      await api('/admin/youtube/add', { method: 'POST', body: { song, playlistId: playlistId || null } });
      setResults(list => list.map(s => (s.stream_ref === song.stream_ref ? { ...s, inCatalog: true } : s)));
      onAdded();
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="adder-body">
      <form className="search-row" onSubmit={search}>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Canción o artista, p. ej. «Natalia Lafourcade Hasta la raíz»" required />
        <button type="submit" disabled={busy}>{busy ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {error && <p className="notice error" role="alert">{error}</p>}
      {results && !results.length && <p className="muted">Sin resultados que se puedan reproducir en la pantalla.</p>}
      {!!results?.length && (
        <ul className="results">
          {results.map(s => (
            <li key={s.stream_ref}>
              <img src={s.thumbnailUrl} alt="" />
              <div>
                <strong>{s.title}</strong>
                <span>{s.artist}{s.seconds ? ` · ${fmtDuration(s.seconds)}` : ''}</span>
                <small>{tagLine(s)}</small>
              </div>
              {s.inCatalog
                ? <span className="added">En el catálogo</span>
                : <button className="secondary" onClick={() => add(s)}>Agregar</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Cada búsqueda usa 100 de las 10 000 unidades diarias gratuitas de YouTube.</p>
    </div>
  );
}

function PlaylistImporter({ onImported }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const importPlaylist = async e => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const imported = await api('/admin/import/youtube-playlist', { method: 'POST', body: { url } });
      setResult(imported);
      onImported();
      setUrl('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="adder-body" onSubmit={importPlaylist}>
      <label>Enlace de una playlist pública de YouTube o YouTube Music
        <span className="search-row">
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=…" required />
          <button type="submit" disabled={busy}>{busy ? 'Importando…' : 'Importar playlist'}</button>
        </span>
      </label>
      <p className="muted">Se crea una lista con el mismo nombre (hasta 500 canciones). Los videos con restricción de edad quedan marcados como explícitos, pero revisa las letras.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && (
        <p className="notice success" role="status" aria-live="polite">
          «{result.playlistName}»: {result.added} nuevas, {result.alreadyInCatalog} ya existentes y {result.skipped} omitidas.
          {result.explicitRestricted > 0 && ` ${result.explicitRestricted} quedaron marcadas como explícitas.`}
          {result.truncated && ' Solo se importaron las primeras 500.'}
          {' '}<NavLink to="/admin/playlists">Ver listas</NavLink>
        </p>
      )}
    </form>
  );
}

function Songs() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [tagMsg, setTagMsg] = useState(null);
  const autotag = run => run(async () => {
    setTagMsg('Completando etiquetas…');
    const out = await api('/admin/songs/autotag', { method: 'POST' }).catch(err => { setTagMsg(null); throw err; });
    setTagMsg(out.updated ? `Se completaron etiquetas en ${out.updated} canciones.${out.pending ? ` ${out.pending} siguen sin género: edítalas a mano.` : ''}` : 'No había etiquetas que completar automáticamente.');
  }).catch(() => setTagMsg(null));
  const aiTag = run => run(async () => {
    setTagMsg('La IA está revisando el catálogo…');
    const out = await api('/admin/songs/ai-tag', { method: 'POST' }).catch(err => { setTagMsg(null); throw err; });
    setTagMsg(out.tagged
      ? `La IA etiquetó ${out.tagged} canciones: ${out.explicit} explícitas y ${out.review} por revisar.${out.pending ? ` Faltan ${out.pending}; vuelve a pulsar el botón.` : ''}`
      : 'Todas las canciones ya fueron revisadas por la IA.');
  }).catch(() => setTagMsg(null));
  return (
    <>
      <SongAdder onAdded={() => setRefreshKey(key => key + 1)} />
      {tagMsg && <p className="notice success">{tagMsg}</p>}
      <Crud resource="songs" title="Canciones" fields={songFields} refreshKey={refreshKey}
        headerExtra={run => (
          <>
            <button className="secondary" onClick={() => aiTag(run)} title="Llena etiquetas vacías, temáticas de época y marca explícitas o dudosas">Etiquetar con IA</button>
            <button className="secondary" onClick={() => autotag(run)} title="Llena género, energía y ambiente vacíos">Completar etiquetas</button>
          </>
        )}
        columns={[
          ['', s => (s.provider === 'youtube' ? <img className="thumb" src={`https://i.ytimg.com/vi/${s.stream_ref}/default.jpg`} alt="" /> : '♪')],
          ['Título', s => <><strong>{s.title}</strong><br /><span className="muted">{s.artist}</span></>],
          ['Género', s => s.genre ?? '—'], ['Energía', s => ({ low: 'Baja', medium: 'Media', high: 'Alta' }[s.energy] ?? '—')],
          ['Ambiente', s => s.mood ?? '—'], ['Restricciones', s => s.restrictions?.join(', ') || '—'],
          ['Activa', s => (s.active ? 'Sí' : 'No')],
        ]} />
    </>
  );
}

const ruleFields = [
  { path: 'name', label: 'Nombre', required: true },
  { path: 'priority', label: 'Prioridad (mayor gana)', type: 'number', default: 0 },
  { path: 'active', label: 'Activa', type: 'checkbox', default: true },
  { path: 'condition.time_from', label: 'Desde (hora)', type: 'time' },
  { path: 'condition.time_to', label: 'Hasta (hora)', type: 'time' },
  { path: 'condition.temp_min', label: 'Temperatura mínima °C', type: 'number' },
  { path: 'condition.temp_max', label: 'Temperatura máxima °C', type: 'number' },
  { path: 'condition.event_type', label: 'Con evento activo', type: 'select', options: [['', '—'], ...EVENT_TYPES] },
  { path: 'condition.exclusive', label: 'Exclusiva (ignora las reglas de menor prioridad)', type: 'checkbox', default: false },
  { path: 'filters.genres', label: 'Géneros permitidos', type: 'tags' },
  { path: 'filters.energy', label: 'Energías permitidas (low, medium, high)', type: 'tags' },
  { path: 'filters.moods', label: 'Ambientes permitidos', type: 'tags' },
  { path: 'filters.themes', label: 'Temáticas', type: 'tags' },
];

const eventFields = [
  { path: 'name', label: 'Nombre', required: true },
  { path: 'type', label: 'Tipo', type: 'select', options: EVENT_TYPES, default: 'event' },
  { path: 'starts_at', label: 'Inicio', type: 'datetime', required: true },
  { path: 'ends_at', label: 'Fin', type: 'datetime', required: true },
];

const announcementFields = [
  { path: 'text', label: 'Texto del anuncio', type: 'textarea', required: true },
  { path: 'valid_from', label: 'Vigente desde', type: 'datetime' },
  { path: 'valid_to', label: 'Vigente hasta', type: 'datetime' },
  { path: 'hour_from', label: 'Horario desde', type: 'time' },
  { path: 'hour_to', label: 'Horario hasta', type: 'time' },
  { path: 'every_n_songs', label: 'Frecuencia (cada N canciones)', type: 'number', default: 3 },
];

function describeCondition(c) {
  const parts = [
    c.time_from && `${c.time_from}–${c.time_to ?? ''}`,
    (c.temp_min != null || c.temp_max != null) && `${c.temp_min ?? '…'}–${c.temp_max ?? '…'} °C`,
    c.event_type && `evento: ${EVENT_LABEL[c.event_type] ?? c.event_type}`,
  ].filter(Boolean);
  const text = parts.join(' · ') || 'siempre';
  return c.exclusive ? `${text} · exclusiva` : text;
}

function describeFilters(f) {
  return Object.entries(f).filter(([, v]) => v?.length).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') || 'todo el catálogo';
}

function announcementActions(row, run) {
  const post = path => run(() => api(`/admin/announcements/${row.id}/${path}`, { method: 'POST' }));
  return (
    <>
      <button onClick={() => run(() => speak(row.text))}>Probar voz</button>
      {row.status === 'approved'
        ? <button onClick={() => post('unapprove')}>Retirar</button>
        : <button onClick={() => post('approve')}>Aprobar</button>}
    </>
  );
}

function Control() {
  const { state, connected } = useStation({});
  const [songs, setSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [next, setNext] = useState('');
  const [playlistId, setPlaylistId] = useState('');
  const [error, setError] = useState(null);
  const [playlistMessage, setPlaylistMessage] = useState(null);

  useEffect(() => {
    Promise.all([api('/admin/songs'), api('/admin/playlists')])
      .then(([songList, playlistList]) => {
        setSongs(songList);
        setPlaylists(playlistList);
      })
      .catch(e => setError(e.message));
  }, []);
  const act = (action, body) => api(`/admin/control/${action}`, { method: 'POST', body })
    .then(() => setError(null))
    .catch(e => setError(e.message));
  const queuePlaylist = async () => {
    setError(null);
    setPlaylistMessage(null);
    try {
      const updated = await api(`/admin/playlists/${playlistId}/play`, { method: 'POST' });
      setPlaylistMessage(updated.playlistPlayback.current
        ? `«${updated.playlistPlayback.name}» ya está sonando.`
        : `«${updated.playlistPlayback.name}» empezará en la siguiente transición.`);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!state) return <p>Conectando…</p>;
  const round = state.round;
  const upcoming = state.forcedNext ?? round?.winner;
  const ctx = state.context;

  const total = round ? Object.values(round.counts).reduce((x, y) => x + y, 0) : 0;
  const speaking = state.phase === 'announcement' ? state.announcement : null;

  return (
    <section className="control">
      <div className="section-head">
        <h2>Control en vivo</h2>
        <div className="head-actions">
          <span className={`badge ${state.screenOnline ? 'on' : 'off'}`}>{state.screenOnline ? 'Pantalla conectada' : 'Pantalla desconectada'}</span>
          <ConnectionBadge connected={connected} />
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      {state.lastError && <p className="notice error">Último error: {state.lastError}</p>}
      {ctx?.simulated && <p className="notice error">Contexto simulado activo. Quítalo en Ajustes antes de operar.</p>}
      {ctx?.degraded && <p className="notice error">Sin datos de clima o calendario: se usa la lista de respaldo.</p>}

      <div className="live card">
        <div className="live-now">
          {state.nowPlaying?.thumbnailUrl && <img src={state.nowPlaying.thumbnailUrl} alt="" />}
          <div>
            <span className="muted">{speaking ? (speaking.kind === 'dj' ? 'Habla el locutor' : 'Aviso al aire') : `${PHASES[state.phase]}${state.paused ? ' · en pausa' : ''}`}</span>
            <strong>{state.nowPlaying ? state.nowPlaying.title : 'Nada sonando'}</strong>
            {state.nowPlaying && <span>{state.nowPlaying.artist}</span>}
            {speaking && <q>{speaking.text}</q>}
          </div>
        </div>
        <div className="live-buttons">
          {state.paused
            ? <button onClick={() => act('resume')}>Reanudar</button>
            : <button onClick={() => act('pause')}>Pausar</button>}
          <button className="secondary" onClick={() => act('skip')}>Saltar</button>
          <button className="secondary" onClick={() => act('reroll')} title="Descarta la ronda abierta y propone dos opciones con el contexto actual">Regenerar ronda</button>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Ronda {round ? `#${round.id}` : ''}</h3>
          {round ? (
            <>
              <p className="muted">{round.status === 'open' ? `Abierta · ${total} ${total === 1 ? 'voto' : 'votos'}` : `Cerrada · ${round.resolution}`}</p>
              {round.candidates.map(c => {
                const n = round.counts[c.id] ?? 0;
                return (
                  <div key={c.id} className={`tally ${round.winner?.id === c.id ? 'won' : ''}`}>
                    <span>{c.title}</span><b>{n}</b>
                    <i style={{ width: `${total ? (n * 100) / total : 0}%` }} />
                  </div>
                );
              })}
            </>
          ) : <p className="muted">Sin ronda activa</p>}
        </div>
        <div className="card">
          <h3>Lo que sigue</h3>
          <p>{upcoming ? <><strong>{upcoming.title}</strong> — {upcoming.artist}{state.forcedNext && ' (elegida a mano)'}</> : <span className="muted">Pendiente de la votación</span>}</p>
          <div className="pick-next">
            <select value={next} onChange={e => setNext(e.target.value)} aria-label="Elegir la siguiente canción">
              <option value="">Elegir otra canción…</option>
              {songs.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.title} — {s.artist}</option>)}
            </select>
            <button className="secondary" disabled={!next} onClick={() => act('next', { songId: Number(next) })}>Fijar</button>
          </div>
          <div className="playlist-picker">
            <label>
              Escuchar una lista
              <select value={playlistId} onChange={e => setPlaylistId(e.target.value)}>
                <option value="">Selecciona una lista…</option>
                {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <button disabled={!playlistId} onClick={queuePlaylist}>Reproducir lista</button>
          </div>
          {playlistMessage && <p className="ok" role="status">{playlistMessage}</p>}
          {state.playlistPlayback && (
            <p className="muted" role="status">
              Lista {state.playlistPlayback.current ? 'en reproducción' : 'programada'}: <strong>{state.playlistPlayback.name}</strong>
              {state.playlistPlayback.remaining > 0 && ` · ${state.playlistPlayback.remaining} ${state.playlistPlayback.remaining === 1 ? 'canción restante' : 'canciones restantes'}`}
            </p>
          )}
        </div>
        <div className="card">
          <h3>Contexto</h3>
          {ctx ? (
            <dl className="facts">
              <dt>Hora</dt><dd>{ctx.hhmm}</dd>
              <dt>Temperatura</dt><dd>{ctx.temp != null ? `${Math.round(ctx.temp)} °C` : '—'}</dd>
              <dt>Eventos</dt><dd>{ctx.eventTypes.map(t => EVENT_LABEL[t] ?? t).join(', ') || 'ninguno'}</dd>
              <dt>Reglas</dt><dd>{state.ruleName ?? '—'}</dd>
            </dl>
          ) : <p className="muted">Se calcula al abrir la ronda.</p>}
        </div>
      </div>
    </section>
  );
}

function Playlists() {
  const [selected, setSelected] = useState(null);
  return (
    <>
      <Crud
        resource="playlists"
        title="Listas de reproducción"
        fields={[{ path: 'name', label: 'Nombre', required: true }]}
        columns={[['Nombre', p => p.name]]}
        actions={p => <button onClick={() => setSelected(p)}>Canciones</button>}
      />
      {selected && <PlaylistSongs key={selected.id} playlist={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function PlaylistSongs({ playlist, onClose }) {
  const [items, setItems] = useState([]);
  const [songs, setSongs] = useState([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState(null);
  const base = `/admin/playlists/${playlist.id}/songs`;

  const run = async fn => {
    setError(null);
    try {
      await fn();
      setItems(await api(base));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => { run(async () => setSongs(await api('/admin/songs'))); }, []);

  return (
    <section className="card">
      <div className="row">
        <h3>Canciones de «{playlist.name}»</h3>
        <button className="secondary" onClick={onClose}>Cerrar</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <select value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">Agregar canción…</option>
          {songs.filter(s => !items.some(i => i.id === s.id)).map(s => <option key={s.id} value={s.id}>{s.title} — {s.artist}</option>)}
        </select>
        <button disabled={!pick} onClick={() => run(async () => {
          await api(base, { method: 'POST', body: { songId: Number(pick) } });
          setPick('');
        })}>Agregar</button>
      </div>
      <ul>
        {items.map(s => (
          <li key={s.id}>
            {s.title} — {s.artist}{' '}
            <button className="danger" onClick={() => run(() => api(`${base}/${s.id}`, { method: 'DELETE' }))}>Quitar</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stats() {
  const [data, setData] = useState(null);
  const [votes, setVotes] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api('/admin/stats').then(setData).catch(e => setError(e.message)); }, []);
  const showVotes = id => api(`/admin/rounds/${id}/votes`).then(list => setVotes({ id, list })).catch(e => setError(e.message));

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Cargando…</p>;
  const s = data.summary;

  return (
    <section>
      <h2>Resultados y estadísticas</h2>
      <div className="grid">
        {[['Rondas cerradas', s.rounds], ['Votos totales', s.votes], ['Promedio por ronda', s.avg_votes], ['Rondas sin votos', s.empty_rounds]].map(([label, value]) => (
          <div key={label} className="card stat"><span>{label}</span><strong>{value}</strong></div>
        ))}
      </div>
      <h3>Historial de rondas</h3>
      <table>
        <thead><tr><th>#</th><th>Fecha</th><th>Opciones</th><th>Votos</th><th>Ganadora</th><th>Resolución</th><th>Regla</th><th /></tr></thead>
        <tbody>
          {data.history.map(h => (
            <tr key={h.id}>
              <td>{h.id}</td>
              <td>{fmt(h.opened_at)}</td>
              <td>{h.a_title} / {h.b_title}</td>
              <td>{h.votes_a ?? '—'} / {h.votes_b ?? '—'}</td>
              <td>{h.winner_title ?? '—'}</td>
              <td>{h.resolution ?? h.status}</td>
              <td>{h.rule_name}</td>
              <td><button onClick={() => showVotes(h.id)}>Votos</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {votes && (
        <div className="card">
          <div className="row">
            <h3>Votos de la ronda {votes.id}</h3>
            <button className="secondary" onClick={() => setVotes(null)}>Cerrar</button>
          </div>
          {votes.list.length
            ? <ul>{votes.list.map(v => <li key={v.id}>{fmt(v.created_at)} · {v.title}</li>)}</ul>
            : <p className="muted">Sin votos.</p>}
        </div>
      )}
      <h3>Reproducciones recientes</h3>
      <table>
        <thead><tr><th>Fecha</th><th>Canción</th><th>Origen</th></tr></thead>
        <tbody>
          {data.plays.map(p => <tr key={p.id}><td>{fmt(p.started_at)}</td><td>{p.title} — {p.artist}</td><td>{p.source}</td></tr>)}
        </tbody>
      </table>
    </section>
  );
}

function Settings() {
  const [s, setS] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [msg, setMsg] = useState(null);
  const fromServer = x => ({
    ...x,
    excluded_restrictions: x.excluded_restrictions.join(', '),
    sim_hhmm: x.context_override?.hhmm ?? '',
    sim_temp: x.context_override?.temp ?? '',
    sim_event: x.context_override?.event_type ?? '',
  });

  useEffect(() => {
    api('/admin/settings').then(x => setS(fromServer(x))).catch(e => setMsg(e.message));
    api('/admin/playlists').then(setPlaylists).catch(() => {});
  }, []);

  if (!s) return <p>{msg ?? 'Cargando…'}</p>;
  const set = key => e => setS({ ...s, [key]: e.target.value });

  const save = async e => {
    e.preventDefault();
    try {
      const out = await api('/admin/settings', {
        method: 'PUT',
        body: {
          round_seconds: Number(s.round_seconds),
          recent_window: Number(s.recent_window),
          tie_break: s.tie_break,
          no_votes: s.no_votes,
          excluded_restrictions: s.excluded_restrictions.split(',').map(x => x.trim()).filter(Boolean),
          source_playlist_id: s.source_playlist_id ? Number(s.source_playlist_id) : null,
          dj_enabled: Boolean(s.dj_enabled),
          dj_every_n_songs: Math.max(1, Number(s.dj_every_n_songs) || 1),
          dj_use_ai: Boolean(s.dj_use_ai),
          dj_station_name: s.dj_station_name || 'Radio del campus',
          dj_voice: s.dj_voice || '',
          dj_rate: Number(s.dj_rate) || 1,
          fallback_playlist_id: s.fallback_playlist_id ? Number(s.fallback_playlist_id) : null,
          context_override: s.sim_hhmm || s.sim_temp !== '' || s.sim_event
            ? { hhmm: s.sim_hhmm || null, temp: s.sim_temp === '' ? null : Number(s.sim_temp), event_type: s.sim_event || null }
            : null,
        },
      });
      setS(fromServer(out));
      setMsg('Guardado');
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <form className="card form" onSubmit={save}>
      <h2>Ajustes generales</h2>
      <label>Duración de la ronda (segundos)<input type="number" min="10" value={s.round_seconds} onChange={set('round_seconds')} required /></label>
      <label>Regla de desempate
        <select value={s.tie_break} onChange={set('tie_break')}>
          <option value="random">Aleatorio</option>
          <option value="least_played">La menos reproducida</option>
          <option value="first">La primera opción</option>
        </select>
      </label>
      <label>Ronda sin votos
        <select value={s.no_votes} onChange={set('no_votes')}>
          <option value="random">Aleatoria entre las dos opciones</option>
          <option value="fallback">Canción de la lista de respaldo</option>
        </select>
      </label>
      <label>Evitar repetir las últimas N canciones<input type="number" min="0" value={s.recent_window} onChange={set('recent_window')} required /></label>
      <label>Restricciones excluidas (separadas por coma, p. ej. explicit, revisar)<input value={s.excluded_restrictions} onChange={set('excluded_restrictions')} /></label>      <label>Lista para rotación automática (opcional)
        <select value={s.source_playlist_id ?? ''} onChange={set('source_playlist_id')}>
          <option value="">— catálogo completo —</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="muted">Al elegir una lista, las opciones de cada votación saldrán de ella y la programación continuará automáticamente tras cada canción. Se respetan las restricciones excluidas.</p>
      <label>Lista de respaldo
        <select value={s.fallback_playlist_id ?? ''} onChange={set('fallback_playlist_id')}>
          <option value="">— ninguna —</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <h3>Locutor automático</h3>
      <p className="muted">Entre canciones, el locutor presenta la ganadora, la temperatura y los próximos eventos, e invita a votar. Habla con la voz del navegador de la pantalla. Si el servidor tiene GEMINI_API_KEY, la IA redacta cada intervención; si no, usa frases preparadas.</p>
      <label className="check"><input type="checkbox" checked={!!s.dj_enabled} onChange={e => setS({ ...s, dj_enabled: e.target.checked })} /> Activar locutor</label>
      <label>Hablar cada N canciones<input type="number" min="1" value={s.dj_every_n_songs} onChange={set('dj_every_n_songs')} /></label>
      <label>Nombre de la estación<input value={s.dj_station_name} onChange={set('dj_station_name')} /></label>
      <label className="check"><input type="checkbox" checked={!!s.dj_use_ai} onChange={e => setS({ ...s, dj_use_ai: e.target.checked })} /> Redactar con IA (Gemini, si está configurado)</label>
      <label>Voz preferida (parte del nombre)<input value={s.dj_voice} onChange={set('dj_voice')} placeholder="p. ej. Dalia, Jorge, Google" /></label>
      <label>Velocidad de la voz<input type="number" min="0.7" max="1.5" step="0.05" value={s.dj_rate} onChange={set('dj_rate')} /></label>
      <DjPreview voice={s.dj_voice} rate={s.dj_rate} />

      <h3>Simulación de contexto (pruebas y demostraciones)</h3>
      <p className="muted">Deja vacío para usar los datos reales. Se aplica desde la siguiente ronda o al pulsar «Regenerar ronda» en Control.</p>
      <label>Hora simulada<input type="time" value={s.sim_hhmm} onChange={set('sim_hhmm')} /></label>
      <label>Temperatura simulada °C<input type="number" step="any" value={s.sim_temp} onChange={set('sim_temp')} /></label>
      <label>Evento simulado
        <select value={s.sim_event} onChange={set('sim_event')}>
          <option value="">— ninguno —</option>
          {EVENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="row save-row">
        {msg ? <p className="muted">{msg}</p> : <span />}
        <button type="submit">Guardar ajustes</button>
      </div>
      <Backup />
    </form>
  );
}

function DjPreview({ voice, rate }) {
  const [out, setOut] = useState(null);
  const [voices, setVoices] = useState([]);
  useEffect(() => { spanishVoices().then(setVoices); }, []);
  const preview = async () => {
    setOut({ text: 'Escribiendo…' });
    try {
      const line = await api('/admin/dj/preview', { method: 'POST' });
      setOut(line);
      speak(line.text, { voice, rate });
    } catch (err) {
      setOut({ text: err.message });
    }
  };
  return (
    <div className="dj-preview">
      <button type="button" className="secondary" onClick={preview}>Escuchar un ejemplo</button>
      {out && <blockquote>{out.text}{out.source && <cite>{out.source === 'ia' ? 'Redactado con IA' : out.aiConfigured ? 'Frases preparadas (la IA no respondió)' : 'Frases preparadas'}</cite>}</blockquote>}
      {!!voices.length && <p className="muted">Voces en español en este navegador: {voices.slice(0, 6).map(v => v.name).join(', ')}. La pantalla usa las suyas.</p>}
    </div>
  );
}

function Backup() {
  const [msg, setMsg] = useState(null);

  const download = async () => {
    try {
      const blob = await api('/admin/backup', { blob: true });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `radio-campus-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setMsg('Respaldo descargado');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const restore = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !confirm('Se actualizarán canciones, reglas, eventos, anuncios y ajustes con el contenido del respaldo. ¿Continuar?')) return;
    try {
      const out = await api('/admin/restore', { method: 'POST', body: JSON.parse(await file.text()) });
      setMsg(`Restaurado: ${Object.entries(out.counts).map(([k, v]) => `${k} ${v}`).join(', ')}. Recarga la página para ver los cambios.`);
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div className="backup">
      <h3>Respaldo de configuración</h3>
      <p className="muted">Incluye catálogo, listas, reglas, eventos, anuncios (con su audio) y ajustes. No incluye administradores ni historial.</p>
      <div className="row">
        <button type="button" onClick={download}>Descargar respaldo</button>
        <label className="button secondary">Restaurar desde archivo<input type="file" accept="application/json" hidden onChange={restore} /></label>
      </div>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

function Login({ onLogin, initialError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError || null);
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } = await api('/login', { method: 'POST', body: { email, password } });
      onLogin(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card login" onSubmit={submit}>
      <h1>Panel de administración</h1>
      <p className="muted">Ingresa con las credenciales de administrador.</p>
      <label>Correo<input type="email" autoComplete="username" autoFocus value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Entrar'}</button>
    </form>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('adminToken'));
  const [checkingSession, setCheckingSession] = useState(() => Boolean(sessionStorage.getItem('adminToken')));
  const [sessionError, setSessionError] = useState(null);
  const logout = event => {
    sessionStorage.removeItem('adminToken');
    setToken(null);
    setSessionError(event?.detail?.message || null);
  };

  useEffect(() => {
    window.addEventListener('admin-logout', logout);
    return () => window.removeEventListener('admin-logout', logout);
  }, []);

  useEffect(() => {
    if (!token) {
      setCheckingSession(false);
      return undefined;
    }
    let active = true;
    setCheckingSession(true);
    setSessionError(null);
    api('/admin/session').catch(error => {
      if (sessionStorage.getItem('adminToken')) {
        sessionStorage.removeItem('adminToken');
        setSessionError(`No se pudo validar la sesión: ${error.message}`);
        setToken(null);
      }
    }).finally(() => {
      if (active) setCheckingSession(false);
    });
    return () => { active = false; };
  }, [token]);

  if (checkingSession) return <p className="session-loading" role="status">Validando sesión…</p>;
  if (!token) {
    return <Login initialError={sessionError} onLogin={t => {
      sessionStorage.setItem('adminToken', t);
      setSessionError(null);
      setToken(t);
    }} />;
  }

  return (
    <div className="admin">
      <nav>
        <span className="brand"><span className="on-air-dot live" />Radio del campus</span>
        <div className="nav-links">
          {NAV.map(([path, label]) => <NavLink key={path} to={`/admin/${path}`} end>{label}</NavLink>)}
        </div>
        <button className="secondary" onClick={logout}>Salir</button>
      </nav>
      <Routes>
        <Route index element={<Control />} />
        <Route path="songs" element={<Songs />} />
        <Route path="playlists" element={<Playlists />} />
        <Route path="rules" element={
          <Crud resource="context_rules" title="Reglas contextuales" fields={ruleFields} columns={[
            ['Nombre', r => r.name], ['Prioridad', r => r.priority], ['Condición', r => describeCondition(r.condition)],
            ['Filtros', r => describeFilters(r.filters)], ['Activa', r => (r.active ? 'Sí' : 'No')],
          ]} />
        } />
        <Route path="events" element={
          <Crud resource="events" title="Festividades y eventos" fields={eventFields} columns={[
            ['Nombre', e => e.name], ['Tipo', e => EVENT_LABEL[e.type] ?? e.type], ['Inicio', e => fmt(e.starts_at)], ['Fin', e => fmt(e.ends_at)],
          ]} />
        } />
        <Route path="announcements" element={
          <Crud resource="announcements" title="Anuncios" fields={announcementFields} actions={announcementActions} columns={[
            ['Texto', a => a.text], ['Estado', a => (a.status === 'approved' ? 'Aprobado' : 'Borrador')],
            ['Vigencia', a => `${fmt(a.valid_from)} → ${fmt(a.valid_to)}`],
            ['Frecuencia', a => `cada ${a.every_n_songs}`],
          ]} />
        } />
        <Route path="stats" element={<Stats />} />
        <Route path="settings" element={<Settings />} />
      </Routes>
    </div>
  );
}