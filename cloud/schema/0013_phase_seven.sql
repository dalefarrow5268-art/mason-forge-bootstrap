CREATE TABLE IF NOT EXISTS phase_seven_jobs (
 submission_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'RUNNING',
 report_key TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phase_seven_items (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, file_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 result_key TEXT, error TEXT, updated_at TEXT NOT NULL, UNIQUE(submission_id,file_id)
);
CREATE INDEX IF NOT EXISTS phase_seven_pending ON phase_seven_items(status,updated_at);
