-- The first native-capture package retained every repeated vector drawing path
-- in JSON. Some otherwise valid pages therefore exceeded the scanner's 20 MiB
-- interpretation bound. Preserve that prepared package as a registered file
-- and rebuild from the untouched original with bounded v2 drawing digests.
DELETE FROM holding_scan_items WHERE source_file_id=2514;
UPDATE holding_preparations SET status='PENDING',prepared_file_id=NULL,
 manifest_key=NULL,prepared_sha256=NULL,files_total=0,pages_total=0,
 units_done=0,scan_units_total=0,attempts=0,started_at=NULL,finished_at=NULL,
 error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_file_id=2514 AND status='READY';
