-- Retry only the known Bradenton failure after adding lossless unused-resource cleanup.
-- Preserve source objects and review history; no completion state is manufactured.
UPDATE holding_preparations SET status='PENDING',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source_file_id=2514 AND status='NEEDS_REVIEW'
AND error='Individual PDF page exceeds 20 MiB; preserved original requires review';
