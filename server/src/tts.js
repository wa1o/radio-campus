export async function synthesize(text) {
  const key = process.env.GOOGLE_TTS_API_KEY;
  if (!key) throw new Error('GOOGLE_TTS_API_KEY no está configurada');
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: process.env.TTS_LANGUAGE || 'es-US', name: process.env.TTS_VOICE || undefined },
      audioConfig: { audioEncoding: 'MP3' },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`El servicio de voz respondió ${res.status}`);
  const { audioContent } = await res.json();
  return { audio: Buffer.from(audioContent, 'base64'), mime: 'audio/mpeg' };
}