import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { createProductionApp } from './http/app.js';

loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

export function buildServer() {
  return createProductionApp({ logger: true });
}

const { app, runtime } = buildServer();
const port = Number(process.env.PORT ?? 8080);

try {
  await app.listen({ host: '0.0.0.0', port });
  runtime.start();
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
