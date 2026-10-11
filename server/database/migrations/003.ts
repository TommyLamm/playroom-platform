import type { Migration } from '../migration.js';

// Published history: do not change this migration's SQL or effects.
export const migration3: Migration = {
  version: 3,
  name: 'career-records',
  up(sqlite) {
    sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE plays (
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          session_hash TEXT NOT NULL, request_id TEXT NOT NULL,
          game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL,
          game_name TEXT NOT NULL, board_id TEXT,
          started_at INTEGER NOT NULL, last_heartbeat_at INTEGER NOT NULL,
          active_ms INTEGER NOT NULL DEFAULT 0, heartbeat_active INTEGER NOT NULL DEFAULT 0,
          UNIQUE(session_hash, request_id)
        );
        CREATE TABLE runs (
          id TEXT PRIMARY KEY, play_id TEXT NOT NULL REFERENCES plays(id),
          request_id TEXT NOT NULL, started_at INTEGER NOT NULL,
          score INTEGER, finished_at INTEGER, UNIQUE(play_id, request_id)
        );
        CREATE TABLE best_scores (
          user_id INTEGER NOT NULL REFERENCES users(id), game_id TEXT NOT NULL REFERENCES games(id),
          board_id TEXT NOT NULL, score INTEGER NOT NULL, achieved_at INTEGER NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id), PRIMARY KEY(user_id, game_id, board_id)
        );
        CREATE INDEX plays_user_game ON plays(user_id, game_id, started_at);
        CREATE INDEX runs_play_finished ON runs(play_id, finished_at);
        CREATE INDEX best_scores_ranking ON best_scores(game_id, board_id, score, achieved_at, user_id);
        PRAGMA user_version = 3;
      `);
    })();
  },
};
