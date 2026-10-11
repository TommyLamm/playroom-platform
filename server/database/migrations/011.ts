import type { Migration } from '../migration.js';

export const migration11: Migration = {
  version: 11,
  name: 'cloud-save-snapshots',
  up(sqlite) {
    sqlite.transaction(() => {
      sqlite.exec(`ALTER TABLE cloud_saves ADD COLUMN source_snapshot_id INTEGER;
        CREATE TABLE cloud_save_snapshots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id), game_id TEXT NOT NULL REFERENCES games(id),
          data TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
          format_version INTEGER NOT NULL, game_version TEXT NOT NULL, updated_at TEXT NOT NULL,
          request_id TEXT NOT NULL, captured_at TEXT NOT NULL,
          reason TEXT NOT NULL CHECK(reason IN ('migration','restore')),
          UNIQUE(user_id,game_id,revision)
        );
        CREATE INDEX cloud_save_snapshots_owner ON cloud_save_snapshots(user_id,game_id,id DESC);
        CREATE INDEX cloud_saves_game_format ON cloud_saves(game_id,format_version);
        PRAGMA user_version=11;`);
    })();
  },
};
