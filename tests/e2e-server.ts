import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getConfig } from '../server/config.js';
import { openStore, users } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { passwordHash } from '../server/auth.js';
import { seedDemos } from '../server/maintenance.js';
import { fakeGitHub } from './helpers.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playroom-e2e-'));
const config = getConfig({
  dataDir: path.join(root, 'data'),
  platformOrigin: 'http://localhost:3070',
  gamesOrigin: 'http://127.0.0.1:3071',
  platformPort: 3070,
  gamesPort: 3071,
  production: false,
});
const store = openStore(config.dataDir);
store.db
  .insert(users)
  .values({
    id: 1,
    username: 'admin',
    role: 'admin',
    password: await passwordHash('e2e-only-password'),
  })
  .run();
await seedDemos(store, config);
const app = await createApplication(config, store, {
  github: await fakeGitHub(root, 'e2e-test-game'),
});
await app.assets.listen({ port: 3071, host: '127.0.0.1' });
await app.platform.listen({ port: 3070, host: '127.0.0.1' });
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  await app.close();
  store.sqlite.close();
  await fs.rm(root, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
