CREATE TABLE IF NOT EXISTS native_page_scan_trials (
 id TEXT PRIMARY KEY, source_file_id INTEGER NOT NULL, source_path TEXT NOT NULL,
 status TEXT NOT NULL, previous_items_json TEXT NOT NULL, brain_key TEXT, error TEXT,
 processing_ms INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 UNIQUE(source_file_id,source_path)
);
