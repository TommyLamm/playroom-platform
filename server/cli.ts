import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import lockfile from 'proper-lockfile';
import { getConfig } from './config.js';
import { users, openStore } from './db.js';
import { eq } from 'drizzle-orm';
import { usernameSchema } from '../shared/account.js';
import { passwordHash } from './auth.js';
import { backup, restore, seedDemos } from './maintenance.js';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const config = getConfig();
const [command, arg] = process.argv.slice(2);
async function readPassword(): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  if (!process.stdin.isTTY)
    throw new Error('Set ADMIN_PASSWORD or run the command in an interactive terminal');
  process.stdout.write('Password (at least 12 characters, hidden): ');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    function keypress(text: string, key: readline.Key) {
      if (key.name === 'return' || (key.ctrl && key.name === 'c')) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.off('keypress', keypress);
        process.stdout.write('\n');
        if (key.ctrl) reject(new Error('Cancelled'));
        else resolve(value);
      } else if (key.name === 'backspace') value = value.slice(0, -1);
      else if (text && !key.ctrl && !key.meta && !/[\x00-\x1f]/.test(text)) value += text;
    }
    process.stdin.on('keypress', keypress);
  });
}
try {
  if (command === 'backup') {
    if (!arg) throw new Error('Usage: npm run backup -- /path/to/new-backup-folder');
    await backup(config.dataDir, path.resolve(arg));
    console.info(`Backup complete: ${path.resolve(arg)}`);
  } else if (command === 'restore') {
    if (!arg)
      throw new Error('Usage: DATA_DIR=/empty/directory npm run restore -- /path/to/backup');
    await restore(path.resolve(arg), config.dataDir);
    console.info(`Restore complete: ${config.dataDir}`);
  } else if (command === 'admin:init' || command === 'demo:seed') {
    await fsp.mkdir(config.dataDir, { recursive: true });
    const unlock = await lockfile.lock(config.dataDir, { realpath: false, stale: 30000 });
    const store = openStore(config.dataDir);
    try {
      if (command === 'admin:init') {
        if (store.db.select().from(users).where(eq(users.role, 'admin')).get())
          throw new Error('An administrator already exists; refusing to overwrite');
        const username = usernameSchema.parse(arg || 'admin');
        if (store.db.select().from(users).where(eq(users.username, username)).get())
          throw new Error(
            'This username already belongs to a player; choose another administrator username',
          );
        const password = await readPassword();
        if (password.length < 12 || password.length > 256)
          throw new Error('Password must contain 12 to 256 characters');
        store.db
          .insert(users)
          .values({
            username,
            password: await passwordHash(password),
            role: 'admin',
            createdAt: new Date().toISOString(),
          })
          .run();
        console.info(`Administrator created: ${username}`);
      } else {
        await seedDemos(store, config);
        console.info('Demo games published');
      }
    } finally {
      store.sqlite.close();
      await unlock();
    }
  } else
    throw new Error(
      'Commands: admin:init [username], demo:seed, backup <folder>, restore <folder>',
    );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
