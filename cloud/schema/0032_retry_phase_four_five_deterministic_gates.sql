CREATE TABLE IF NOT EXISTS phase_five_retry_audit (
 id TEXT PRIMARY KEY,
 submission_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 prior_status TEXT NOT NULL,
 prior_attempts INTEGER NOT NULL,
 prior_result_key TEXT,
 prior_error TEXT,
 archived_at TEXT NOT NULL
);

INSERT OR IGNORE INTO phase_four_retry_audit(id,submission_id,item_id,prior_status,prior_attempts,prior_result_key,prior_error,archived_at)
SELECT 'deterministic-gate-'||i.id,j.submission_id,i.id,i.status,i.attempts,i.result_key,i.error,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM phase_four_items i JOIN phase_four_jobs j ON j.id=i.job_id
WHERE j.submission_id='bask-bradenton-2513-v1' AND i.status='NEEDS_REVIEW';

UPDATE phase_four_items SET status='PENDING',attempts=0,error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT item_id FROM phase_four_retry_audit WHERE submission_id='bask-bradenton-2513-v1' AND id LIKE 'deterministic-gate-%');

UPDATE phase_four_jobs SET status='RUNNING',error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE submission_id='bask-bradenton-2513-v1' AND status='NEEDS_REVIEW';

INSERT OR IGNORE INTO phase_five_retry_audit(id,submission_id,job_id,prior_status,prior_attempts,prior_result_key,prior_error,archived_at)
SELECT 'deterministic-gate-'||id,submission_id,id,status,attempts,result_key,error,strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM phase_five_jobs
WHERE submission_id='bask-bradenton-2513-v1' AND status='NEEDS_REVIEW';

UPDATE phase_five_jobs SET status='PENDING',attempts=0,error=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE id IN (SELECT job_id FROM phase_five_retry_audit WHERE submission_id='bask-bradenton-2513-v1' AND id LIKE 'deterministic-gate-%');
