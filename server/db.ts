import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './database/runner.js';

export * from './database/schema.js';

export function openStore(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(path.join(dataDir, 'platform.sqlite'));
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = FULL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    runMigrations(sqlite);
    return { sqlite, db: drizzle(sqlite) };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
export type Store = ReturnType<typeof openStore>;
