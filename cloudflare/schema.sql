CREATE TABLE IF NOT EXISTS app_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 data TEXT NOT NULL
);
INSERT OR IGNORE INTO app_state(id,data) VALUES(1,'{"threshold":70,"products":[],"evaluators":[],"round":"","roundEvaluators":{},"links":{}}');
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 normalized TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','evaluator')),
 salt TEXT NOT NULL,
 secret_hash TEXT NOT NULL,
 initial_code TEXT,
 UNIQUE(normalized,role)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL,
 auth_round TEXT
);
CREATE TABLE IF NOT EXISTS round_access (
 round TEXT PRIMARY KEY,
 salt TEXT NOT NULL,
 code_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS round_status (
 round TEXT PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','open','closed'))
);
CREATE TABLE IF NOT EXISTS responses (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 round TEXT NOT NULL,
 form_id TEXT NOT NULL,
 data TEXT NOT NULL,
 saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,round)
);
CREATE TABLE IF NOT EXISTS response_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 round TEXT NOT NULL,
 data TEXT NOT NULL,
 saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_responses_round ON responses(round);
