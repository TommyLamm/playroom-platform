import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration5: Migration = {
  version: 5,
  name: 'settings-and-operations',
  up(sqlite) {
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE account_settings (
          user_id INTEGER PRIMARY KEY REFERENCES users(id),
          career_visibility TEXT NOT NULL DEFAULT 'public' CHECK(career_visibility IN ('public','limited','private'))
        );
        CREATE TABLE score_submission_metrics (
          day TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES games(id),
          outcome TEXT NOT NULL CHECK(outcome IN ('success','rejected','server_error')),
          count INTEGER NOT NULL CHECK(count >= 0), PRIMARY KEY(day,game_id,outcome)
        );
        CREATE TABLE operational_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version = 5;
      `);
    })();
  },
};
