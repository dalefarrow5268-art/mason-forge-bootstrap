const names=['File inventory & sorting','Project information','CSI divisions','CSI sections','Short scope lines','Mason Project Brain','Reports & recommendations','Sheet review & RFIs','Verified takeoffs','Final quality review','Corrections & recheck','Final unpriced estimate','Bid packages & sub sourcing'];
const rows=async(env,sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results||[];
export function summarize(jobs,items,phase){
 const counts={};for(const x of items)counts[x.status]=(counts[x.status]||0)+1;
 let status=!jobs.length?'WAITING':jobs.every(x=>x.status==='COMPLETE')?'COMPLETE':jobs.some(x=>/NEEDS_REVIEW|WAITING_REVIEW|WAITING_STANDARD|FAILED/.test(x.status))?'NEEDS_REVIEW':jobs.some(x=>x.status==='DRAFTS_READY')?'DRAFTS_READY':jobs.some(x=>['RUNNING','INVENTORIED'].includes(x.status))?'RUNNING':'QUEUED';
 if(phase===1&&items.some(x=>x.status==='NEEDS_REVIEW'))status='NEEDS_REVIEW';
 const total=items.length,done=(counts.COMPLETE||0)+(counts.SORTED||0);const complete=['COMPLETE','DRAFTS_READY'].includes(status);
 return {phase,name:names[phase-1],status,counts,total,done,percent:complete?100:total?Math.min(99,Math.floor(done/total*100)):0,errors:[...new Set([...jobs,...items].map(x=>x.error||x.reason).filter(Boolean))].slice(0,8),outputs:items.filter(x=>x.result_key||x.findings_key||x.output_file_id).length};
}
export async function intakeProgress(env,projectId=null){
 const projects=[];const submissions=await rows(env,'SELECT * FROM phase_project_submissions WHERE (? IS NULL OR project_id=?) ORDER BY sealed_at DESC LIMIT 20',projectId,projectId);
 for(const s of submissions){
 const preparation=await rows(env,`SELECT p.* FROM holding_preparations p WHERE p.source_file_id IN (SELECT value FROM json_each(?))`,s.source_file_ids_json);
 const phases=[];
 for(let phase=1;phase<=13;phase++){
 let jobs=[],items=[];
 if(phase===1){jobs=await rows(env,'SELECT * FROM phase_one_jobs WHERE source_file_id IN (SELECT value FROM json_each(?))',s.source_file_ids_json);items=await rows(env,'SELECT * FROM phase_one_items WHERE job_id IN (SELECT id FROM phase_one_jobs WHERE source_file_id IN (SELECT value FROM json_each(?)))',s.source_file_ids_json);}
 else if(phase<=5){const word=['','','two','three','four','five'][phase],table='phase_'+word+'_jobs',key=phase<=3?'id':'submission_id';jobs=await rows(env,`SELECT * FROM ${table} WHERE ${key}=?`,s.id);items=phase===5?jobs:await rows(env,`SELECT * FROM phase_${word}_items WHERE job_id IN (SELECT id FROM ${table} WHERE ${key}=?)`,s.id);}
 else if(phase===6||phase===7){const w=phase===6?'six':'seven';jobs=await rows(env,`SELECT * FROM phase_${w}_${phase===6?'brains':'jobs'} WHERE submission_id=?`,s.id);items=await rows(env,`SELECT * FROM phase_${w}_items WHERE submission_id=?`,s.id);}
 else{jobs=await rows(env,'SELECT * FROM project_phase_runs WHERE submission_id=? AND phase=?',s.id,phase);items=await rows(env,'SELECT * FROM project_phase_tasks WHERE submission_id=? AND phase=?',s.id,phase);}
 const p=summarize(jobs,items,phase);if(phase===1&&preparation.some(x=>x.status!=='COMPLETE')){p.status=preparation.some(x=>x.status==='NEEDS_REVIEW')?'NEEDS_REVIEW':'PREPARING';p.errors=preparation.map(x=>x.error).filter(Boolean);}
 const at=new Date().toISOString();
 if(p.status!=='WAITING'){
 const previous=await env.DB.prepare('SELECT * FROM project_phase_tracking WHERE submission_id=? AND phase=?').bind(s.id,phase).first();
 const finished=['COMPLETE','DRAFTS_READY'].includes(p.status)?at:null;
 if(!previous||previous.status!==p.status)await env.DB.batch([
 env.DB.prepare(`INSERT INTO project_phase_tracking(submission_id,phase,status,first_seen_at,finished_at,last_changed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(submission_id,phase) DO UPDATE SET status=excluded.status,finished_at=excluded.finished_at,last_changed_at=excluded.last_changed_at`).bind(s.id,phase,p.status,at,finished,at),
 env.DB.prepare('INSERT INTO project_phase_tracking_events(submission_id,phase,status,observed_at) VALUES(?,?,?,?)').bind(s.id,phase,p.status,at)
 ]);
 }
 const track=await env.DB.prepare('SELECT * FROM project_phase_tracking WHERE submission_id=? AND phase=?').bind(s.id,phase).first();
 phases.push({...p,startedAt:track?.first_seen_at||null,finishedAt:track?.finished_at||null,updatedAt:track?.last_changed_at||null});
 }
 const catalog=await env.DB.prepare("SELECT (SELECT COUNT(*) FROM phase_three_divisions WHERE edition='2026') divisions,(SELECT COUNT(*) FROM phase_four_sections WHERE edition='2026') sections").first();
 const blockers=[];if(!catalog.divisions||!catalog.sections)blockers.push('Verified CSI 2026 catalog is needed before divisions and sections can complete.');
 const deliveries=await rows(env,"SELECT status,COUNT(*) n FROM phase_five_estimate_outbox WHERE submission_id=? GROUP BY status",s.id);
 if(!deliveries.length||deliveries.some(x=>x.status==='WAITING_ESTIMATE_CONNECTION'))blockers.push('BASK estimate delivery connection has not been verified.');
 for(const p of phases)if(p.status==='NEEDS_REVIEW')blockers.push(`Phase ${p.phase}: ${p.errors[0]||'Review required before proceeding.'}`);
 const events=await rows(env,'SELECT phase,status,observed_at FROM project_phase_tracking_events WHERE submission_id=? ORDER BY id DESC LIMIT 40',s.id);
 const repairRequests=await rows(env,"SELECT * FROM project_repair_requests WHERE submission_id=? ORDER BY created_at DESC LIMIT 30",s.id);
 projects.push({preparation,repairRequests,id:s.id,projectId:s.project_id,projectName:s.project_name,createdAt:s.sealed_at,phases,blockers,events});
 }
 return {checkedAt:new Date().toISOString(),projects};
}
export async function intakeDashboardRoute(request,env){
 const path=new URL(request.url).pathname;
 if(!['/api/intake-dashboard','/api/intake-dashboard/repair'].includes(path))return null;
 if((path.endsWith('/repair')&&request.method!=='POST')||(!path.endsWith('/repair')&&request.method!=='GET'))return new Response('Method not allowed',{status:405});
 const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!env.INTAKE_DASHBOARD_SHA256||digest!==env.INTAKE_DASHBOARD_SHA256)return new Response('Unauthorized',{status:401});
 if(path.endsWith('/repair')){
 let b;try{const raw=await request.text();if(raw.length>2000)throw Error();b=JSON.parse(raw);}catch{return Response.json({error:'Invalid repair request'},{status:400});}
 if(!Number.isInteger(b.phase)||b.phase<1||b.phase>13||typeof b.submissionId!=='string')return Response.json({error:'Invalid phase'},{status:400});
 const submission=await env.DB.prepare('SELECT id FROM phase_project_submissions WHERE id=?').bind(b.submissionId).first();if(!submission)return Response.json({error:'Unknown project'},{status:404});
 await env.DB.prepare('INSERT OR IGNORE INTO project_repair_requests(id,submission_id,phase,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),b.submissionId,b.phase,new Date().toISOString()).run();
 return Response.json({status:'REQUESTED',message:'Saved for the next hourly Mason check.'});
 }
 return Response.json(await intakeProgress(env),{headers:{'cache-control':'no-store'}});
}

