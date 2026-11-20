# Manual de instalación y despliegue

## 1. Cuentas y claves necesarias

| Servicio | Para qué | Cómo obtenerla |
|---|---|---|
| GitHub | Repositorio y despliegue automático | Acceso al repo `wa1o/radio-campus` |
| Render | Hosting HTTPS con planes gratuitos limitados | render.com |
| Google Cloud | YouTube Data API v3 (importar playlists) | Crear proyecto → habilitar YouTube Data API v3 → *Credenciales* → *Crear clave de API* |

Restringe la clave de API en Google Cloud a YouTube Data API v3.

## 2. Instalación local

```bash
git clone https://github.com/wa1o/radio-campus.git
cd radio-campus
cp .env.example .env
```

Edita `.env`:

- `DATABASE_URL`: p. ej. `postgres://postgres:tu_clave@localhost:5432/radio_campus` (crea la base antes en pgAdmin o con `createdb`).
- `JWT_SECRET` y `SCREEN_KEY`: cadenas largas y aleatorias, p. ej. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: primer administrador.
- `YOUTUBE_API_KEY` (opcional): búsqueda de canciones, playlists completas y mejores etiquetas. Sin ella se agregan canciones pegando enlaces.
- `GEMINI_API_KEY` (opcional, gratis en https://aistudio.google.com/apikey): el locutor redacta con IA y «Completar etiquetas» pregunta a Gemini por las canciones sin género. Sin ella el locutor usa frases preparadas.

```bash
npm run build
npm start
```

Abre:

- Panel: http://localhost:3000/admin
- Pantalla: http://localhost:3000/screen → ingresa `SCREEN_KEY` una vez en ese navegador y pulsa **Preparar pantalla**. En cada inicio, pulsa **Activar audio** (los navegadores exigen un clic antes de reproducirlo).
- Votación: http://localhost:3000/vote (desde un teléfono en la misma red usa la IP de la computadora, p. ej. `http://192.168.1.20:3000/vote`)

## 3. Despliegue gratuito en Render (pruebas y uso ligero)

1. Sube los cambios a GitHub.
2. En Render: **New → Blueprint**, elige el repositorio. `render.yaml` crea recursos **Free**:
   - `radio-campus` (servicio web Node)
   - `radio-campus-db` (PostgreSQL Free)
   `JWT_SECRET` y `SCREEN_KEY` se generan solos; `DATABASE_URL` se conecta sola.
3. Completa en el servicio web → *Environment* los valores marcados para capturar: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `YOUTUBE_API_KEY`.
4. Espera el primer despliegue. Render asigna `https://radio-campus-XXXX.onrender.com` con HTTPS.
5. Comprueba `https://…/api/health` → `{"ok":true,"db":true,…}`.
6. Consulta `SCREEN_KEY` en *Environment*, abre `https://…/screen` en el navegador dedicado a la pantalla e ingrésala. La clave se recuerda en ese navegador y no queda en la URL.
7. Para mantener el gasto en **$0**, no agregues un método de pago a Render (o quítalo antes de desplegar). Si la cuenta tiene un método de pago, los excedentes de ancho de banda o compilación podrían generar cargos. Sin método de pago, Render suspende el servicio al alcanzar los límites incluidos.

Cada `git push` a la rama principal vuelve a desplegar. Las variables se cambian sin tocar el código.

> **Límites importantes del plan gratuito:** el servicio web se duerme tras 15 minutos sin tráfico entrante y puede tardar alrededor de un minuto en despertar. Las conexiones WebSocket activas ayudan a mantener actividad, pero no garantizan disponibilidad continua. La base PostgreSQL gratuita tiene 1 GB, no incluye respaldos y **caduca 30 días después de crearla**; tras un período de gracia, Render la elimina con todos sus datos. Además, solo puedes tener una base PostgreSQL gratuita activa por workspace. Exporta respaldos periódicamente y no uses esta configuración para una radio que requiera operación continua o datos permanentes.

### Alternativas

Cualquier plataforma con Node ≥ 18, WebSockets y PostgreSQL puede alojar la app, pero las alternativas pueden tener cargos. Comandos: build `npm run build`, start `npm start`, health check `/api/health`. Si la base exige SSL, define `PGSSL=true`. Debe ejecutarse **una sola instancia**.

## 4. Puesta en marcha de la pantalla del campus

1. Computadora o mini-PC conectada a la pantalla y a bocinas, con Chrome o Edge.
2. Abre `https://…/screen` en modo kiosco. La primera vez, ingresa `SCREEN_KEY`; después el navegador recordará este dispositivo. Pulsa **Preparar pantalla** y luego **Activar audio**.
3. Desactiva la suspensión de pantalla y de equipo.
4. El reproductor de YouTube debe quedar visible (mínimo 200×200 px); así lo exigen las políticas de YouTube.

Usa un perfil de navegador dedicado a la pantalla y no compartas ni pegues la clave en URLs públicas. El formato anterior `/screen?key=…` sigue funcionando por compatibilidad, pero la clave en la URL puede quedar en el historial o en registros del proveedor. Si cambias `SCREEN_KEY` en Render, vuelve a ingresarla con **Ingresar otra clave**.

## 5. Restablecer el servicio

| Situación | Acción |
|---|---|
| La pantalla muestra «Sin conexión» | Revisa la red; se reconecta sola. Si no, recarga la página y pulsa *Activar pantalla* |
| `/api/health` falla | En Render, revisa *Logs* y *Events*; usa *Manual Deploy → Restart*. Verifica que la base esté activa |
| Programación detenida | Panel → Control: revisa «Último error», *Reanudar* o *Saltar* |
| Configuración dañada o borrada | Panel → Ajustes → *Restaurar desde archivo* con el último respaldo JSON |
| Pérdida de la base | Crea una base nueva, apunta `DATABASE_URL` a ella, reinicia (se recrea el esquema) y restaura el respaldo JSON o un `pg_dump` |
| Se olvidó la contraseña del administrador | Cambia `ADMIN_EMAIL` a un correo nuevo con nueva `ADMIN_PASSWORD` y reinicia: se crea ese administrador |

Recomendación: descargar un respaldo de configuración después de cada cambio importante y una vez por semana.
