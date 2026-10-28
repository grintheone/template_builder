import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { openDatabase } from './db/index.js';

async function main() {
  const config = readConfig();
  const database = openDatabase(config);
  const app = buildApp(config);
  app.addHook('onClose', async () => database.close());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close(); });
  }
  try {
    await app.listen({ host: config.HOST, port: config.API_PORT });
    console.log(`Local API listening on http://${config.HOST}:${config.API_PORT}`);
  } catch {
    await app.close();
    throw new Error('Unable to start API');
  }
}

main().catch(() => {
  console.error('API startup failed. Check .env, local data permissions, and whether API_PORT is already in use.');
  process.exitCode = 1;
});
