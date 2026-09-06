import {checkScale} from './scale-gate.js';
import {calculateQuantity} from './quantity-engine.js';
import {now,readSource,audit,text} from './project-phase-common.js';
import {importDivisionCatalog} from './phase-three-review.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function projectPhaseRoute(request,env){
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/project-phases/'))return null;
 if(!env.MASON_API_TOKEN||request.headers.get('authorization')!==`Bearer ${env.MASON_API_TOKEN}`)return json({error:'Unauthorized'},401);
 const parts=url.pathname.slice('/api/project-phases/'.length).split('/').map(decodeURIComponent);const [submission,resource,id,action]=parts;
 const s=await env.DB.prepare('SELECT id FROM phase_project_submissions WHERE id=?').bind(submission).first();if(!s)return json({error:'Submission not registered'},404);
 if(request.method==='GET'&&parts.length===1){
  const phases={};
  for(const [phase,table,key] of [[2,'phase_two_jobs','id'],[3,'phase_three_jobs','id'],[4,'phase_four_jobs','submission_id'],[5,'phase_five_jobs','submission_id'],[6,'phase_six_brains','submission_id'],[7,'phase_seven_jobs','submission_id']])phases[phase]=(await env.DB.prepare(`SELECT status,COUNT(*) count FROM ${table} WHERE ${key}=? GROUP BY status`).bind(submission).all()).results||[];
  return json({submission,phases,phaseThreeCatalog:await env.DB.prepare("SELECT edition,source_reference,verified_at FROM phase_three_catalogs WHERE edition='2026'").first(),completionPhases:(await env.DB.prepare('SELECT * FROM project_phase_runs WHERE submission_id=? ORDER BY phase').bind(submission).all()).results,
   blockedTasks:(await env.DB.prepare("SELECT id,phase,file_id,page,status,error FROM project_phase_tasks WHERE submission_id=? AND status NOT IN ('COMPLETE','PENDING','QUEUED','RUNNING') ORDER BY phase LIMIT 100").bind(submission).all()).results,
   openIssues:(await env.DB.prepare("SELECT * FROM project_review_issues WHERE submission_id=? AND status='OPEN' LIMIT 100").bind(submission).all()).results});
 }
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(Number(request.headers.get('content-length')||0)>1000000)return json({error:'Request too large'},413);
 let body;try{const raw=await request.text();if(raw.length>1000000)return json({error:'Request too large'},413);body=JSON.parse(raw);}catch{return json({error:'Valid JSON required'},400);}
 const finalized=await env.DB.prepare("SELECT status FROM project_phase_runs WHERE submission_id=? AND phase=12 AND status='COMPLETE'").bind(submission).first();
 if(finalized&&resource!=='candidates')return json({error:'Final estimate is immutable; register a new submission revision for changes'},409);
 try{
  if(resource==='catalogs'&&id==='2026'&&action==='import'){
   const result=await importDivisionCatalog(env,submission,Number(body.sourceFileId),String(body.sourceSha256||''));
   await audit(env,submission,'IMPORT_PHASE_THREE_CATALOG','2026',result);
   return json(result);
  }
  // A mixed sheet must have its measurable and reference regions approved
  // before the measuring-layer builder can receive it; the approval is audited.
  if(resource==='layers'&&action==='regions'){
   const job=await env.DB.prepare(`SELECT l.* FROM plan_layer_jobs l WHERE l.id=? AND l.source_file_id IN (SELECT value FROM json_each((SELECT source_file_ids_json FROM phase_project_submissions WHERE id=?)))`).bind(id,submission).first();
   if(!job||job.status!=='REGION_REVIEW_REQUIRED')return json({error:'Mixed-sheet region review not found'},409);
   let route;try{route=JSON.parse(job.route_json||'{}');}catch{return json({error:'Saved sheet route is invalid'},409);}
   if(route.route!=='MIXED'||!Array.isArray(route.regions)||!route.regions.length)return json({error:'A complete mixed-sheet route is required'},409);
   const measurable=route.regions.filter(x=>/TAKEOFF|MEASURABLE/i.test(String(x?.purpose||'')));
   if(body.regionsReviewed!==true||!text(body.reviewer)||!text(body.evidence)||!measurable.length)return json({error:'Reviewer, evidence, complete region review, and at least one routed measurable region required'},400);
   const review={reviewer:text(body.reviewer),evidence:text(body.evidence),regionsReviewed:true,measurableRegions:measurable,referenceRegions:route.regions.filter(x=>!measurable.includes(x)),at:now()};
   await audit(env,submission,'VERIFY_MIXED_SHEET_REGIONS',id,review);
   await env.DB.prepare("UPDATE plan_layer_jobs SET status='PENDING',route_json=?,error=NULL,updated_at=? WHERE id=? AND status='REGION_REVIEW_REQUIRED'").bind(JSON.stringify({...route,regionReview:review}),now(),id).run();
   return json({id,status:'PENDING',measurableRegions:measurable.length,referenceRegions:review.referenceRegions.length});
  }
  if(resource==='layers'&&action==='verify'){
   const job=await env.DB.prepare(`SELECT l.* FROM plan_layer_jobs l WHERE l.id=? AND l.source_file_id IN (SELECT value FROM json_each((SELECT source_file_ids_json FROM phase_project_submissions WHERE id=?)))`).bind(id,submission).first();
   if(!job||job.status!=='LAYER_REVIEW_REQUIRED'||!job.layered_file_id)return json({error:'Completed layer package requiring review not found'},409);
   if(body.classificationComplete!==true||!text(body.reviewer)||!text(body.evidence)||!/^[a-f0-9]{64}$/.test(body.sourceSha256||'')||!/^[a-f0-9]{64}$/.test(body.layerSha256||''))return json({error:'Source and layer hashes, reviewer and classification evidence required'},400);
   const source=await readSource(env,job.plan_file_id),layer=await readSource(env,job.layered_file_id);
   const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
   if(await hash(source.bytes)!==job.source_sha256||body.sourceSha256!==job.source_sha256||await hash(layer.bytes)!==body.layerSha256)return json({error:'Source or measuring layer hash differs'},409);
   const object=await env.PROJECT_FILES.get(job.manifest_key);if(!object)return json({error:'Layer manifest missing'},409);const manifest=JSON.parse(await object.text());
   if(manifest.artifactSha256?.['layers.pdf']!==body.layerSha256)return json({error:'Measuring file differs from recorded layer build'},409);
   const review={reviewer:text(body.reviewer),evidence:text(body.evidence),sourceSha256:job.source_sha256,layerSha256:body.layerSha256,classificationComplete:true,scaleVerified:false,at:now()};
   await audit(env,submission,'VERIFY_PLAN_LAYERS',id,review);
   await env.PROJECT_FILES.put(job.manifest_key+'.review.json',JSON.stringify(review));
   await env.DB.prepare("UPDATE plan_layer_jobs SET status='READY_FOR_TAKEOFF',error=NULL,updated_at=? WHERE id=? AND status='LAYER_REVIEW_REQUIRED'").bind(now(),id).run();
   return json({id,status:'READY_FOR_TAKEOFF',scaleVerified:false});
  }
  if(resource==='takeoffs'&&parts.length===2){
   const scope=await env.DB.prepare('SELECT id FROM phase_five_estimate_outbox WHERE id=? AND submission_id=?').bind(body.scopeId||'',submission).first();
   const task=await env.DB.prepare('SELECT id FROM project_phase_tasks WHERE submission_id=? AND phase=9 AND file_id=? AND page=?').bind(submission,body.fileId||0,body.page||0).first();
   if(!scope||!task||!text(body.description)||!text(body.location)||!text(body.evidence)||!['LF','SF','CY','EA'].includes(body.unit))return json({error:'Existing scope and drawing task, description, units and cited source required'},400);
   calculateQuantity(body.unit,body.geometry);
   const itemId=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO project_takeoffs(id,submission_id,task_id,scope_id,description,unit,geometry_json,source_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(itemId,submission,task.id,scope.id,text(body.description),body.unit,JSON.stringify(body.geometry),JSON.stringify({fileId:body.fileId,page:body.page,location:body.location,evidence:body.evidence}),now()).run();
   await audit(env,submission,'ADD_CORRECTIVE_TAKEOFF',itemId,{scopeId:scope.id});return json({id:itemId,status:'NEEDS_VERIFICATION'});
  }
  if(resource==='takeoffs'&&action==='verify'){
   const item=await env.DB.prepare('SELECT * FROM project_takeoffs WHERE id=? AND submission_id=?').bind(id,submission).first();if(!item)return json({error:'Takeoff missing'},404);
   if(body.sourceReviewed!==true||!text(body.reviewer)||!text(body.evidence)||!text(body.sourceSha256))return json({error:'Independent source review, reviewer, evidence and source hash required'},400);
   const source=JSON.parse(item.source_json);const {bytes}=await readSource(env,source.fileId,null);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==body.sourceSha256)return json({error:'Source hash changed or does not match'},409);
   const geometry=body.geometry||JSON.parse(item.geometry_json);const quantity=calculateQuantity(item.unit,geometry);
   if(!Number.isFinite(quantity)||quantity<=0)return json({error:'Quantity must be positive'},400);
   const scaleGate=item.unit==='EA'?{status:'COUNT_ONLY_NO_DIMENSIONAL_SCALE'}:{...checkScale(geometry),status:'SOURCE_REVIEWED',sourceSha256:hash,fileId:source.fileId,page:source.page};
   const verification={scaleGate,reviewer:text(body.reviewer),evidence:text(body.evidence),sourceSha256:hash,at:now(),method:'INDEPENDENT_SOURCE_REVIEW_AND_GEOMETRY_CHECK'};
   await audit(env,submission,'VERIFY_TAKEOFF',id,{before:item,geometry,quantity,verification});
   await env.DB.prepare("UPDATE project_takeoffs SET geometry_json=?,quantity=?,status='VERIFIED',verification_json=?,updated_at=? WHERE id=? AND submission_id=?").bind(JSON.stringify(geometry),quantity,JSON.stringify(verification),now(),id,submission).run();
   return json({id,quantity,unit:item.unit,status:'VERIFIED'});
  }
  if(resource==='issues'&&action==='resolve'){
   const issue=await env.DB.prepare('SELECT * FROM project_review_issues WHERE id=? AND submission_id=?').bind(id,submission).first();if(!issue)return json({error:'Issue missing'},404);
   if(!text(body.resolution)||!text(body.reviewer)||!text(body.evidence))return json({error:'Resolution, reviewer and source evidence required'},400);
   const resolution={resolution:text(body.resolution),reviewer:text(body.reviewer),evidence:text(body.evidence),at:now()};
   await audit(env,submission,'RESOLVE_ISSUE',id,{before:issue,resolution});
   await env.DB.prepare("UPDATE project_review_issues SET status='RESOLVED',resolution_json=?,updated_at=? WHERE id=? AND submission_id=?").bind(JSON.stringify(resolution),now(),id,submission).run();return json({id,status:'RESOLVED'});
  }
  if(resource==='retry'&&parts.length===2){
   const phase=Number(body.phase);if(!Number.isInteger(phase)||phase<7||phase>13)return json({error:'Retry phase must be 7–13'},400);
   await audit(env,submission,'RETRY_PHASE',String(phase),{reason:text(body.reason)});
   if(phase===7){await env.DB.prepare("UPDATE phase_seven_items SET status='PENDING',attempts=0,error=NULL,updated_at=? WHERE submission_id=? AND status='NEEDS_REVIEW'").bind(now(),submission).run();await env.DB.prepare("UPDATE phase_seven_jobs SET status='RUNNING',updated_at=? WHERE submission_id=? AND status='NEEDS_REVIEW'").bind(now(),submission).run();}
   else{
    await env.DB.prepare("UPDATE project_phase_tasks SET status='PENDING',attempts=0,error=NULL,updated_at=? WHERE submission_id=? AND phase=? AND status='NEEDS_REVIEW'").bind(now(),submission,phase).run();
    if(phase===8)await env.DB.prepare("UPDATE project_plan_sources SET status='PENDING',error=NULL WHERE submission_id=? AND status='NEEDS_REVIEW'").bind(submission).run();
    await env.DB.prepare("UPDATE project_phase_runs SET status='RUNNING',attempts=0,error=NULL,updated_at=? WHERE submission_id=? AND phase=? AND status IN ('NEEDS_REVIEW','WAITING_REVIEW')").bind(now(),submission,phase).run();
   }
   return json({status:'RETRY_SCHEDULED',phase});
  }
  if(resource==='candidates'&&parts.length===2){
   if(!text(body.company)||!text(body.sectionCode)||!body.contact||!body.qualifications||!text(body.qualifications.source)||!text(body.qualifications.serviceArea)||!text(body.qualifications.capacity)||!text(body.qualifications.availability))return json({error:'Company, section, contact and sourced service-area/capacity/availability qualifications required'},400);
   const section=await env.DB.prepare('SELECT section_code FROM phase_four_estimate_outbox WHERE submission_id=? AND section_code=?').bind(submission,body.sectionCode).first();if(!section)return json({error:'Section not in project scope'},400);
   const candidateId=crypto.randomUUID();await env.DB.prepare('INSERT INTO project_bid_candidates(id,submission_id,section_code,company,contact_json,qualification_json,status,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(candidateId,submission,body.sectionCode,text(body.company),JSON.stringify(body.contact),JSON.stringify(body.qualifications),body.verified===true?'VERIFIED':'UNVERIFIED',now()).run();
   await audit(env,submission,'ADD_BID_CANDIDATE',candidateId,{company:body.company});
   await env.DB.prepare("UPDATE project_phase_runs SET status='RUNNING',updated_at=? WHERE submission_id=? AND phase=13 AND status='DRAFTS_READY'").bind(now(),submission).run();return json({id:candidateId,status:'CANDIDATE_SAVED',sent:false});
  }
  return json({error:'Unknown phase operation'},404);
 }catch(error){return json({error:String(error.message||error).slice(0,500)},400);}
}
