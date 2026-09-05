-- Rebuild the reviewed A3.1 candidate package with the RCP-aware systems layer.
UPDATE plan_layer_jobs SET status='PENDING',attempts=0,source_sha256=NULL,
 manifest_key=NULL,layered_file_id=NULL,error=NULL,finished_at=NULL,
 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id='plan-layers-3012' AND status='LAYER_REVIEW_REQUIRED';
