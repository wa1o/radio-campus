# Radio Campus

## Requisitos
- Node.js 18.11 o superior
- PostgreSQL

## Configuración
1. Crea `.env` en la raíz del proyecto y configura la conexión a PostgreSQL y las claves.
2. Para importar playlists públicas de YouTube, habilita YouTube Data API v3 en Google Cloud y agrega `YOUTUBE_API_KEY=tu_clave` a `.env`. La clave se usa solo en el servidor.
3. Las canciones con audio licenciado pueden registrarse usando su URL directa HTTP/HTTPS; confirma que tu licencia permita reproducirlas públicamente.
4. Ejecuta `npm run build` para instalar dependencias y compilar el cliente.
5. Ejecuta `npm start` para iniciar el servidor.

Para desarrollo, usa `npm run dev:server` y `npm run dev:client` en terminales separadas.
