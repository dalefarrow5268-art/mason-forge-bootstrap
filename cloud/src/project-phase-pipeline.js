import {PDFDocument} from 'pdf-lib';
import {now,stale,readSource,jsonObject,saveArtifact,addIssue} from './project-phase-common.js';
import {handlePhaseTask} from './project-phase-handlers.js';

async function addTask(env,s,phase,id,fileId,page,input={}){
 await env.DB.prepare('INSERT OR IGNORE INTO project_phase_tasks(id,submission_id,phase,file_id,page,input_json,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,s,phase,fileId,page,JSON.stringify(input),now()).run();
}
async function initSheets(run,env){
 await env.DB.prepare(`INSERT OR IGNORE INTO project_plan_sources(submission_id,file_id)
 SELECT ?,i.file_id FROM phase_six_items i WHERE i.submission_id=? AND i.status='COMPLETE'
 AND EXISTS(SELECT 1 FROM phase_one_items p WHERE p.output_file_id=i.file_id AND p.category='Plans' AND p.status='SORTED')`).bind(run.submission_id,run.submission_id).run();
 const files=(await env.DB.prepare("SELECT * FROM project_plan_sources WHERE submission_id=? AND status='PENDING' LIMIT 2").bind(run.submission_id).all()).results||[];
 for(const source of files){
  try{
   const {file,bytes}=await readSource(env,source.file_id);let count;
   if(/\.pdf$/i.test(file.file_name))count=(await PDFDocument.load(bytes)).getPageCount();
   else if(/\.(png|jpg|jpeg|webp)$/i.test(file.file_name))count=1;
   else throw new Error('Drawing format requires PDF/image conversion');
   if(!count)throw new Error('Drawing has no pages');
   for(let start=1;start<=count;start+=50){const writes=[];for(let page=start;page<=Math.min(count,start+49);page++)writes.push(env.DB.prepare('INSERT OR IGNORE INTO project_phase_tasks(id,submission_id,phase,file_id,page,updated_at) VALUES(?,?,8,?,?,?)').bind(`${run.submission_id}-8-${source.file_id}-${page}`,run.submission_id,source.file_id,page,now()));await env.DB.batch(writes);}
   await env.DB.prepare("UPDATE project_plan_sources SET page_count=?,status='COMPLETE',error=NULL WHERE submission_id=? AND file_id=?").bind(count,run.submission_id,source.file_id).run();
  }catch(error){await env.DB.prepare("UPDATE project_plan_sources SET status='NEEDS_REVIEW',error=? WHERE submission_id=? AND file_id=?").bind(String(error.message||error).slice(0,500),run.submission_id,source.file_id).run();}
 }
 const counts=await env.DB.prepare("SELECT COUNT(*) total,SUM(status='PENDING') pending,SUM(status='NEEDS_REVIEW') blocked FROM project_plan_sources WHERE submission_id=?").bind(run.submission_id).first();
 if(!counts.total||counts.blocked){await env.DB.prepare("UPDATE project_phase_runs SET status='NEEDS_REVIEW',error=?,updated_at=? WHERE submission_id=? AND phase=8").bind(!counts.total?'No classified plan sources':'Plan source requires splitting or conversion',now(),run.submission_id).run();return;}
 if(!counts.pending)await env.DB.prepare('UPDATE project_phase_runs SET initialized=1,updated_at=? WHERE submission_id=? AND phase=8').bind(now(),run.submission_id).run();
}
async function initialize(run,env){
 const s=run.submission_id;
 if(run.phase===8)return initSheets(run,env);
 if(run.phase===9){
  const sheets=(await env.DB.prepare('SELECT * FROM project_sheet_register WHERE submission_id=? AND sheet_id IS NOT NULL').bind(s).all()).results||[];
  for(const sheet of sheets)await addTask(env,s,9,`${s}-9-${sheet.file_id}-${sheet.page}`,sheet.file_id,sheet.page);
  if(!sheets.length){await env.DB.prepare("UPDATE project_phase_runs SET status='NEEDS_REVIEW',error='No identified drawing sheets',updated_at=? WHERE submission_id=? AND phase=9").bind(now(),s).run();return;}
 }else if(run.phase===10){
  const sources=(await env.DB.prepare('SELECT file_id FROM phase_six_items WHERE submission_id=? AND status=\'COMPLETE\'').bind(s).all()).results||[];
  for(const source of sources){const pages=(await env.DB.prepare('SELECT page FROM project_sheet_register WHERE submission_id=? AND file_id=?').bind(s,source.file_id).all()).results||[];
   if(pages.length)for(const p of pages)await addTask(env,s,10,`${s}-10-${source.file_id}-${p.page}`,source.file_id,p.page);
   else await addTask(env,s,10,`${s}-10-${source.file_id}-all`,source.file_id,null);
  }
 }else if(run.phase===11){
  const issues=(await env.DB.prepare("SELECT * FROM project_review_issues WHERE submission_id=? AND status='OPEN'").bind(s).all()).results||[];
  for(const issue of issues)await addTask(env,s,11,`${s}-11-${issue.id}`,issue.file_id,issue.page,{issueId:issue.id});
 }
 await env.DB.prepare('UPDATE project_phase_runs SET initialized=1,updated_at=? WHERE submission_id=? AND phase=?').bind(now(),s,run.phase).run();
}
async function reconcileSheets(run,env){
 const sheets=(await env.DB.prepare('SELECT * FROM project_sheet_register WHERE submission_id=?').bind(run.submission_id).all()).results||[];
 const byName=new Map();for(const s of sheets){if(s.sheet_id){const key=s.sheet_id.trim().toUpperCase();byName.set(key,[...(byName.get(key)||[]),s]);}}
 for(const sheet of sheets){
  const d=await jsonObject(env,sheet.result_key);const task={id:sheet.task_id,submission_id:run.submission_id,phase:8,file_id:sheet.file_id,page:sheet.page};
  for(let i=0;i<d.references.length;i++){const ref=d.references[i];const matches=byName.get(ref.sheetId.trim().toUpperCase())||[];
   if(matches.length!==1)await addIssue(env,task,`reference-${i}`,`${matches.length?'Ambiguous':'Missing'} referenced sheet ${ref.sheetId}`,`Provide or identify the controlling revision of ${ref.sheetId}.`,ref);
  }
 }
}
async function finishReview(run,env){
 const counts=await env.DB.prepare(`SELECT COUNT(*) total,SUM(status IN ('PENDING','QUEUED','RUNNING')) pending,SUM(status!='COMPLETE') blocked FROM project_phase_tasks WHERE submission_id=? AND phase=?`).bind(run.submission_id,run.phase).first();
 if(counts.pending)return;
 if(counts.blocked){await env.DB.prepare("UPDATE project_phase_runs SET status='WAITING_REVIEW',error='See task verification or review requirements',updated_at=? WHERE submission_id=? AND phase=?").bind(now(),run.submission_id,run.phase).run();return;}
 if(run.phase===8)await reconcileSheets(run,env);
 if(run.phase===10){
  const missing=(await env.DB.prepare(`SELECT s.* FROM phase_five_estimate_outbox s WHERE s.submission_id=? AND NOT EXISTS(SELECT 1 FROM project_takeoffs t WHERE t.scope_id=s.id AND t.status='VERIFIED')`).bind(run.submission_id).all()).results||[];
  for(const scope of missing){const e=JSON.parse(scope.evidence_json)[0];await addIssue(env,{id:`${run.submission_id}-10-coverage-${scope.id}`,submission_id:run.submission_id,phase:10,file_id:e?.sourceFileId,page:null},'missing',`Scope lacks verified quantity: ${scope.scope_text}`,'Provide a supported measured quantity or clarify the scope basis.',{scopeId:scope.id,evidence:JSON.parse(scope.evidence_json)});}
 }
 if(run.phase===11){const open=await env.DB.prepare("SELECT COUNT(*) n FROM project_review_issues WHERE submission_id=? AND status!='RESOLVED'").bind(run.submission_id).first();if(open.n){await env.DB.prepare("UPDATE project_phase_runs SET status='WAITING_REVIEW',error='Unresolved review findings',updated_at=? WHERE submission_id=? AND phase=11").bind(now(),run.submission_id).run();return;}}
 const tasks=(await env.DB.prepare('SELECT id,file_id,page,result_key,status FROM project_phase_tasks WHERE submission_id=? AND phase=? ORDER BY file_id,page').bind(run.submission_id,run.phase).all()).results||[];
 const key=await saveArtifact(env,run.submission_id,run.phase,'manifest',{submissionId:run.submission_id,phase:run.phase,status:'COMPLETE',tasks,completedAt:now()});
 await env.DB.prepare("UPDATE project_phase_runs SET status='COMPLETE',result_key=?,error=NULL,updated_at=? WHERE submission_id=? AND phase=?").bind(key,now(),run.submission_id,run.phase).run();
}
async function finalizeEstimate(run,env){
 const s=run.submission_id;
 const open=await env.DB.prepare("SELECT COUNT(*) n FROM project_review_issues WHERE submission_id=? AND status!='RESOLVED'").bind(s).first();
 const unverified=await env.DB.prepare("SELECT COUNT(*) n FROM project_takeoffs WHERE submission_id=? AND status!='VERIFIED'").bind(s).first();
 const scopes=(await env.DB.prepare('SELECT * FROM phase_five_estimate_outbox WHERE submission_id=? ORDER BY section_code,id').bind(s).all()).results||[];
 const quantities=(await env.DB.prepare('SELECT * FROM project_takeoffs WHERE submission_id=? ORDER BY scope_id,id').bind(s).all()).results||[];
 if(open.n||unverified.n||!scopes.length||scopes.some(v=>!quantities.some(q=>q.scope_id===v.id))){await env.DB.prepare("UPDATE project_phase_runs SET status='WAITING_REVIEW',error='Final estimate has unresolved scope, quantity or review issues',updated_at=? WHERE submission_id=? AND phase=12").bind(now(),s).run();return;}
 const sections=(await env.DB.prepare('SELECT section_code,section_title,division_code FROM phase_four_estimate_outbox WHERE submission_id=? ORDER BY section_code').bind(s).all()).results||[];
 const value={submissionId:s,sections:sections.filter(sec=>scopes.some(line=>line.section_code===sec.section_code)).map(sec=>({...sec,scopes:scopes.filter(line=>line.section_code===sec.section_code).map(line=>({id:line.id,scope:line.scope_text,evidence:JSON.parse(line.evidence_json),quantities:quantities.filter(q=>q.scope_id===line.id).map(q=>({...q,geometry:JSON.parse(q.geometry_json),source:JSON.parse(q.source_json),verification:JSON.parse(q.verification_json)}))}))})),pricingStatus:'NOT_PRICED',deliveryStatus:'WAITING_ESTIMATE_CONNECTION'};
 const bytes=new TextEncoder().encode(JSON.stringify(value));const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const id=`${s}-${hash}`;const key=await saveArtifact(env,s,12,id,value);
 await env.DB.prepare('INSERT OR IGNORE INTO project_estimate_versions(id,submission_id,result_key,sha256,status,created_at) VALUES(?,?,?,?,?,?)').bind(id,s,key,hash,'FINAL_SCOPE_AND_TAKEOFF_UNPRICED',now()).run();
 await env.DB.prepare("UPDATE project_phase_runs SET status='COMPLETE',result_key=?,error=NULL,updated_at=? WHERE submission_id=? AND phase=12").bind(key,now(),s).run();
}
async function prepareBids(run,env){
 const version=await env.DB.prepare('SELECT * FROM project_estimate_versions WHERE submission_id=? ORDER BY created_at DESC LIMIT 1').bind(run.submission_id).first();if(!version)throw new Error('Final estimate version missing');
 const estimate=await jsonObject(env,version.result_key);const packages=[];
 for(const section of estimate.sections){
  const tradeTerms={"02":["demolition"],"03":["concrete"],"04":["masonry"],"05":["steel","metal"],"06":["carpentry","millwork"],"07":["roofing","waterproofing","insulation"],"08":["door","glass","glazing"],"09":["drywall","painting","flooring","tile"],"14":["elevator"],"21":["sprinkler","fire suppression"],"22":["plumb"],"23":["hvac","mechanical"],"26":["electric"],"27":["communications","low voltage"],"28":["alarm","security"],"31":["earthwork","excavation"],"32":["landscap","paving"],"33":["utilities"]};
  const directory=(await env.DB.prepare("SELECT c.id,c.name,c.email,c.phone,c.trade,c.source,co.name company FROM contacts c LEFT JOIN companies co ON co.id=c.company_id WHERE c.trade IS NOT NULL AND c.trade!='' LIMIT 2000").all()).results||[];
  const terms=tradeTerms[section.division_code]||[];
  for(const contact of directory.filter(c=>terms.some(t=>String(c.trade).toLowerCase().includes(t)))){
   await env.DB.prepare('INSERT OR IGNORE INTO project_bid_candidates(id,submission_id,section_code,company,contact_json,qualification_json,status,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(`${run.submission_id}-${section.section_code}-directory-${contact.id}`,run.submission_id,section.section_code,contact.company||contact.name,JSON.stringify({name:contact.name,email:contact.email,phone:contact.phone,contactId:contact.id}),JSON.stringify({source:contact.source,trade:contact.trade,matchBasis:'Master-directory trade match only',serviceArea:'UNKNOWN',capacity:'UNKNOWN',availability:'UNKNOWN'}),'UNVERIFIED',now()).run();
  }
  const candidates=(await env.DB.prepare("SELECT company,contact_json,qualification_json,status FROM project_bid_candidates WHERE submission_id=? AND section_code=? ").bind(run.submission_id,section.section_code).all()).results||[];
  const pack={projectSubmission:run.submission_id,estimateVersionId:version.id,section,sourceDocuments:[...new Set(section.scopes.flatMap(s=>s.evidence.map(e=>e.sourceFileId)))],
   invitation:{subject:`Request for proposal — ${section.section_code} ${section.section_title}`,scope:section.scopes.map(s=>s.scope),instructions:'Price each included scope and identify exclusions, alternates, lead times, availability and bid validity.',dueDate:null,status:'DRAFT_NOT_SENT'},
   sourcing:{candidates:candidates.map(c=>({company:c.company,contact:JSON.parse(c.contact_json),qualifications:JSON.parse(c.qualification_json),status:c.status})),status:candidates.some(c=>c.status==='VERIFIED')?'CANDIDATES_READY':'SOURCING_REQUIRED'},requiredBeforeSending:['Bid due date','Verified recipients and qualifications','Sender approval']};
  const id=`${version.id}-${section.section_code}`;const key=await saveArtifact(env,run.submission_id,13,id,pack);
  await env.DB.prepare('INSERT OR IGNORE INTO project_bid_packages(id,submission_id,section_code,estimate_version_id,result_key,created_at) VALUES(?,?,?,?,?,?)').bind(id,run.submission_id,section.section_code,version.id,key,now()).run();packages.push({id,key,sourcingStatus:pack.sourcing.status});
 }
 const key=await saveArtifact(env,run.submission_id,13,'manifest',{packages,status:'DRAFTS_READY_NOT_SENT'});
 await env.DB.prepare("UPDATE project_phase_runs SET status='DRAFTS_READY',result_key=?,error=NULL,updated_at=? WHERE submission_id=? AND phase=13").bind(key,now(),run.submission_id).run();
}

export async function queueCompletionPhases(env){
 const eligible=(await env.DB.prepare("SELECT submission_id FROM phase_seven_jobs WHERE status='COMPLETE'").all()).results||[];
 for(const row of eligible)await env.DB.prepare('INSERT OR IGNORE INTO project_phase_runs(submission_id,phase,updated_at) VALUES(?,8,?)').bind(row.submission_id,now()).run();
 // Verification and issue resolution are saved inputs; the scheduler resumes automatically.
 await env.DB.prepare("UPDATE project_phase_tasks SET status='PENDING',error=NULL,updated_at=? WHERE phase=9 AND status='WAITING_LAYERS' AND EXISTS(SELECT 1 FROM plan_layer_jobs l WHERE l.plan_file_id=project_phase_tasks.file_id AND l.status IN ('READY_FOR_TAKEOFF','REFERENCE_ONLY'))").bind(now()).run();
 await env.DB.prepare(`UPDATE project_phase_tasks SET status='COMPLETE',updated_at=? WHERE phase=9 AND status IN ('WAITING_VERIFICATION','WAITING_REVIEW')
 AND result_key IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM project_takeoffs t WHERE t.task_id=project_phase_tasks.id AND t.status!='VERIFIED')
 AND NOT EXISTS(SELECT 1 FROM project_review_issues i WHERE i.task_id=project_phase_tasks.id AND i.status!='RESOLVED')`).bind(now()).run();
 await env.DB.prepare(`UPDATE project_phase_tasks SET status='COMPLETE',updated_at=? WHERE phase=11 AND status='WAITING_REVIEW'
 AND EXISTS(SELECT 1 FROM project_review_issues i WHERE i.id=json_extract(project_phase_tasks.input_json,'$.issueId') AND i.status='RESOLVED')`).bind(now()).run();
 await env.DB.prepare("UPDATE project_phase_runs SET status='RUNNING',updated_at=? WHERE status='WAITING_REVIEW' AND phase IN (9,11,12)").bind(now()).run();
 for(let phase=8;phase<=13;phase++){
  if(phase>8)await env.DB.prepare(`INSERT OR IGNORE INTO project_phase_runs(submission_id,phase,updated_at) SELECT submission_id,?,? FROM project_phase_runs WHERE phase=? AND status='COMPLETE'`).bind(phase,now(),phase-1).run();
  const runs=(await env.DB.prepare("SELECT * FROM project_phase_runs WHERE phase=? AND status='RUNNING' LIMIT 5").bind(phase).all()).results||[];
  for(const run of runs){
   try{
    if(!run.initialized)await initialize(run,env);
    const fresh=await env.DB.prepare('SELECT * FROM project_phase_runs WHERE submission_id=? AND phase=?').bind(run.submission_id,phase).first();if(!fresh.initialized||fresh.status!=='RUNNING')continue;
    if(phase===12)await finalizeEstimate(fresh,env);else if(phase===13)await prepareBids(fresh,env);else await finishReview(fresh,env);
   }catch(error){await env.DB.prepare("UPDATE project_phase_runs SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'NEEDS_REVIEW' ELSE status END,error=?,updated_at=? WHERE submission_id=? AND phase=?").bind(String(error.message||error).slice(0,500),now(),run.submission_id,phase).run();}
  }
 }
 const tasks=(await env.DB.prepare(`SELECT t.id FROM project_phase_tasks t JOIN project_phase_runs r ON r.submission_id=t.submission_id AND r.phase=t.phase
 WHERE r.status='RUNNING' AND (t.status='PENDING' OR (t.status IN ('QUEUED','RUNNING') AND t.updated_at<?)) LIMIT 20`).bind(stale()).all()).results||[];
 for(const t of tasks){
  const changed=await env.DB.prepare(`UPDATE project_phase_tasks SET status='QUEUED',updated_at=? WHERE id=? AND (status='PENDING' OR (status IN ('QUEUED','RUNNING') AND updated_at<?))`).bind(now(),t.id,stale()).run();if(!changed.meta.changes)continue;
  try{await env.DEPARTMENT_QUEUE.send({kind:'PROJECT_PHASE',id:t.id});}catch(error){await env.DB.prepare("UPDATE project_phase_tasks SET status='PENDING' WHERE id=? AND status='QUEUED'").bind(t.id).run();throw error;}
 }
}
export async function processCompletionPhase(body,env){
 const task=await env.DB.prepare(`SELECT t.* FROM project_phase_tasks t JOIN project_phase_runs r ON r.submission_id=t.submission_id AND r.phase=t.phase WHERE t.id=? AND r.status='RUNNING'`).bind(body.id).first();
 if(!task||!['PENDING','QUEUED','RUNNING'].includes(task.status))return;
 const lease=crypto.randomUUID();const claim=await env.DB.prepare(`UPDATE project_phase_tasks SET status='RUNNING',lease_token=?,attempts=attempts+1,updated_at=? WHERE id=? AND (status IN ('PENDING','QUEUED') OR (status='RUNNING' AND updated_at<?))`).bind(lease,now(),task.id,stale()).run();if(!claim.meta.changes)return;
 try{const result=await handlePhaseTask(task,env);await env.DB.prepare('UPDATE project_phase_tasks SET status=?,result_key=?,error=NULL,updated_at=? WHERE id=? AND lease_token=?').bind(result.status,result.key,now(),task.id,lease).run();}
 catch(error){if(String(error.message||error).startsWith('PLAN_LAYER_GATE:')){await env.DB.prepare("UPDATE project_phase_tasks SET status='WAITING_LAYERS',attempts=MAX(0,attempts-1),error=?,updated_at=? WHERE id=? AND lease_token=?").bind(String(error.message),now(),task.id,lease).run();return;}const terminal=task.attempts+1>=5;await env.DB.prepare('UPDATE project_phase_tasks SET status=?,error=?,updated_at=? WHERE id=? AND lease_token=?').bind(terminal?'NEEDS_REVIEW':'PENDING',String(error.message||error).slice(0,500),now(),task.id,lease).run();if(!terminal)throw error;}
}
