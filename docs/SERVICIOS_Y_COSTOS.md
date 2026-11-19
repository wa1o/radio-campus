# Servicios externos, requisitos de acceso y costos de operación

Precios consultados en noviembre de 2026, en dólares estadounidenses. Verifica las páginas oficiales antes de presupuestar; pueden cambiar.

## Resumen

| Servicio | Uso en el sistema | Cuenta / acceso | Costo estimado mensual |
|---|---|---|---|
| Render: servicio web Starter | Servidor Node.js, HTTPS, despliegue desde GitHub | Cuenta Render con tarjeta | US$7 |
| Render: PostgreSQL Basic-256mb | Base de datos persistente | Misma cuenta | US$6 + almacenamiento (US$0.30/GB) |
| YouTube IFrame Player | Reproducción de la música en la pantalla | Ninguna | US$0 |
| YouTube Data API v3 (opcional) | Buscar canciones, importar playlists y sugerir géneros | Clave de API en un proyecto de Google Cloud | US$0 (cuota diaria gratuita) |
| Voz del navegador (Web Speech API) | Voz del locutor y de los anuncios | Ninguna | US$0 |
| Google Gemini (opcional) | Redactar las intervenciones del locutor y sugerir etiquetas | Clave gratuita de Google AI Studio | US$0 en la capa gratuita |
| Open-Meteo | Temperatura local | Ninguna (sin clave) | US$0 para uso no comercial |
| GitHub | Repositorio | Cuenta gratuita | US$0 |
| Dominio propio (opcional) | p. ej. `radio.iest.edu.mx` | DNS de la universidad | Según la institución |
| **Total aproximado** | | | **≈ US$13–15 al mes** |

## Detalle y límites

### Render

- Una base Basic-256mb y un servicio Starter siempre encendido rondan US$13 al mes antes de crecer en almacenamiento o ancho de banda.
- La base gratuita de Render tiene un límite de 30 días; antes de ese plazo hay que pasar los datos a Basic-256mb (US$6).
- El servicio web gratuito se suspende tras 15 minutos sin tráfico y tarda en reactivarse, lo que desconectaría la pantalla. No usarlo en operación.
- Limitación del sistema: debe correr **una sola instancia**; no activar escalado horizontal.

### Voz del locutor y de los anuncios

- El locutor y los anuncios usan la síntesis de voz integrada en el navegador de la pantalla, sin una API de pago ni una clave del servidor.
- La voz depende del sistema y del navegador de la pantalla. En Windows, **Microsoft Edge** incluye voces neuronales en español gratuitas (p. ej. «Dalia» o «Jorge», de México), mucho más naturales que las voces locales; Chrome ofrece «Google español». Escribe parte del nombre de la voz en Ajustes → *Voz preferida*.
- Sin conexión a internet, Edge y Chrome usan las voces locales del sistema.

### Locutor con IA (Gemini, opcional)

- Sin `GEMINI_API_KEY`, el locutor arma sus intervenciones con frases preparadas y los datos reales de la estación. No cuesta nada y no depende de servicios externos.
- Con la clave, cada intervención la redacta Gemini a partir de esos mismos datos (canción anterior, ganadora y votos, temperatura, próximo evento). Si Gemini no responde en 6 segundos o rechaza la petición, se usa la plantilla y la radio no se detiene.
- La clave se obtiene gratis en Google AI Studio sin tarjeta. Google fija los límites de la capa gratuita por proyecto y los ha cambiado varias veces en 2026; los vigentes se consultan en AI Studio. Con el locutor cada 2 canciones se hacen unas 15–20 peticiones por hora de transmisión.
- En la capa gratuita, Google puede usar lo enviado para mejorar sus productos. El sistema solo envía nombres de canciones, temperatura y eventos públicos, nunca datos de estudiantes.

### YouTube

- El reproductor incrustado tiene reglas: tamaño mínimo y no reproducir automáticamente hasta que el reproductor esté visible en más de la mitad. La pantalla muestra el reproductor a 356×200 px para cumplirlas.
- Las políticas de desarrollador prohíben permitir la reproducción en segundo plano del reproductor de YouTube, por eso el reproductor debe permanecer visible en la pantalla.
- YouTube Data API: cuota gratuita de 10,000 unidades diarias por proyecto; importar playlists consulta además la clasificación por edad en grupos de hasta 50 videos.
- Algunos videos no permiten inserción o están bloqueados por región; el sistema los salta y registra el error.

### Open-Meteo

- Gratuito y sin clave para uso no comercial. El sistema consulta como máximo cada 10 minutos (≈144 llamadas al día). Si deja de responder, se usa la lista de respaldo.

## Licencias de música (requisito no técnico)

Reproducir música en un espacio público del campus es una **comunicación pública** que en México normalmente requiere licencia de las sociedades de gestión (autores y compositores, intérpretes y productores de fonogramas). Los términos de YouTube cubren la visualización personal, no la ambientación de espacios públicos. Antes de operar:

1. Consultar con el área jurídica de la universidad si ya existe una licencia vigente de música ambiental o de radio universitaria.
2. Si no, usar para el catálogo música con licencia de reproducción pública (bibliotecas libres de regalías o contenido propio), cargada como **Audio licenciado**, o tramitar la licencia correspondiente.

El sistema admite ambos proveedores para que la institución elija según los permisos que tenga.
