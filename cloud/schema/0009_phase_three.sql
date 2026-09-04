CREATE TABLE IF NOT EXISTS phase_three_catalogs (
 edition TEXT PRIMARY KEY, source_reference TEXT NOT NULL, verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phase_three_divisions (
 edition TEXT NOT NULL, code TEXT NOT NULL CHECK(length(code)=2), title TEXT NOT NULL,
 PRIMARY KEY(edition,code)
);
CREATE TABLE IF NOT EXISTS phase_three_jobs (
 id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'WAITING_STANDARD', catalog_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, report_file_id INTEGER
);
CREATE TABLE IF NOT EXISTS phase_three_items (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, file_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 result_key TEXT, error TEXT, updated_at TEXT NOT NULL, UNIQUE(job_id,file_id)
);
CREATE TABLE IF NOT EXISTS phase_three_estimate_outbox (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, division_code TEXT NOT NULL,
 division_title TEXT NOT NULL, edition TEXT NOT NULL, evidence_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'WAITING_ESTIMATE_CONNECTION', target_estimate_id TEXT,
 created_at TEXT NOT NULL, UNIQUE(submission_id,division_code)
);
