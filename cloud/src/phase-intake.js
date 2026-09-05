import {storeStream} from './phase-one-review.js';
const now=()=>new Date().toISOString();
const stale=()=>new Date(Date.now()-20*60*1000).toISOString();
const ROOT='SSX Project Holding Folder/Phase One Project Review';
export async function queuePhaseIntake(env){
 const rows=(await env.DB.prepare(`SELECT id FROM phase_intake_jobs WHERE status='PENDING' OR (status IN ('QUEUED','RUNNING') AND updated_at<?) LIMIT 10`).bind(stale()).all()).results||[];
 for(const row of rows){const claim=await env.DB.prepare(`UPDATE phase_intake_jobs SET status='QUEUED',updated_at=? WHERE id=? AND (status='PENDING' OR (status IN ('QUEUED','RUNNING') AND updated_at<?))`).bind(now(),row.id,stale()).run();if(!claim.meta.changes)continue;
  try{await env.DEPARTMENT_QUEUE.send({kind:'PHASE_INTAKE',id:row.id});}catch(error){await env.DB.prepare("UPDATE phase_intake_jobs SET status='PENDING' WHERE id=? AND status='QUEUED'").bind(row.id).run();throw error;}
 }
 const ready=(await env.DB.prepare(`SELECT s.* FROM phase_intake_submissions s WHERE s.status='PENDING'
 AND EXISTS(SELECT 1 FROM phase_intake_jobs j WHERE j.submission_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM phase_intake_jobs j WHERE j.submission_id=s.id AND j.status!='COMPLETE')`).all()).results||[];
 for(const s of ready){
  const files=(await env.DB.prepare('SELECT staged_file_id FROM phase_intake_jobs WHERE submission_id=? ORDER BY original_file_id').bind(s.id).all()).results||[];
  if(files.length!==JSON.parse(s.original_ids_json).length)throw new Error('Incomplete intake manifest');
  await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO phase_project_submissions(id,project_id,project_name,source_file_ids_json,sealed_at) VALUES(?,?,?,?,?)').bind(s.id,s.project_id,s.project_name,JSON.stringify(files.map(f=>f.staged_file_id)),now()),
   env.DB.prepare("UPDATE phase_intake_submissions SET status='SEALED' WHERE id=? AND status='PENDING'").bind(s.id)
  ]);
 }
}
export async function processPhaseIntake(body,env){
 const row=await env.DB.prepare('SELECT j.*,s.project_id,s.project_name FROM phase_intake_jobs j JOIN phase_intake_submissions s ON s.id=j.submission_id WHERE j.id=?').bind(body.id).first();
 if(!row||!['PENDING','QUEUED','RUNNING'].includes(row.status))return;
 const claim=await env.DB.prepare(`UPDATE phase_intake_jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND (status IN ('PENDING','QUEUED') OR (status='RUNNING' AND updated_at<?))`).bind(now(),row.id,stale()).run();if(!claim.meta.changes)return;
 try{
  const source=await env.DB.prepare('SELECT * FROM project_files WHERE id=? AND archived_at IS NULL').bind(row.original_file_id).first();if(!source)throw new Error('Original intake source missing or archived');
  const original=await env.PROJECT_FILES.get(source.r2_key);if(!original||original.size!==source.size_bytes)throw new Error('Original size does not match intake record');
  const key=`projects/${row.project_id}/phase-intake/${row.submission_id}/${source.id}/original`;
  const existing=await env.PROJECT_FILES.head(key);
  if(!existing)await storeStream(env,key,original.body,source.size_bytes);
  else {await original.body.cancel();if(existing.size!==source.size_bytes)throw new Error('Staged copy size mismatch');}
  const verified=await env.PROJECT_FILES.head(key);if(!verified||verified.size!==source.size_bytes)throw new Error('Working copy verification failed');
  const folder=`${ROOT}/${row.project_name.replace(/[^\w .()-]/g,'_')} - ${row.submission_id}`;
  const fileName=source.file_name.replace(/[\\/\x00-\x1f]/g,'_');
  await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO project_folders(id,project_id,folder_path,created_at,updated_at) VALUES(?,?,?,?,?)').bind(`intake-${row.submission_id}`,row.project_id,folder,now(),now()),
   env.DB.prepare(`INSERT OR IGNORE INTO project_files(project_id,r2_key,file_name,relative_path,file_type,size_bytes,review_status,source_class,uploaded_at,updated_at)
    VALUES(?,?,?,?,?,?,'PHASE ONE REVIEW REQUIRED: INTAKE','PHASE ONE INTAKE',?,?)`).bind(row.project_id,key,fileName,`${folder}/${source.id}-${fileName}`,source.file_type,source.size_bytes,now(),now())
  ]);
  const staged=await env.DB.prepare('SELECT id FROM project_files WHERE r2_key=?').bind(key).first();
  await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO phase_one_jobs(id,source_file_id,created_at,updated_at) VALUES(?,?,?,?)').bind(`intake-${staged.id}`,staged.id,now(),now()),
   env.DB.prepare("UPDATE phase_intake_jobs SET status='COMPLETE',staged_file_id=?,error=NULL,updated_at=? WHERE id=?").bind(staged.id,now(),row.id)
  ]);
 }catch(error){const terminal=row.attempts+1>=5;await env.DB.prepare('UPDATE phase_intake_jobs SET status=?,error=?,updated_at=? WHERE id=?').bind(terminal?'NEEDS_REVIEW':'PENDING',String(error.message||error).slice(0,500),now(),row.id).run();if(!terminal)throw error;}
}
