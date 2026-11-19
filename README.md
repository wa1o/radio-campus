# Radio Campus

Radio inteligente e interactiva para el campus. La comunidad vota desde el teléfono (vía QR) cuál de dos canciones sonará después; las opciones se eligen según la hora, la temperatura y el calendario institucional, y entre canciones se reproducen anuncios con voz sintética.

| Interfaz | Ruta | Uso |
|---|---|---|
| Pantalla pública | `/screen?key=SCREEN_KEY` | Pantalla horizontal del campus; reproduce la música y muestra la ronda, QR, temporizador, resultados y avisos |
| Votación móvil | `/vote` | Página que abre el QR; no requiere instalar nada |
| Panel de administración | `/admin` | Catálogo, reglas, eventos, anuncios, control en vivo, estadísticas y ajustes |

## Requisitos

- Node.js 18.11 o superior (probado con Node 22)
- PostgreSQL 13 o superior
- Opcional: clave de **YouTube Data API v3** (buscar e importar playlists; sin ella se agregan canciones pegando enlaces) y de **Gemini** (locutor con IA, gratis en Google AI Studio)

## Instalación y ejecución local

```bash
git clone https://github.com/wa1o/radio-campus.git
cd radio-campus
cp .env.example .env          # edita los valores (ver abajo)
createdb radio_campus         # o créala desde pgAdmin
npm run build                 # instala dependencias y compila el cliente
npm start                     # http://localhost:3000
```

Las tablas se crean solas al arrancar (`server/src/schema.sql`) y se da de alta el administrador definido en `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Para desarrollar con recarga automática, en dos terminales:

```bash
npm run dev:server   # API + Socket.IO en :3000
npm run dev:client   # Vite en :5173 (redirige /api y /socket.io al servidor)
```

### Variables de entorno

Todas se describen en [`.env.example`](.env.example). Las obligatorias son `DATABASE_URL`, `JWT_SECRET` y `SCREEN_KEY`; el servidor no arranca sin ellas. Las claves nunca se envían al navegador ni se guardan en el repositorio (`.env` está en `.gitignore`).

## Pruebas

```bash
cd server
npm test                                                        # unitarias (algoritmo contextual, YouTube)
TEST_DATABASE_URL=postgres://usuario:clave@localhost/radio_test npm run test:e2e   # ronda completa (¡vacía esa base!)
```

La prueba de integración levanta el servidor, simula la pantalla y tres teléfonos, y comprueba la ronda completa, el cambio de contexto, los anuncios, la persistencia tras reiniciar y el respaldo. Resultados en [docs/PRUEBAS.md](docs/PRUEBAS.md).

## Despliegue

El repositorio incluye un blueprint de Render (`render.yaml`) que crea el servicio web y la base PostgreSQL con HTTPS. Pasos completos y alternativas en [docs/INSTALACION_Y_DESPLIEGUE.md](docs/INSTALACION_Y_DESPLIEGUE.md).

## Documentación

- [Arquitectura y diagrama de flujo](docs/ARQUITECTURA.md)
- [Base de datos](docs/BASE_DE_DATOS.md)
- [Instalación y despliegue](docs/INSTALACION_Y_DESPLIEGUE.md)
- [Manual del administrador](docs/MANUAL_ADMIN.md)
- [Servicios externos y costos](docs/SERVICIOS_Y_COSTOS.md)
- [Pruebas y evidencias](docs/PRUEBAS.md)

## Estructura

```
radio-campus/
├── client/                 React + Vite (pantalla, votación y panel)
│   └── src/pages/          Screen.jsx · Vote.jsx · Admin.jsx
├── server/
│   ├── src/
│   │   ├── index.js        Express + Socket.IO, arranque y health check
│   │   ├── director.js     Programación: rondas, votos, cola, anuncios (estado central)
│   │   ├── context.js      Algoritmo de selección contextual
│   │   ├── routes/         API pública y de administración
│   │   ├── backup.js       Exportar / restaurar configuración
│   │   ├── youtube.js      Importación de playlists
│   │   ├── songtools.js    Enlaces, búsqueda, limpieza de títulos y etiquetas sugeridas
│   │   ├── dj.js           Locutor automático (plantillas + Gemini opcional)
│   │   └── schema.sql      Esquema de la base de datos
│   └── test/               Pruebas unitarias y de integración
├── docs/                   Manuales y documentación técnica
├── render.yaml             Despliegue en Render
└── .env.example            Variables de entorno sin secretos
```

## Funciones simuladas o con limitaciones

- **Simulación de contexto**: el panel permite fijar hora, temperatura o evento para demostraciones. Cuando está activa, el panel lo indica en rojo. Debe quedar vacía en operación normal.
- **Voz del locutor y anuncios**: se usa la síntesis de voz del navegador de la pantalla (gratis). La calidad depende de las voces instaladas; en Windows, Microsoft Edge ofrece voces neuronales en español.
- **Locutor con IA**: opcional con `GEMINI_API_KEY` (capa gratuita de Google). Sin clave, el locutor usa frases preparadas con los datos reales.
- **Pruebas automáticas**: la pantalla se simula con un cliente Socket.IO; la reproducción real en YouTube y la voz del navegador se verifican manualmente (checklist en `docs/PRUEBAS.md`).
- **Licencias musicales**: la reproducción pública en el campus requiere los permisos correspondientes; ver `docs/SERVICIOS_Y_COSTOS.md`.
