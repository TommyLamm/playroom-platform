import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getConfig } from '../server/config.js';
import { openStore, users } from '../server/db.js';
import { createApplication } from '../server/app.js';
import { passwordHash } from '../server/auth.js';
import { seedDemos } from '../server/maintenance.js';
import { fakeGitHub, makeZip, testManifest } from './helpers.js';
import type { Release } from '../shared/types.js';

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
for (const [index, role] of (['game_manager', 'analyst'] as const).entries()) {
  store.db.insert(users).values({ id: index + 2, username: `ui-${role}`, role, password: await passwordHash('e2e-only-password') }).run();
}
const github = await fakeGitHub(root, 'e2e-test-game');
const updateFixtures = new Map<string, { release: Release; file: string }>();
for (const [index, name] of ['desktop-a', 'desktop-b', 'mobile-a', 'mobile-b'].entries()) {
  const releaseId = 201 + index;
  const file = await makeZip(path.join(root, `update-${name}.zip`), {
    ...testManifest, id: `updates-${name}`, name: `更新測試 ${name}`, version: '1.0.0',
  });
  updateFixtures.set(`updates/${name}`, { file, release: { id: releaseId, tag: 'v1.0.0', name: 'Update fixture',
    publishedAt: '2026-10-10T00:00:00Z', prerelease: false, asset: { id: releaseId + 1000, name: 'game.zip', size: (await fs.stat(file)).size } } });
}
const app = await createApplication(config, store, {
  github: { ...github,
    async releases(name) { return updateFixtures.has(name) ? [updateFixtures.get(name)!.release] : github.releases(name); },
    async resolve(name, releaseId) {
      const fixture = updateFixtures.get(name);
      if (!fixture) return github.resolve(name, releaseId);
      if (releaseId !== fixture.release.id) throw new Error('Unknown update fixture Release');
      return { release: fixture.release, asset: { ...fixture.release.asset!, browser_download_url: `https://github.com/${name}/releases/download/v1.0.0/game.zip` } };
    },
    async download(asset, destination, limit, signal) {
      const fixture = [...updateFixtures.values()].find((f) => f.release.asset!.id === asset.id);
      if (!fixture) return github.download(asset, destination, limit, signal);
      signal.throwIfAborted(); await fs.copyFile(fixture.file, destination);
    },
  },
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
