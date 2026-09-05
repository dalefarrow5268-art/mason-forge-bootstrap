ALTER TABLE holding_scan_items ADD COLUMN capture_path TEXT;
ALTER TABLE holding_scan_items ADD COLUMN capture_key TEXT;
ALTER TABLE holding_scan_items ADD COLUMN capture_file_id INTEGER;

-- Dale explicitly retired the slow automatic nine-tile Bradenton scan.  Preserve
-- every row as recoverable audit evidence before removing it from active work.
INSERT OR IGNORE INTO holding_scan_superseded_items(id,source_file_id,record_json,archived_at)
SELECT id,source_file_id,json_object(
 'id',id,'entry_index',entry_index,'original_path',original_path,
 'source_path',source_path,'asset_role',asset_role,'status',status,
 'attempts',attempts,'output_file_id',output_file_id,'brain_key',brain_key,
 'category',category,'error',error,'updated_at',updated_at
),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM holding_scan_items WHERE source_file_id=2514;

DELETE FROM holding_scan_items WHERE source_file_id=2514;
UPDATE holding_preparations SET status='PENDING',prepared_file_id=NULL,
 manifest_key=NULL,prepared_sha256=NULL,files_total=0,pages_total=0,
 units_done=0,scan_units_total=0,attempts=0,started_at=NULL,finished_at=NULL,
 error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_file_id=2514;
