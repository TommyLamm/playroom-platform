import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration4: Migration = {
  version: 4,
  name: 'favorites',
  up(sqlite) {
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE favorites (
          user_id INTEGER NOT NULL REFERENCES users(id),
          game_id TEXT NOT NULL REFERENCES games(id),
          created_at INTEGER NOT NULL,
          PRIMARY KEY(user_id, game_id)
        );
        CREATE INDEX favorites_user_created ON favorites(user_id, created_at DESC, game_id);
        PRAGMA user_version = 4;
      `);
    })();
  },
};
