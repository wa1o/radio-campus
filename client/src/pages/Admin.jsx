import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { api } from '../api.js';
import { useStation, ConnectionBadge } from '../socket.jsx';

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

function Crud({ resource, title, fields, columns, actions, refreshKey = 0 }) {
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
    <section>
      <div className="row">
        <h2>{title}</h2>
        <button onClick={() => setForm(toForm(null, fields))}>Nuevo</button>
      </div>
      {error && <p className="error">{error}</p>}
      {form && (
        <form className="card form" onSubmit={save}>
          {fields.map(d => {
            const field = d.path === 'stream_ref'
              ? {
                ...d,
                type: form.provider === 'licensed_audio' ? 'url' : 'text',
                label: form.provider === 'licensed_audio' ? 'URL directa del audio licenciado' : 'ID de video de YouTube',
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
                <button onClick={() => setForm(toForm(row, fields))}>Editar</button>
                <button className="danger" onClick={() => remove(row.id)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  { path: 'stream_ref', label: 'ID de video de YouTube', required: true },
  { path: 'genre', label: 'Género' },
  { path: 'energy', label: 'Energía', type: 'select', options: ENERGY },
  { path: 'mood', label: 'Ambiente' },
  { path: 'themes', label: 'Temáticas (separadas por coma)', type: 'tags' },
  { path: 'restrictions', label: 'Restricciones (separadas por coma)', type: 'tags' },
  { path: 'active', label: 'Activa', type: 'checkbox', default: true },
];

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
    <section className="card import-card">
      <div className="import-heading">
        <span className="eyebrow">Importación rápida</span>
        <h2>Traer playlist de YouTube</h2>
        <p>Agrega automáticamente el título, el canal y el video a tu catálogo. La API de YouTube no proporciona de forma fiable género ni ambiente.</p>
      </div>
      <form className="import-form" onSubmit={importPlaylist}>
        <label htmlFor="playlist-url">Enlace de playlist pública</label>
        <div className="import-controls">
          <input
            id="playlist-url"
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/playlist?list=..."
            required
          />
          <button type="submit" disabled={busy}>{busy ? 'Importando…' : 'Importar playlist'}</button>
        </div>
      </form>
      {error && <p className="notice error" role="alert">{error}</p>}
      {result && (
        <p className="notice success" role="status" aria-live="polite">
          «{result.playlistName}»: {result.added} nuevas, {result.alreadyInCatalog} ya existentes y {result.skipped} omitidas.
          {' '}Se creó la lista con {result.tracksInPlaylist} canciones.
          {result.truncated && ' Se importaron como máximo las primeras 500 canciones.'}
          {' '}<NavLink to="/admin/playlists">Ver listas</NavLink>
        </p>
      )}
    </section>
  );
}

function Songs() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <>
      <PlaylistImporter onImported={() => setRefreshKey(key => key + 1)} />
      <Crud resource="songs" title="Canciones" fields={songFields} refreshKey={refreshKey} columns={[
        ['Título', s => s.title], ['Artista / canal', s => s.artist],
        ['Proveedor', s => s.provider === 'licensed_audio' ? 'Audio licenciado' : 'YouTube'],
        ['Género', s => s.genre ?? '—'], ['Energía', s => s.energy ?? '—'],
        ['Ambiente', s => s.mood ?? '—'], ['Activa', s => (s.active ? 'Sí' : 'No')],
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
      <button onClick={() => post('tts')}>Generar voz</button>
      {row.has_audio && (
        <button onClick={() => run(async () => {
          const blob = await api(`/admin/announcements/${row.id}/audio`, { blob: true });
          new Audio(URL.createObjectURL(blob)).play();
        })}>Escuchar</button>
      )}
      {row.status === 'approved'
        ? <button onClick={() => post('unapprove')}>Retirar</button>
        : row.has_audio && <button onClick={() => post('approve')}>Aprobar</button>}
    </>
  );
}

function Control() {
  const { state, connected } = useStation({});
  const [songs, setSongs] = useState([]);
  const [next, setNext] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => { api('/admin/songs').then(setSongs).catch(e => setError(e.message)); }, []);
  const act = (action, body) => api(`/admin/control/${action}`, { method: 'POST', body })
    .then(() => setError(null))
    .catch(e => setError(e.message));

  if (!state) return <p>Conectando…</p>;
  const round = state.round;
  const upcoming = state.forcedNext ?? round?.winner;
  const ctx = state.context;

  return (
    <section>
      <div className="row"><h2>Control en vivo</h2><ConnectionBadge connected={connected} /></div>
      {error && <p className="error">{error}</p>}
      {state.lastError && <p className="error">Último error: {state.lastError}</p>}
      <div className="grid">
        <div className="card">
          <h3>Estado</h3>
          <p>Fase: {PHASES[state.phase]}{state.paused && ' (en pausa)'}</p>
          <p>Pantalla: {state.screenOnline ? 'conectada' : 'desconectada'}</p>
          <p>Regla activa: {state.ruleName ?? '—'}</p>
          {ctx && <p>Contexto: {ctx.hhmm} · {ctx.temp ?? '—'} °C · {ctx.eventTypes.map(t => EVENT_LABEL[t] ?? t).join(', ') || 'sin eventos'}</p>}
          {ctx?.simulated && <p className="error">Contexto simulado activo (Ajustes)</p>}
          {ctx?.degraded && <p className="error">Sin datos de clima o calendario: se usa la lista de respaldo</p>}
        </div>
        <div className="card">
          <h3>Sonando</h3>
          <p>{state.nowPlaying ? `${state.nowPlaying.title} — ${state.nowPlaying.artist}` : '—'}</p>
          {state.announcement && <p>Anuncio: {state.announcement.text}</p>}
        </div>
        <div className="card">
          <h3>Ronda</h3>
          {round ? (
            <>
              <p>#{round.id} · {round.status === 'open' ? 'abierta' : 'cerrada'}</p>
              {round.candidates.map(c => <p key={c.id}>{c.title}: {round.counts[c.id] ?? 0} votos</p>)}
              {round.resolution && <p>Resolución: {round.resolution}</p>}
            </>
          ) : <p>Sin ronda activa</p>}
        </div>
        <div className="card">
          <h3>Cola</h3>
          <p>Siguiente: {upcoming ? `${upcoming.title} — ${upcoming.artist}` : 'pendiente de la votación'}{state.forcedNext && ' (manual)'}</p>
        </div>
      </div>
      <div className="row">
        {state.paused
          ? <button onClick={() => act('resume')}>Reanudar</button>
          : <button onClick={() => act('pause')}>Pausar</button>}
        <button onClick={() => act('skip')}>Saltar</button>
        <button onClick={() => act('reroll')} title="Descarta la ronda abierta y propone dos opciones con el contexto actual">Regenerar ronda</button>
        <select value={next} onChange={e => setNext(e.target.value)}>
          <option value="">Elegir siguiente canción…</option>
          {songs.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.title} — {s.artist}</option>)}
        </select>
        <button disabled={!next} onClick={() => act('next', { songId: Number(next) })}>Fijar como siguiente</button>
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
      <label>Restricciones excluidas (separadas por coma)<input value={s.excluded_restrictions} onChange={set('excluded_restrictions')} /></label>
      <label>Lista de respaldo
        <select value={s.fallback_playlist_id ?? ''} onChange={set('fallback_playlist_id')}>
          <option value="">— ninguna —</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
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
      {msg && <p className="muted">{msg}</p>}
      <button type="submit">Guardar</button>
      <Backup />
    </form>
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

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const submit = async e => {
    e.preventDefault();
    setError(null);
    try {
      const { token } = await api('/login', { method: 'POST', body: { email, password } });
      onLogin(token);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="card login" onSubmit={submit}>
      <h1>Panel de administración</h1>
      <label>Correo<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label>Contraseña<input type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
      {error && <p className="error">{error}</p>}
      <button type="submit">Entrar</button>
    </form>
  );
}

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('adminToken'));
  const logout = () => {
    sessionStorage.removeItem('adminToken');
    setToken(null);
  };

  useEffect(() => {
    window.addEventListener('admin-logout', logout);
    return () => window.removeEventListener('admin-logout', logout);
  }, []);

  if (!token) {
    return <Login onLogin={t => { sessionStorage.setItem('adminToken', t); setToken(t); }} />;
  }

  return (
    <div className="admin">
      <nav>
        {NAV.map(([path, label]) => <NavLink key={path} to={`/admin/${path}`} end>{label}</NavLink>)}
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
            ['Voz', a => (a.has_audio ? 'Sí' : 'No')], ['Vigencia', a => `${fmt(a.valid_from)} → ${fmt(a.valid_to)}`],
            ['Frecuencia', a => `cada ${a.every_n_songs}`],
          ]} />
        } />
        <Route path="stats" element={<Stats />} />
        <Route path="settings" element={<Settings />} />
      </Routes>
    </div>
  );
}