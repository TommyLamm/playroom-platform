import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration7: Migration = {
  version: 7,
  name: 'github-sources-and-batches',
  up(sqlite) {
    sqlite.transaction(() => {
      sqlite.exec(`
        ALTER TABLE repositories ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE repositories ADD COLUMN checked_at TEXT;
        ALTER TABLE repositories ADD COLUMN check_error TEXT;
        ALTER TABLE repositories ADD COLUMN cached_releases TEXT NOT NULL DEFAULT '[]';
        CREATE TABLE github_owners (login TEXT PRIMARY KEY COLLATE NOCASE, kind TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE import_batches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
        CREATE TABLE import_batch_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL REFERENCES import_batches(id),
          repository_id INTEGER NOT NULL REFERENCES repositories(id), release_id INTEGER NOT NULL,
          job_id TEXT REFERENCES import_jobs(id), outcome TEXT NOT NULL, error TEXT,
          UNIQUE(batch_id, repository_id, release_id)
        );
        CREATE INDEX import_batch_items_batch ON import_batch_items(batch_id, id);
        PRAGMA user_version = 7;
      `);
    })();
  },
};
