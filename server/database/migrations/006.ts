import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration6: Migration = {
  version: 6,
  name: 'visitor-events',
  up(sqlite) {
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE visitor_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          visitor_id TEXT NOT NULL, request_id TEXT NOT NULL,
          occurred_at INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('page_view','game_open')),
          path TEXT NOT NULL, ip TEXT NOT NULL, country TEXT,
          user_id INTEGER REFERENCES users(id),
          game_id TEXT REFERENCES games(id), game_name TEXT, game_version TEXT,
          referrer_host TEXT, user_agent TEXT NOT NULL,
          UNIQUE(visitor_id, request_id)
        );
        CREATE INDEX visitor_events_time ON visitor_events(occurred_at DESC, id DESC);
        CREATE INDEX visitor_events_visitor ON visitor_events(visitor_id, occurred_at);
        CREATE INDEX visitor_events_game ON visitor_events(game_id, occurred_at);
        PRAGMA user_version = 6;
      `);
    })();
  },
};
