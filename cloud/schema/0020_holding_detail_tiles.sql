CREATE TABLE IF NOT EXISTS holding_scan_superseded_items (
 id TEXT PRIMARY KEY,
 source_file_id INTEGER NOT NULL,
 record_json TEXT NOT NULL,
 archived_at TEXT NOT NULL
);

ALTER TABLE holding_scan_items ADD COLUMN source_path TEXT;
ALTER TABLE holding_scan_items ADD COLUMN asset_role TEXT NOT NULL DEFAULT 'SOURCE';
ALTER TABLE holding_preparations ADD COLUMN scan_units_total INTEGER NOT NULL DEFAULT 0;

-- Preserve every first-pass result before retrying Bradenton with detail tiles.
INSERT OR IGNORE INTO holding_scan_superseded_items(id,source_file_id,record_json,archived_at)
SELECT id,source_file_id,json_object(
  'id',id,'entry_index',entry_index,'original_path',original_path,'size_bytes',size_bytes,
  'started_at',started_at,'finished_at',finished_at,'processing_ms',processing_ms,
  'status',status,'attempts',attempts,'output_file_id',output_file_id,'brain_key',brain_key,
  'category',category,'error',error,'updated_at',updated_at
),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM holding_scan_items WHERE source_file_id=2514;

DELETE FROM holding_scan_items WHERE source_file_id=2514;
UPDATE holding_preparations
SET status='PENDING',prepared_file_id=NULL,manifest_key=NULL,prepared_sha256=NULL,
    scan_units_total=0,error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_file_id=2514 AND status IN ('SCANNING','NEEDS_REVIEW');
