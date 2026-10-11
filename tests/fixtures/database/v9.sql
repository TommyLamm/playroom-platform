-- Frozen real schema at v9, from published historical migrations.
-- Do not regenerate these fixtures when changing the migration runner.
CREATE TABLE account_settings (
          user_id INTEGER PRIMARY KEY REFERENCES users(id),
          career_visibility TEXT NOT NULL DEFAULT 'public' CHECK(career_visibility IN ('public','limited','private'))
        );

CREATE TABLE best_scores (
          user_id INTEGER NOT NULL REFERENCES users(id), game_id TEXT NOT NULL REFERENCES games(id),
          board_id TEXT NOT NULL, score INTEGER NOT NULL, achieved_at INTEGER NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(id), PRIMARY KEY(user_id, game_id, board_id)
        );

CREATE TABLE favorites (
          user_id INTEGER NOT NULL REFERENCES users(id),
          game_id TEXT NOT NULL REFERENCES games(id),
          created_at INTEGER NOT NULL,
          PRIMARY KEY(user_id, game_id)
        );

CREATE TABLE games (id TEXT PRIMARY KEY, repository_id INTEGER UNIQUE REFERENCES repositories(id), active_version TEXT, published INTEGER NOT NULL DEFAULT 0);

CREATE TABLE github_owners (login TEXT PRIMARY KEY COLLATE NOCASE, kind TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE import_batch_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL REFERENCES import_batches(id),
          repository_id INTEGER NOT NULL REFERENCES repositories(id), release_id INTEGER NOT NULL,
          job_id TEXT REFERENCES import_jobs(id), outcome TEXT NOT NULL, error TEXT,
          UNIQUE(batch_id, repository_id, release_id)
        );

CREATE TABLE import_batches (id TEXT PRIMARY KEY, created_at TEXT NOT NULL);

CREATE TABLE import_jobs (id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id), release_id INTEGER NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, error TEXT, game_id TEXT, version TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE operational_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE plays (
          id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
          session_hash TEXT NOT NULL, request_id TEXT NOT NULL,
          game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL,
          game_name TEXT NOT NULL, board_id TEXT,
          started_at INTEGER NOT NULL, last_heartbeat_at INTEGER NOT NULL,
          active_ms INTEGER NOT NULL DEFAULT 0, heartbeat_active INTEGER NOT NULL DEFAULT 0,
          UNIQUE(session_hash, request_id)
        );

CREATE TABLE previews (token_hash TEXT PRIMARY KEY, game_id TEXT NOT NULL, version TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE repositories (id INTEGER PRIMARY KEY AUTOINCREMENT, full_name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, checked_at TEXT, check_error TEXT, cached_releases TEXT NOT NULL DEFAULT '[]');

CREATE TABLE runs (
          id TEXT PRIMARY KEY, play_id TEXT NOT NULL REFERENCES plays(id),
          request_id TEXT NOT NULL, started_at INTEGER NOT NULL,
          score INTEGER, finished_at INTEGER, UNIQUE(play_id, request_id)
        );

CREATE TABLE score_submission_metrics (
          day TEXT NOT NULL, game_id TEXT NOT NULL REFERENCES games(id),
          outcome TEXT NOT NULL CHECK(outcome IN ('success','rejected','server_error')),
          count INTEGER NOT NULL CHECK(count >= 0), PRIMARY KEY(day,game_id,outcome)
        );

CREATE TABLE "sessions" (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);

CREATE TABLE "users" (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','game_manager','analyst','admin')),
            created_at TEXT NOT NULL DEFAULT '');

CREATE TABLE versions (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id TEXT NOT NULL REFERENCES games(id), version TEXT NOT NULL, manifest TEXT NOT NULL, sha256 TEXT NOT NULL, release_id INTEGER, asset_id INTEGER, release_tag TEXT, imported_at TEXT NOT NULL, published_at TEXT, reviewed_by TEXT, reviewed_at TEXT, UNIQUE(game_id, version));

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

CREATE INDEX best_scores_ranking ON best_scores(game_id, board_id, score, achieved_at, user_id);

CREATE INDEX favorites_user_created ON favorites(user_id, created_at DESC, game_id);

CREATE INDEX import_batch_items_batch ON import_batch_items(batch_id, id);

CREATE INDEX plays_user_game ON plays(user_id, game_id, started_at);

CREATE INDEX previews_expiry ON previews(expires_at);

CREATE INDEX runs_play_finished ON runs(play_id, finished_at);

CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE INDEX visitor_events_game ON visitor_events(game_id, occurred_at);

CREATE INDEX visitor_events_time ON visitor_events(occurred_at DESC, id DESC);

CREATE INDEX visitor_events_visitor ON visitor_events(visitor_id, occurred_at);

PRAGMA user_version=9;
