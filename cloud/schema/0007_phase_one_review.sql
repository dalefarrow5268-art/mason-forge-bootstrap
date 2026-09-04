CREATE TABLE IF NOT EXISTS phase_one_jobs (
 id TEXT PRIMARY KEY, source_file_id INTEGER NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'PENDING',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
);
CREATE TABLE IF NOT EXISTS phase_one_items (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL, entry_index INTEGER NOT NULL,
 original_path TEXT NOT NULL, size_bytes INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
 worker TEXT NOT NULL DEFAULT 'Needs Review', category TEXT, reason TEXT, output_file_id INTEGER, updated_at TEXT NOT NULL,
 UNIQUE(job_id,entry_index)
);
CREATE INDEX IF NOT EXISTS phase_one_items_status ON phase_one_items(status,updated_at);
