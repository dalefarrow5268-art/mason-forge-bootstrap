CREATE TABLE IF NOT EXISTS project_phase_runs (
 submission_id TEXT NOT NULL, phase INTEGER NOT NULL CHECK(phase BETWEEN 8 AND 13),
 status TEXT NOT NULL DEFAULT 'RUNNING', attempts INTEGER NOT NULL DEFAULT 0, initialized INTEGER NOT NULL DEFAULT 0,
 result_key TEXT, error TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(submission_id,phase)
);
CREATE TABLE IF NOT EXISTS project_phase_tasks (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, phase INTEGER NOT NULL,
 file_id INTEGER, page INTEGER, input_json TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 result_key TEXT, error TEXT, lease_token TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_phase_pending ON project_phase_tasks(status,updated_at);
CREATE INDEX IF NOT EXISTS project_phase_submission ON project_phase_tasks(submission_id,phase);
CREATE TABLE IF NOT EXISTS project_plan_sources (
 submission_id TEXT NOT NULL, file_id INTEGER NOT NULL, page_count INTEGER,
 status TEXT NOT NULL DEFAULT 'PENDING', error TEXT, PRIMARY KEY(submission_id,file_id)
);
CREATE TABLE IF NOT EXISTS project_sheet_register (
 task_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, file_id INTEGER NOT NULL,
 page INTEGER NOT NULL, sheet_id TEXT, summary TEXT, result_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_review_issues (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, phase INTEGER NOT NULL,
 task_id TEXT NOT NULL, file_id INTEGER, page INTEGER, description TEXT NOT NULL,
 question TEXT, source_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
 resolution_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_takeoffs (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, task_id TEXT NOT NULL,
 scope_id TEXT NOT NULL, description TEXT NOT NULL, unit TEXT NOT NULL,
 quantity REAL, geometry_json TEXT NOT NULL, source_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'NEEDS_VERIFICATION', verification_json TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_estimate_versions (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, result_key TEXT NOT NULL,
 sha256 TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_bid_packages (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, section_code TEXT NOT NULL,
 estimate_version_id TEXT NOT NULL, result_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT_NOT_SENT', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_bid_candidates (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, section_code TEXT NOT NULL,
 company TEXT NOT NULL, contact_json TEXT NOT NULL, qualification_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'UNVERIFIED', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_phase_audit (
 id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, action TEXT NOT NULL,
 target_id TEXT NOT NULL, detail_json TEXT NOT NULL, created_at TEXT NOT NULL
);
