import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration10: Migration = {
  version: 10,
  name: 'cloud-saves',
  up(sqlite) {
    sqlite.transaction(() => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS cloud_saves (
      user_id INTEGER NOT NULL REFERENCES users(id), game_id TEXT NOT NULL REFERENCES games(id),
      data TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), format_version INTEGER NOT NULL,
      game_version TEXT NOT NULL, updated_at TEXT NOT NULL, request_id TEXT NOT NULL,
      PRIMARY KEY(user_id,game_id)
    ); PRAGMA user_version = 10;`);
  })();
  },
};
