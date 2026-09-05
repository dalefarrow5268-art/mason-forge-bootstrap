CREATE TABLE IF NOT EXISTS brain_lobe_routes (
  file_id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  source_updated_at TEXT NOT NULL,
  extraction_key TEXT NOT NULL DEFAULT '', scan_updated_at TEXT NOT NULL DEFAULT '',
  record_key TEXT NOT NULL,
  routed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brain_lobe_routes_project ON brain_lobe_routes(project_id);
