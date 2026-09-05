CREATE TABLE IF NOT EXISTS holding_preparations (
 source_file_id INTEGER PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'PENDING',
 prepared_file_id INTEGER,
 manifest_key TEXT,
 source_sha256 TEXT,
 prepared_sha256 TEXT,
 files_total INTEGER NOT NULL DEFAULT 0,
 pages_total INTEGER NOT NULL DEFAULT 0,
 units_done INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 started_at TEXT,
 finished_at TEXT,
 updated_at TEXT NOT NULL,
 error TEXT
);
CREATE TABLE IF NOT EXISTS holding_superseded_items (
 item_id TEXT PRIMARY KEY, source_file_id INTEGER NOT NULL, record_json TEXT NOT NULL, archived_at TEXT NOT NULL
);
INSERT OR IGNORE INTO holding_preparations(source_file_id,updated_at)
 SELECT j.source_file_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM phase_one_jobs j JOIN project_files f ON f.id=j.source_file_id
 WHERE f.source_class='PHASE ONE INTAKE' AND j.status IN ('PENDING','QUEUED','INVENTORIED','NEEDS_REVIEW','COMPLETE') AND NOT EXISTS(SELECT 1 FROM phase_project_submissions s JOIN phase_two_jobs t ON t.id=s.id JOIN json_each(s.source_file_ids_json) x WHERE x.value=j.source_file_id AND t.status='COMPLETE');
