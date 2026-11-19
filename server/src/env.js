import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'SCREEN_KEY']) {
  if (!process.env[key]) {
    console.error(`Falta la variable de entorno ${key}`);
    process.exit(1);
  }
}