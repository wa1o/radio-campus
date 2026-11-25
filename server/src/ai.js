const MOODS = ['tranquilo', 'alegre', 'nostalgico', 'romantico', 'intenso', 'festivo', 'concentracion'];
export const THEMES = ['navidad', 'dia_de_muertos', 'halloween', 'fiestas_patrias', 'san_valentin', 'fin_de_semestre', 'verano'];
export const UNKNOWN_ARTISTS = ['', 'desconocido', 'unknown', 'canal de youtube', 'sin artista', 'n/a'];

export function isUnknownArtist(value) {
    return UNKNOWN_ARTISTS.includes(String(value ?? '').trim().toLowerCase());
}

const schema = {
    type: 'ARRAY',
    items: {
        type: 'OBJECT',
        properties: {
            id: { type: 'INTEGER' },
            artist: { type: 'STRING' },
            genre: { type: 'STRING' },
            energy: { type: 'STRING', enum: ['low', 'medium', 'high'] },
            mood: { type: 'STRING', enum: MOODS },
            themes: { type: 'ARRAY', items: { type: 'STRING', enum: THEMES } },
            explicit: { type: 'STRING', enum: ['yes', 'no', 'unsure'] },
        },
        required: ['id', 'artist', 'genre', 'energy', 'mood', 'themes', 'explicit'],
    },
};

const PROMPT = `Eres el programador musical de una radio universitaria en México.
Para cada canción devuelve:
- artist: nombre real del artista o grupo que interpreta la canción, no el nombre del canal. Si no lo identificas con seguridad, devuelve una cadena vacía.
- genre: género principal en minúsculas y en español (pop, rock, regional mexicano, electrónica, instrumental…).
- energy: low, medium o high.
- mood: uno de la lista permitida.
- themes: solo si la canción está claramente asociada a esa época (por ejemplo, un villancico → navidad). Si no, lista vacía.
- explicit: "yes" si tiene groserías, contenido sexual explícito o apología de drogas o violencia; "no" si estás seguro de que es apta; "unsure" si no conoces la canción o dudas.
No inventes: ante la duda en explicit responde "unsure".
Canciones:`;

export async function classifySongs(songs) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY no está configurada');
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const list = songs.map(s => `${s.id}. Título: ${s.title}; artista/canal conocido: ${s.artist}`).join('\n');

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${PROMPT}\n${list}` }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema },
        }),
        signal: AbortSignal.timeout(60000),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('La IA no devolvió respuesta');
    return JSON.parse(text);
}