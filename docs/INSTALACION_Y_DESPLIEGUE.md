# Manual de instalación y despliegue

## 1. Cuentas y claves necesarias

| Servicio | Para qué | Cómo obtenerla |
|---|---|---|
| GitHub | Repositorio y despliegue automático | Acceso al repo `wa1o/radio-campus` |
| Render (u otro alojamiento Node + PostgreSQL) | Servidor con HTTPS y base de datos | render.com, cuenta con método de pago para planes sin suspensión |
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
- `YOUTUBE_API_KEY`: necesaria para importar playlists; la voz de anuncios usa el navegador y no requiere una API key.

```bash
npm run build
npm start
```

Abre:

- Panel: http://localhost:3000/admin
- Pantalla: http://localhost:3000/screen?key=TU_SCREEN_KEY → pulsa **Activar pantalla** (los navegadores exigen un clic antes de reproducir audio)
- Votación: http://localhost:3000/vote (desde un teléfono en la misma red usa la IP de la computadora, p. ej. `http://192.168.1.20:3000/vote`)

## 3. Despliegue en Render (recomendado)

1. Sube los cambios a GitHub.
2. En Render: **New → Blueprint**, elige el repositorio. Render lee `render.yaml` y crea:
   - `radio-campus` (servicio web Node, plan Starter, siempre encendido)
   - `radio-campus-db` (PostgreSQL Basic-256mb)
   `JWT_SECRET` y `SCREEN_KEY` se generan solos; `DATABASE_URL` se conecta sola.
3. Completa en el servicio web → *Environment* los valores marcados para capturar: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `YOUTUBE_API_KEY`.
4. Espera el primer despliegue. Render asigna `https://radio-campus-XXXX.onrender.com` con HTTPS.
5. Comprueba `https://…/api/health` → `{"ok":true,"db":true,…}`.
6. Consulta el valor de `SCREEN_KEY` en *Environment* y abre la pantalla con `https://…/screen?key=ESE_VALOR`.
7. Opcional: dominio propio (p. ej. `radio.iest.edu.mx`) en *Settings → Custom Domains*; Render emite el certificado.

Cada `git push` a la rama principal vuelve a desplegar. Las variables se cambian sin tocar el código.

> Los planes gratuitos de Render no sirven para operar: el servicio web se suspende tras 15 min sin tráfico (la pantalla perdería la conexión) y la base gratuita se elimina a los 30 días. Úsalos solo para demostraciones cortas.

### Alternativas

Cualquier plataforma con Node ≥ 18, WebSockets y PostgreSQL funciona (Railway, Fly.io, un VPS con Nginx + Certbot). Comandos: build `npm run build`, start `npm start`, health check `/api/health`. Si la base exige SSL, define `PGSSL=true`. Debe ejecutarse **una sola instancia**.

## 4. Puesta en marcha de la pantalla del campus

1. Computadora o mini-PC conectada a la pantalla y a bocinas, con Chrome o Edge.
2. Abre la URL de la pantalla en modo kiosco, p. ej. `chrome --kiosk "https://…/screen?key=…"`, y pulsa **Activar pantalla**.
3. Desactiva la suspensión de pantalla y de equipo.
4. El reproductor de YouTube debe quedar visible (mínimo 200×200 px); así lo exigen las políticas de YouTube.

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
