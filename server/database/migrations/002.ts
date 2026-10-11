import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration2: Migration = {
  version: 2,
  name: 'player-accounts',
  up(sqlite) {
    sqlite.transaction(() => {
      // Preserve the existing administrator and sessions while introducing player accounts.
      sqlite.exec(`
        CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')), created_at TEXT NOT NULL DEFAULT '');
        INSERT INTO users (id, username, password, role, created_at)
          SELECT id, username, password, 'admin', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM admins;
        CREATE TABLE sessions_v2 (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
        INSERT INTO sessions_v2 SELECT token_hash, admin_id, csrf, expires_at FROM sessions;
        DROP TABLE sessions;
        DROP TABLE admins;
        ALTER TABLE sessions_v2 RENAME TO sessions;
        CREATE INDEX sessions_expiry ON sessions(expires_at);
        PRAGMA user_version = 2;
      `);
    })();
  },
};
