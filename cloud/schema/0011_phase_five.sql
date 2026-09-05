CREATE TABLE IF NOT EXISTS phase_five_jobs (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, section_code TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 result_key TEXT, error TEXT, updated_at TEXT NOT NULL,
 UNIQUE(submission_id,section_code)
);
CREATE TABLE IF NOT EXISTS phase_five_estimate_outbox (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, section_code TEXT NOT NULL,
 scope_text TEXT NOT NULL, evidence_json TEXT NOT NULL, result_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'WAITING_ESTIMATE_CONNECTION', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS phase_five_pending ON phase_five_jobs(status,updated_at);
