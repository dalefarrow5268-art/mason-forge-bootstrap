-- A closed submission manifest is supplied by the future project handoff system.
CREATE TABLE IF NOT EXISTS phase_project_submissions (
 id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, project_name TEXT NOT NULL,
 source_file_ids_json TEXT NOT NULL, sealed_at TEXT NOT NULL, checked_at TEXT
);
CREATE TABLE IF NOT EXISTS phase_two_jobs (
 id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, report_file_id INTEGER
);
CREATE TABLE IF NOT EXISTS phase_two_items (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, file_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 findings_key TEXT, error TEXT, updated_at TEXT NOT NULL, UNIQUE(job_id,file_id)
);
CREATE INDEX IF NOT EXISTS phase_two_pending ON phase_two_items(status,updated_at);
