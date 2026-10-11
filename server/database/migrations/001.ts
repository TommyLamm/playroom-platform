import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration1: Migration = {
  version: 1,
  name: 'initial-admin-schema',
  up(sqlite) {
    sqlite.transaction(() => {
      sqlite.exec(`
      CREATE TABLE admins (id INTEGER PRIMARY KEY CHECK(id = 1), username TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE repositories (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE games (id TEXT PRIMARY KEY, repository_id INTEGER UNIQUE REFERENCES repositories(id), active_version TEXT, published INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE versions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL, manifest TEXT NOT NULL, sha256 TEXT NOT NULL, release_id INTEGER, asset_id INTEGER, release_tag TEXT, imported_at TEXT NOT NULL, published_at TEXT, UNIQUE(game_id, version));
      CREATE TABLE import_jobs (id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id), release_id INTEGER NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, game_id TEXT, version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE previews (token_hash TEXT PRIMARY KEY, game_id TEXT NOT NULL, version TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE INDEX previews_expiry ON previews(expires_at);
      PRAGMA user_version = 1;
    `);
    })();
  },
};
