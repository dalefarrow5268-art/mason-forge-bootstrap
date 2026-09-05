CREATE TABLE IF NOT EXISTS takeoff_crew_runs (
 task_id TEXT PRIMARY KEY, submission_id TEXT NOT NULL, file_id INTEGER NOT NULL,
 page INTEGER, status TEXT NOT NULL DEFAULT 'PENDING', manifest_key TEXT,
 error TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS takeoff_worker_jobs (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL, worker_kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 result_key TEXT, error TEXT, updated_at TEXT NOT NULL, finished_at TEXT,
 UNIQUE(task_id, worker_kind)
);
CREATE INDEX IF NOT EXISTS takeoff_worker_pending
 ON takeoff_worker_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS takeoff_worker_task
 ON takeoff_worker_jobs(task_id, worker_kind);
