CREATE TABLE IF NOT EXISTS phase_six_items (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, file_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 result_key TEXT, error TEXT, updated_at TEXT NOT NULL, UNIQUE(submission_id,file_id)
);
CREATE INDEX IF NOT EXISTS phase_six_pending ON phase_six_items(status,updated_at);
CREATE TABLE IF NOT EXISTS phase_six_brains (
 submission_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'RUNNING',
 manifest_key TEXT, updated_at TEXT NOT NULL
);
