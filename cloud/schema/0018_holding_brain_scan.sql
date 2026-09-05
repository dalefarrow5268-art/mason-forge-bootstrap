CREATE TABLE IF NOT EXISTS holding_scan_items (
 id TEXT PRIMARY KEY,source_file_id INTEGER NOT NULL,entry_index INTEGER NOT NULL,original_path TEXT NOT NULL,size_bytes INTEGER NOT NULL,
 started_at TEXT,finished_at TEXT,processing_ms INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,output_file_id INTEGER,brain_key TEXT,category TEXT,error TEXT,updated_at TEXT NOT NULL,
 UNIQUE(source_file_id,entry_index)
);
CREATE INDEX IF NOT EXISTS holding_scan_status ON holding_scan_items(status,updated_at);
