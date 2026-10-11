import type Database from 'better-sqlite3';
import type { Migration } from './migration.js';
import { migrations } from './migrations/index.js';

/** Use the same ordered path for an empty v0 database and all historical versions. */
export function runMigrations(sqlite: Database.Database, ordered: readonly Migration[] = migrations): void {
  if (!ordered.length || ordered.some((migration, index) => migration.version !== index + 1))
    throw new Error('Database migrations must be ordered and contiguous starting at version 1');
  let version = sqlite.pragma('user_version', { simple: true }) as number;
  if (version > ordered[ordered.length - 1].version)
    throw new Error('Database was created by a newer platform version');
  for (const migration of ordered) {
    if (migration.version <= version) continue;
    migration.up(sqlite);
    const completed = sqlite.pragma('user_version', { simple: true }) as number;
    if (completed !== migration.version)
      throw new Error(`Database migration ${migration.version} did not mark its completed version`);
    version = completed;
  }
}
