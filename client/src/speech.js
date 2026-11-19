// Voz gratuita del navegador (Web Speech API). La calidad depende de las voces
// instaladas: Microsoft Edge en Windows incluye voces neuronales en español
// («Dalia», «Jorge» en línea) y Chrome incluye «Google español».

let voicesReady;
function loadVoices() {
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) return Promise.resolve(synth.getVoices());
  voicesReady ??= new Promise(resolve => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return voicesReady;
}

const score = (voice, hint) => {
  let s = 0;
  const name = voice.name.toLowerCase();
  if (hint && name.includes(hint.toLowerCase())) s += 100;
  if (/^es[-_]mx/i.test(voice.lang)) s += 20;
  else if (/^es[-_](us|419)/i.test(voice.lang)) s += 15;
  else if (/^es/i.test(voice.lang)) s += 10;
  else return -1;
  if (/natural|online|neural/.test(name)) s += 8;
  if (/google/.test(name)) s += 5;
  return s;
};

export async function spanishVoices() {
  if (!('speechSynthesis' in window)) return [];
  return (await loadVoices()).filter(v => /^es/i.test(v.lang)).sort((a, b) => score(b) - score(a));
}

export function pickVoice(voices, hint = '') {
  return voices.map(v => [v, score(v, hint)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Divide en frases cortas: Chrome corta las locuciones largas (~15 s).
export function splitSentences(text) {
  return String(text).match(/[^.!?¡¿]+[.!?]*|[¡¿][^.!?]+[.!?]*/g)?.map(t => t.trim()).filter(Boolean) ?? [String(text)];
}

export function speak(text, { onEnd, onError, voice: hint = '', rate = 1 } = {}) {
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
    throw new Error('Este navegador no tiene síntesis de voz disponible');
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const control = { cancelled: false };
  loadVoices().then(voices => {
    if (control.cancelled) return;
    const voice = pickVoice(voices, hint);
    const parts = splitSentences(text);
    parts.forEach((part, i) => {
      const u = new window.SpeechSynthesisUtterance(part);
      u.lang = voice?.lang || 'es-MX';
      if (voice) u.voice = voice;
      u.rate = Math.min(1.5, Math.max(0.7, Number(rate) || 1));
      if (i === parts.length - 1) u.onend = () => !control.cancelled && onEnd?.();
      u.onerror = event => {
        if (control.cancelled || event.error === 'interrupted' || event.error === 'canceled') return;
        control.cancelled = true;
        synth.cancel();
        onError?.(event);
      };
      synth.speak(u);
    });
  });
  return control;
}
