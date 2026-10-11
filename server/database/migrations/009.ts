import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration9: Migration = {
  version: 9,
  name: 'version-review',
  up(sqlite) {
    sqlite.transaction(() => {
    const columns = sqlite.pragma('table_info(versions)') as { name: string }[];
    if (!columns.some((c) => c.name === 'reviewed_by')) sqlite.exec('ALTER TABLE versions ADD COLUMN reviewed_by TEXT');
    if (!columns.some((c) => c.name === 'reviewed_at')) sqlite.exec('ALTER TABLE versions ADD COLUMN reviewed_at TEXT');
    sqlite.pragma('user_version = 9');
  })();
  },
};
