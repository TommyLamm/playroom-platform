import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration8: Migration = {
  version: 8,
  name: 'account-roles',
  up(sqlite) {

    // Rebuild the CHECK constraint without rewriting any referencing tables.
    sqlite.pragma('foreign_keys = OFF');
    try {
      sqlite.transaction(() => {
        sqlite.exec(`
          CREATE TABLE users_v8 (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','game_manager','analyst','admin')),
            created_at TEXT NOT NULL DEFAULT '');
          INSERT INTO users_v8 SELECT id,username,password,role,created_at FROM users;
          UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='users'),0)) WHERE name='users_v8';
          DROP TABLE users;
          ALTER TABLE users_v8 RENAME TO users;
          PRAGMA user_version = 8;
        `);
        if ((sqlite.pragma('foreign_key_check') as unknown[]).length) throw new Error('Account migration failed foreign key validation');
      })();
    } finally {
      sqlite.pragma('foreign_keys = ON');
    }
  },
};
