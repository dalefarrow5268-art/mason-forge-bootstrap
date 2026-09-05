CREATE TABLE IF NOT EXISTS plan_layer_jobs (
 id TEXT PRIMARY KEY, source_file_id INTEGER NOT NULL, prepared_file_id INTEGER NOT NULL,
 plan_file_id INTEGER NOT NULL UNIQUE, source_path TEXT NOT NULL, brain_keys_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ROUTING_PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 route_json TEXT, source_sha256 TEXT, manifest_key TEXT, layered_file_id INTEGER,
 error TEXT, updated_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS plan_layer_status ON plan_layer_jobs(status,updated_at);
