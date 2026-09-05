import {requirePlanLayers} from './plan-layer-handoff.js';
import {askSource,jsonObject,saveArtifact,addIssue,now,stale,text,audit} from './project-phase-common.js';
import {calculateQuantity} from './quantity-engine.js';

export const TAKEOFF_WORKERS=['ENVELOPE_SITE','INTERIOR_SPACES','OPENINGS','SYSTEMS_FOUNDATIONS'];
const WORKER_INSTRUCTIONS={
 ENVELOPE_SITE:'Trace exterior envelope physical-wall centerlines, building footprint and measurable site boundaries. Preserve gross continuous wall spans through window openings and record openings separately. Do not infer materials from line appearance.',
 INTERIOR_SPACES:'Traverse left-to-right then top-to-bottom. Trace canonical physical interior walls once, room/floor polygons, room names/numbers and adjacency. A shared partition is one physical wall with two possible finish faces; do not double-count room perimeters. Heights and assemblies require cited detail evidence.',
 OPENINGS:'Record doors and windows by canonical object ID, mark, size, swing when shown, room adjacency and gross opening span. Reconcile drawn objects with schedules without counting the same object twice. Sliding doors must not be silently classified as windows.',
 SYSTEMS_FOUNDATIONS:'Trace only supported discipline-specific counts and runs for electrical, piping, HVAC, structural foundations and site systems. Vertical offsets, fittings, depths, pile lengths and material types require cited notes, schedules, sections or details; otherwise create an exclusion.'
};
const basePrompt=kind=>`Phase Nine takeoff worker ${kind}. ${WORKER_INSTRUCTIONS[kind]} Use only applicable supplied scope IDs. Identify each viewport scale independently; printed scale labels are not calibration. Dimensional LF/SF/CY work requires two labeled, approximately perpendicular dimension anchors agreeing within 0.5 percent. EA counts do not require scale but each marker must be unique. Return {completeReview:true,objects:[{canonicalId,objectType,scopeId,description,size,unit:LF|SF|CY|EA,location,evidence,geometry:{viewport:[xMin,yMin,xMax,yMax],points:[[x,y]],closed:boolean,depthFeet:null,anchors:[{points:[[x,y],[x,y]],knownFeet:number,label:string}],notToScale:boolean},roomNames:[],roomNumbers:[],adjacentRooms:[],finishFaces:[]}],exclusions:[{description,location,evidence}]}. Coordinates are PDF points with lower-left origin. Never invent coordinates, scope, dimensions, materials or verification. Return completeReview true even when nothing applies, with a cited exclusion when evidence is unresolved.`;
const evidenceValid=v=>text(v?.location)&&text(v?.evidence);

export function normalizeWorkerResult(data,scopes,kind){
 if(data?.completeReview!==true||!Array.isArray(data.objects)||!Array.isArray(data.exclusions))throw new Error('Takeoff worker coverage incomplete');
 const allowed=new Set(scopes.map(s=>s.id));
 const objects=data.objects.map((v,index)=>{
  if(!allowed.has(v.scopeId)||!text(v.canonicalId,200)||!text(v.objectType,100)||!text(v.description)||!evidenceValid(v)||!['LF','SF','CY','EA'].includes(v.unit)||!v.geometry||typeof v.geometry!=='object')throw new Error(`Invalid ${kind} object ${index}`);
  return {worker:kind,canonicalId:text(v.canonicalId,200),objectType:text(v.objectType,100),scopeId:v.scopeId,description:text(v.description),size:text(v.size,300),unit:v.unit,geometry:v.geometry,source:{location:text(v.location),evidence:text(v.evidence)},roomNames:Array.isArray(v.roomNames)?v.roomNames.map(x=>text(x,100)).filter(Boolean):[],roomNumbers:Array.isArray(v.roomNumbers)?v.roomNumbers.map(x=>text(x,100)).filter(Boolean):[],adjacentRooms:Array.isArray(v.adjacentRooms)?v.adjacentRooms.map(x=>text(x,100)).filter(Boolean):[],finishFaces:Array.isArray(v.finishFaces)?v.finishFaces:[]};
 });
 for(const e of data.exclusions)if(!text(e?.description)||!evidenceValid(e))throw new Error(`Uncited ${kind} exclusion`);
 return {objects,exclusions:data.exclusions.map(e=>({worker:kind,description:text(e.description),location:text(e.location),evidence:text(e.evidence)}))};
}

const roundedPoints=points=>(points||[]).map(p=>p.map(n=>Math.round(n*1000)/1000));
export function recorderKey(item){
 const points=roundedPoints(item.geometry?.points);
 if(item.objectType.toUpperCase().includes('WALL')&&points.length===2){const ends=[points[0].join(','),points[1].join(',')].sort();return `PHYSICAL_WALL:${ends.join('|')}`;}
 return `${item.objectType.toUpperCase()}:${item.scopeId}:${item.canonicalId.toUpperCase()}`;
}

async function scopesForTask(env,task){
 const rows=(await env.DB.prepare('SELECT * FROM phase_five_estimate_outbox WHERE submission_id=? ORDER BY id').bind(task.submission_id).all()).results||[];
 return rows.filter(r=>JSON.parse(r.evidence_json).some(e=>e.sourceFileId===task.file_id));
}

export async function startTakeoffCrew(task,env){
 const prepared=await requirePlanLayers(env,task.file_id);
 if(prepared.status==='REFERENCE_ONLY')return {status:'COMPLETE',key:await saveArtifact(env,task.submission_id,9,task.id,{status:'REFERENCE_ONLY',routing:JSON.parse(prepared.route_json),note:'Retained in Mason Brain; no geometry takeoff.'})};
 const scopes=await scopesForTask(env,task);
 if(!scopes.length)return {status:'COMPLETE',key:await saveArtifact(env,task.submission_id,9,task.id,{status:'NO_APPLICABLE_ESTIMATE_SCOPE',note:'Measurable drawing retained in Mason Brain; no existing supported scope line applies.'})};
 const at=now();
 await env.DB.prepare("INSERT OR IGNORE INTO takeoff_crew_runs(task_id,submission_id,file_id,page,status,started_at,updated_at) VALUES(?,?,?,?, 'RUNNING',?,?)").bind(task.id,task.submission_id,task.file_id,task.page,at,at).run();
 await env.DB.batch(TAKEOFF_WORKERS.map(kind=>env.DB.prepare('INSERT OR IGNORE INTO takeoff_worker_jobs(id,task_id,worker_kind,updated_at) VALUES(?,?,?,?)').bind(`${task.id}-${kind}`,task.id,kind,at)));
 await queueTakeoffCrew(env,task.id);
 return {status:'WAITING_CREW',key:null};
}

export async function queueTakeoffCrew(env,onlyTask=null){
 const jobs=(await env.DB.prepare(`SELECT j.id FROM takeoff_worker_jobs j JOIN takeoff_crew_runs r ON r.task_id=j.task_id WHERE r.status='RUNNING' AND (? IS NULL OR j.task_id=?) AND (j.status='PENDING' OR (j.status IN ('QUEUED','RUNNING') AND j.updated_at<?)) ORDER BY j.updated_at LIMIT 20`).bind(onlyTask,onlyTask,stale()).all()).results||[];
 for(const job of jobs){
  const changed=await env.DB.prepare("UPDATE takeoff_worker_jobs SET status='QUEUED',updated_at=? WHERE id=? AND (status='PENDING' OR (status IN ('QUEUED','RUNNING') AND updated_at<?))").bind(now(),job.id,stale()).run();
  if(!changed.meta.changes)continue;
  try{await env.DEPARTMENT_QUEUE.send({kind:'TAKEOFF_WORKER',id:job.id});}catch(error){await env.DB.prepare("UPDATE takeoff_worker_jobs SET status='PENDING',error=? WHERE id=? AND status='QUEUED'").bind(String(error.message||error).slice(0,400),job.id).run();throw error;}
 }
}

async function finishCrew(env,task){
 const pending=await env.DB.prepare("SELECT COUNT(*) n FROM takeoff_worker_jobs WHERE task_id=? AND status NOT IN ('COMPLETE','NEEDS_REVIEW')").bind(task.id).first();
 if(Number(pending.n||0))return;
 const claim=await env.DB.prepare("UPDATE takeoff_crew_runs SET status='RECORDING',updated_at=? WHERE task_id=? AND status='RUNNING'").bind(now(),task.id).run();if(!claim.meta.changes)return;
 const jobs=(await env.DB.prepare('SELECT * FROM takeoff_worker_jobs WHERE task_id=? ORDER BY worker_kind').bind(task.id).all()).results||[];
 try{
  const failed=jobs.filter(j=>j.status==='NEEDS_REVIEW');
  if(failed.length){for(const [i,j] of failed.entries())await addIssue(env,task,`crew-${i}`,`${j.worker_kind} takeoff worker needs review`,'Review the cited page evidence or rerun this specialist.',{location:`Page ${task.page}`,evidence:j.error||'Worker could not complete a source-grounded review.'});throw new Error('One or more takeoff specialists require review');}
  const results=await Promise.all(jobs.map(j=>jsonObject(env,j.result_key)));const seen=new Map(),items=[],exclusions=[];
  for(const result of results){for(const item of result.objects){let quantity;try{quantity=calculateQuantity(item.unit,item.geometry);}catch(error){exclusions.push({worker:item.worker,description:String(error.message||error),location:item.source.location,evidence:item.source.evidence});continue;}const key=recorderKey(item),previous=seen.get(key);if(previous){exclusions.push({worker:'RECORDER',description:`Duplicate or conflicting canonical object ${key}`,location:item.source.location,evidence:item.source.evidence});continue;}seen.set(key,item);items.push({...item,recorderKey:key,quantity});}exclusions.push(...result.exclusions);}
  const manifest={status:'CANDIDATE_MEASUREMENTS_RETURNED_TO_BRAIN',taskId:task.id,sourceFileId:task.file_id,page:task.page,workers:jobs.map(j=>({kind:j.worker_kind,status:j.status,resultKey:j.result_key})),items,exclusions,recorder:{method:'DETERMINISTIC_CANONICAL_OBJECT_LEDGER',sharedPhysicalWallsCountedOnce:true,finishFacesRetainedSeparately:true,verificationStatus:'INDEPENDENT_SOURCE_VERIFICATION_REQUIRED'},recordedAt:now()};
  const key=await saveArtifact(env,task.submission_id,9,`${task.id}-takeoff-crew`,manifest);
  for(let i=0;i<items.length;i++){const v=items[i];await env.DB.prepare(`INSERT OR IGNORE INTO project_takeoffs(id,submission_id,task_id,scope_id,description,unit,quantity,geometry_json,source_json,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'NEEDS_VERIFICATION',?)`).bind(`${task.id}-crew-${i}`,task.submission_id,task.id,v.scopeId,v.description,v.unit,v.quantity,JSON.stringify({...v.geometry,canonicalId:v.canonicalId,objectType:v.objectType,finishFaces:v.finishFaces}),JSON.stringify({...v.source,size:v.size,fileId:task.file_id,page:task.page,worker:v.worker,recorderKey:v.recorderKey,roomNames:v.roomNames,roomNumbers:v.roomNumbers,adjacentRooms:v.adjacentRooms}),now()).run();}
  for(let i=0;i<exclusions.length;i++){const e=exclusions[i];await addIssue(env,task,`crew-exclusion-${i}`,e.description,'Confirm takeoff treatment or provide controlling readable evidence.',e);}
  const taskStatus=items.length?'WAITING_VERIFICATION':'WAITING_REVIEW';
  await env.DB.batch([env.DB.prepare("UPDATE takeoff_crew_runs SET status='COMPLETE',manifest_key=?,error=NULL,updated_at=?,finished_at=? WHERE task_id=? AND status='RECORDING'").bind(key,now(),now(),task.id),env.DB.prepare('UPDATE project_phase_tasks SET status=?,result_key=?,error=NULL,updated_at=? WHERE id=?').bind(taskStatus,key,now(),task.id)]);
  await audit(env,task.submission_id,'TAKEOFF_CREW_RETURN',task.id,{items:items.length,exclusions:exclusions.length,manifestKey:key});
 }catch(error){await env.DB.batch([env.DB.prepare("UPDATE takeoff_crew_runs SET status='NEEDS_REVIEW',error=?,updated_at=? WHERE task_id=?").bind(String(error.message||error).slice(0,500),now(),task.id),env.DB.prepare("UPDATE project_phase_tasks SET status='WAITING_REVIEW',error=?,updated_at=? WHERE id=?").bind(String(error.message||error).slice(0,500),now(),task.id)]);}
}

export async function processTakeoffWorker(body,env){
 const job=await env.DB.prepare('SELECT * FROM takeoff_worker_jobs WHERE id=?').bind(body.id).first();if(!job||!['PENDING','QUEUED','RUNNING'].includes(job.status))return;
 const task=await env.DB.prepare('SELECT * FROM project_phase_tasks WHERE id=?').bind(job.task_id).first();if(!task)return;
 const lease=await env.DB.prepare("UPDATE takeoff_worker_jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND (status IN ('PENDING','QUEUED') OR (status='RUNNING' AND updated_at<?))").bind(now(),job.id,stale()).run();if(!lease.meta.changes)return;
 try{
  const prepared=await requirePlanLayers(env,task.file_id),scopes=await scopesForTask(env,task);
  const data=await askSource(env,prepared.layered_file_id,null,basePrompt(job.worker_kind),{worker:job.worker_kind,originalSourceFileId:task.file_id,originalPage:task.page,brainRecords:await Promise.all(JSON.parse(prepared.brain_keys_json).map(key=>jsonObject(env,key))),scopes:scopes.map(s=>({id:s.id,section:s.section_code,scope:s.scope_text})),rules:{sharedWall:'one physical wall; two finish faces',traversal:'left-to-right then top-to-bottom',windows:'gross wall spans retained; openings recorded separately'}},[{fileId:task.file_id,page:task.page}]);
  const result=normalizeWorkerResult(data,scopes,job.worker_kind),key=await saveArtifact(env,task.submission_id,9,job.id,result);
  await env.DB.batch([env.DB.prepare("UPDATE takeoff_worker_jobs SET status='COMPLETE',result_key=?,error=NULL,updated_at=?,finished_at=? WHERE id=?").bind(key,now(),now(),job.id),env.DB.prepare('UPDATE project_phase_tasks SET updated_at=? WHERE id=?').bind(now(),task.id)]);
  await finishCrew(env,task);
 }catch(error){const terminal=job.attempts+1>=5;await env.DB.prepare('UPDATE takeoff_worker_jobs SET status=?,error=?,updated_at=? WHERE id=?').bind(terminal?'NEEDS_REVIEW':'PENDING',String(error.message||error).slice(0,500),now(),job.id).run();if(terminal)await finishCrew(env,task);else throw error;}
}
