// Locutor automático: escribe una intervención corta entre canciones con datos
// reales de la estación. Usa plantillas (gratis, sin conexión) y, si existe
// GEMINI_API_KEY, pide a Gemini (capa gratuita) una versión más natural.
// La voz la pone el navegador de la pantalla (Web Speech API), sin costo.
import { getSettings } from './settings.js';

const pick = list => list[Math.floor(Math.random() * list.length)];
const EVENT_LABEL = { exam: 'periodo de exámenes', holiday: 'festividad', event: 'evento' };
const fmtDay = d => new Date(d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: process.env.STATION_TZ || 'America/Mexico_City' });

export function buildFacts(director, settings) {
  const round = director.round?.status === 'closed' ? director.round : null;
  const next = director.forcedNext || round?.winner || null;
  const votes = round && next ? round.counts?.[next.id] ?? 0 : null;
  const totalVotes = round ? Object.values(round.counts || {}).reduce((a, b) => a + b, 0) : 0;
  const hour = Number((director.context?.hhmm || '12:00').slice(0, 2));
  return {
    station: settings.dj_station_name || 'Radio del campus',
    hour,
    previous: director.nowPlaying ? { title: director.nowPlaying.title, artist: director.nowPlaying.artist } : null,
    next: next ? { title: next.title, artist: next.artist } : null,
    byVote: Boolean(round && next && round.winner?.id === next.id && round.resolution === 'votos'),
    votes,
    totalVotes,
    temp: director.context?.temp != null ? Math.round(director.context.temp) : null,
    event: director.info?.events?.[0] ? { name: director.info.events[0].name, type: director.info.events[0].type, starts: director.info.events[0].starts_at } : null,
  };
}

export function templateLine(f) {
  const parts = [];
  const greeting = f.hour < 12 ? 'Buenos días' : f.hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  parts.push(pick([`${greeting}, estás escuchando ${f.station}.`, `${greeting}, campus. Esto es ${f.station}.`, `Aquí ${f.station}.`]));
  if (f.previous) parts.push(pick([`Acabamos de escuchar ${f.previous.title}, de ${f.previous.artist}.`, `Eso fue ${f.previous.title}, de ${f.previous.artist}.`]));
  if (f.next && f.byVote) {
    parts.push(f.votes === 1
      ? `Con un voto, ustedes eligieron lo que sigue: ${f.next.title}, de ${f.next.artist}.`
      : pick([`Con ${f.votes} votos, ustedes eligieron lo que sigue: ${f.next.title}, de ${f.next.artist}.`, `Ganó la votación con ${f.votes} votos: ${f.next.title}, de ${f.next.artist}.`]));
  } else if (f.next) {
    parts.push(pick([`Ahora sigue ${f.next.title}, de ${f.next.artist}.`, `Lo que viene: ${f.next.title}, de ${f.next.artist}.`]));
  }
  if (f.temp != null && Math.random() < 0.6) {
    const feel = f.temp >= 32 ? 'Hace calor, no olvides hidratarte.' : f.temp <= 15 ? 'Está fresco, abrígate.' : '';
    parts.push(`Estamos a ${f.temp} grados. ${feel}`.trim());
  }
  if (f.event && Math.random() < 0.5) {
    const starts = new Date(f.event.starts);
    parts.push(starts > new Date()
      ? `Recuerda: ${f.event.name} comienza el ${fmtDay(starts)}.`
      : `Seguimos en ${f.event.name}. ${f.event.type === 'exam' ? '¡Mucho éxito!' : ''}`.trim());
  }
  parts.push(pick([
    'Escanea el código QR de la pantalla y vota por la siguiente canción.',
    'Tú decides la próxima: escanea el QR y vota.',
    'Cuando empiece la canción se abre la votación: escanea el QR.',
  ]));
  return parts.join(' ');
}

function prompt(f) {
  return [
    `Eres el locutor de "${f.station}", la radio de un campus universitario en Tampico, México.`,
    'Escribe UNA intervención breve para decir en voz alta entre canciones: máximo 45 palabras, español de México, tono cálido y juvenil, sin groserías, sin emojis, sin hashtags, sin comillas ni acotaciones.',
    'Usa solo estos datos; no inventes fechas, nombres, cifras ni noticias:',
    JSON.stringify({
      hora: `${f.hour}:00`,
      cancion_anterior: f.previous,
      siguiente_cancion: f.next,
      gano_por_votacion: f.byVote,
      votos_de_la_ganadora: f.votes,
      temperatura_c: f.temp,
      proximo_evento: f.event && { nombre: f.event.name, tipo: EVENT_LABEL[f.event.type] ?? f.event.type, inicia: fmtDay(f.event.starts) },
    }),
    'Termina invitando a escanear el código QR de la pantalla para votar por la siguiente canción.',
  ].join('\n');
}

export function sanitize(text) {
  const clean = String(text ?? '')
    .replace(/[*_#`>"“”]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length < 20) return null;
  return clean.length > 420 ? `${clean.slice(0, 420).replace(/[^.!?]*$/, '')}`.trim() || null : clean;
}

async function aiLine(f) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt(f) }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 300 } }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn(`Gemini respondió HTTP ${res.status}; se usa la plantilla del locutor`);
      return null;
    }
    const data = await res.json();
    return sanitize(data.candidates?.[0]?.content?.parts?.map(p => p.text).join(' '));
  } catch (err) {
    console.warn('Gemini no disponible; se usa la plantilla del locutor:', err.message);
    return null;
  }
}

export async function writeDjLine(director, settings) {
  const facts = buildFacts(director, settings);
  if (settings.dj_use_ai) {
    const text = await aiLine(facts);
    if (text) return { text, source: 'ia' };
  }
  return { text: templateLine(facts), source: 'plantilla' };
}

export async function previewDj(director) {
  const settings = await getSettings();
  return { ...(await writeDjLine(director, settings)), aiConfigured: Boolean(process.env.GEMINI_API_KEY) };
}
