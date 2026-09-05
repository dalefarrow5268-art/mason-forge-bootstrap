CREATE TABLE IF NOT EXISTS project_phase_tracking (
 submission_id TEXT NOT NULL, phase INTEGER NOT NULL, status TEXT NOT NULL,
 first_seen_at TEXT NOT NULL, finished_at TEXT, last_changed_at TEXT NOT NULL,
 PRIMARY KEY(submission_id,phase)
);
CREATE TABLE IF NOT EXISTS project_phase_tracking_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT NOT NULL,
 phase INTEGER NOT NULL,status TEXT NOT NULL,observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_repair_requests (
 id TEXT PRIMARY KEY,submission_id TEXT NOT NULL,phase INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'REQUESTED',created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_repair ON project_repair_requests(submission_id,phase) WHERE status='REQUESTED';
