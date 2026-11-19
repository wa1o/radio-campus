export function speak(text, { onEnd, onError } = {}) {
  if (!('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function') {
    throw new Error('Este navegador no tiene síntesis de voz disponible');
  }

  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.lang = 'es-MX';
  const voices = window.speechSynthesis.getVoices();
  const spanishVoice = voices.find(voice => /^es-MX([_-]|$)/i.test(voice.lang))
    || voices.find(voice => /^es([_-]|$)/i.test(voice.lang));
  if (spanishVoice) utterance.voice = spanishVoice;
  utterance.onend = onEnd;
  utterance.onerror = onError;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return utterance;
}
