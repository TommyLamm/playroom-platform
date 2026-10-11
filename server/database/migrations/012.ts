import type { Migration } from '../migration.js';

export const migration12: Migration = {
  version: 12,
  name: 'durable-version-installations',
  up(sqlite) {
    sqlite.transaction(() => sqlite.exec(`CREATE TABLE installations (
      id TEXT PRIMARY KEY, job_id TEXT UNIQUE REFERENCES import_jobs(id),
      game_id TEXT NOT NULL, version TEXT NOT NULL, staging_path TEXT NOT NULL,
      manifest TEXT NOT NULL, source TEXT NOT NULL, files TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('prepared','registered','completed','quarantining','quarantined','blocked')),
      reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE INDEX installations_version ON installations(game_id,version);
    PRAGMA user_version=12;`))();
  },
};
