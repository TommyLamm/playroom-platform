import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import lockfile from 'proper-lockfile';
import { getConfig } from './config.js';
import { openStore } from './db.js';
import { createApplication } from './app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = getConfig();
await mkdir(config.dataDir, { recursive: true });
const releaseLock = await lockfile.lock(config.dataDir, { realpath: false, stale: 30000 });
const store = openStore(config.dataDir);
const app = await createApplication(config, store, { logger: true });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await app.close();
  store.sqlite.close();
  await releaseLock();
}
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.on(event, () => {
    void stop().then(() => process.exit(0));
  });
try {
  await app.assets.listen({ port: config.gamesPort, host: config.host });
  await app.platform.listen({ port: config.platformPort, host: config.host });
  console.info(`Playroom: ${config.platformOrigin}`);
} catch (error) {
  await stop();
  throw error;
}
