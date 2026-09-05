CREATE TABLE IF NOT EXISTS phase_intake_submissions (
 id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, project_name TEXT NOT NULL,
 original_ids_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phase_intake_jobs (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, original_file_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 staged_file_id INTEGER, error TEXT, updated_at TEXT NOT NULL,
 UNIQUE(submission_id,original_file_id)
);
