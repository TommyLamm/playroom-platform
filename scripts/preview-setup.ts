import { promises as fs } from 'node:fs';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { getConfig } from '../server/config.js';
import { openStore, users } from '../server/db.js';
import { eq } from 'drizzle-orm';
import { token, passwordHash } from '../server/auth.js';
import { seedDemos } from '../server/maintenance.js';

const config = getConfig();
if (
  config.production ||
  !['localhost', '127.0.0.1'].includes(new URL(config.platformOrigin).hostname)
)
  throw new Error('Preview setup is for loopback development only');
await fs.mkdir(config.dataDir, { recursive: true });
const unlock = await lockfile.lock(config.dataDir, {
  realpath: false,
  stale: 30000,
  lockfilePath: path.join(config.dataDir, '.platform.lock'),
});
const store = openStore(config.dataDir);
try {
  if (!store.db.select().from(users).where(eq(users.role, 'admin')).get()) {
    const password = token().slice(0, 22);
    store.db
      .insert(users)
      .values({
        username: 'admin',
        password: await passwordHash(password),
        role: 'admin',
        createdAt: new Date().toISOString(),
      })
      .run();
    await fs.writeFile(
      path.join(config.dataDir, 'local-admin.txt'),
      `Local preview only\nURL: ${config.platformOrigin}/admin\nUsername: admin\nPassword: ${password}\n`,
      { mode: 0o600, flag: 'wx' },
    );
  }
  await seedDemos(store, config);
  console.info(
    'Local preview initialized. Credentials are in data/local-admin.txt (not served by the website).',
  );
} finally {
  store.sqlite.close();
  await unlock();
}
