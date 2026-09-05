import {checkScale} from './scale-gate.js';
import {askSource,jsonObject,saveArtifact,addIssue,now,text} from './project-phase-common.js';

async function scopesForFile(env,submission,fileId){
 const rows=(await env.DB.prepare('SELECT * FROM phase_five_estimate_outbox WHERE submission_id=? ORDER BY id').bind(submission).all()).results||[];
 return rows.filter(r=>JSON.parse(r.evidence_json).some(e=>e.sourceFileId===fileId));
}
const evidenceValid=v=>text(v?.location)&&text(v?.evidence);
export function normalizeSheet(d){
 if(d.completeReview!==true||typeof d.isDrawing!=='boolean'||!text(d.summary))throw new Error('Incomplete page review');
 if(d.isDrawing&&!text(d.sheetId))throw new Error('Drawing sheet identifier is unresolved');
 if(!Array.isArray(d.references)||!Array.isArray(d.brokenChains)||!Array.isArray(d.limitations))throw new Error('Page review coverage fields missing');
 for(const item of [...d.references,...d.brokenChains])if(!evidenceValid(item))throw new Error('Page finding lacks evidence');
 for(const r of d.references)if(!text(r.sheetId))throw new Error('Unresolved drawing reference');
 for(const b of d.brokenChains)if(!text(b.description)||!text(b.question))throw new Error('Broken chain needs a description and draft RFI');
 if(d.limitations.length)throw new Error('Page requires review: '+d.limitations.map(String).join('; ').slice(0,500));
 return {isDrawing:d.isDrawing,sheetId:text(d.sheetId,100),summary:text(d.summary,6000),references:d.references,brokenChains:d.brokenChains};
}
async function sheetReview(task,env){
 const d=normalizeSheet(await askSource(env,task.file_id,task.page,
  'Phase Eight: review this page sheet-by-sheet. Learn its discipline, systems, details, notes and revision. Identify explicit referenced sheet IDs; separate missing details, contradictory notes, unclear interfaces and broken chains into cited draft RFIs. Do not declare a referenced sheet missing merely because it is not in this single-page input; the server will reconcile the register. Return {completeReview:true,isDrawing:boolean,sheetId,summary,references:[{sheetId,location,evidence}],brokenChains:[{description,question,location,evidence}],limitations:[]}. Use isDrawing=false for non-drawing pages and still summarize them.'));
 const key=await saveArtifact(env,task.submission_id,8,task.id,{...d,sourceFileId:task.file_id,page:task.page});
 await env.DB.prepare('INSERT OR REPLACE INTO project_sheet_register(task_id,submission_id,file_id,page,sheet_id,summary,result_key) VALUES(?,?,?,?,?,?,?)').bind(task.id,task.submission_id,task.file_id,task.page,d.isDrawing?d.sheetId:null,d.summary,key).run();
 for(let i=0;i<d.brokenChains.length;i++){const b=d.brokenChains[i];await addIssue(env,task,`chain-${i}`,b.description,b.question,{location:b.location,evidence:b.evidence});}
 return {key,status:'COMPLETE'};
}

export function normalizeTakeoffs(data,scopes){
 if(data.completeReview!==true||!Array.isArray(data.items)||!Array.isArray(data.exclusions))throw new Error('Takeoff coverage incomplete');
 const allowed=new Set(scopes.map(s=>s.id));
 return data.items.map((v,index)=>{
  if(!allowed.has(v.scopeId)||!text(v.description)||!evidenceValid(v)||!['LF','SF','CY','EA'].includes(v.unit)||!v.geometry||typeof v.geometry!=='object')throw new Error('Invalid or unsupported takeoff item '+index);
  return {scopeId:v.scopeId,description:text(v.description),size:text(v.size,300),unit:v.unit,geometry:v.geometry,source:{location:v.location,evidence:v.evidence}};
 });
}
async function takeoffReview(task,env){
 const scopes=await scopesForFile(env,task.submission_id,task.file_id);
 const data=await askSource(env,task.file_id,task.page,
  'Phase Nine: perform detailed takeoff tracing for the supplied applicable scope lines on this page, including walls, pipes, conduit, fixtures, fittings and sizes. Do not duplicate schedules and drawn objects. Identify each viewport/detail scale; never borrow the main sheet scale for another detail. Return {completeReview:true,items:[{scopeId,description,size,unit:LF|SF|CY|EA,location,evidence,geometry:{viewport:[xMin,yMin,xMax,yMax],points:[[x,y]],closed:boolean,depthFeet:null,anchors:[{points:[[x,y],[x,y]],knownFeet:number,label:string}],notToScale:boolean}}],exclusions:[{description,location,evidence}]}. Coordinates are PDF points, origin lower left; FIRST GATE: do not trust the printed scale. Check two independent labeled dimensions approximately perpendicular to one another in this viewport before tracing dimensional work. If missing, NTS, or inconsistent by more than 0.5 percent, return a cited exclusion and no dimensional items for that viewport. Record at least two independent known-dimension anchors for each scaled viewport and all traced/count locations. Include every distinct size as its own item. Units LF for length, SF area, CY volume, EA count. These are candidates pending independent source verification; do not set any verification flag. If geometry, scale or source is unreadable explain in exclusions; never fabricate coordinates. Only use supplied scope IDs.',{scopes:scopes.map(s=>({id:s.id,section:s.section_code,scope:s.scope_text}))});
 const candidates=normalizeTakeoffs(data,scopes),items=[];
 for(const v of candidates){
  try{calculateQuantity(v.unit,v.geometry);items.push(v);}
  catch(error){data.exclusions.push({description:String(error.message||error),location:v.source.location,evidence:v.source.evidence});}
 }
 const key=await saveArtifact(env,task.submission_id,9,task.id,{items,exclusions:data.exclusions,status:'CANDIDATES_REQUIRE_VERIFICATION'});
 for(let i=0;i<items.length;i++){const v=items[i];await env.DB.prepare(`INSERT OR IGNORE INTO project_takeoffs(id,submission_id,task_id,scope_id,description,unit,geometry_json,source_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).bind(`${task.id}-${i}`,task.submission_id,task.id,v.scopeId,v.description,v.unit,JSON.stringify(v.geometry),JSON.stringify({...v.source,size:v.size,fileId:task.file_id,page:task.page}),now()).run();}
 for(let i=0;i<data.exclusions.length;i++){const e=data.exclusions[i];if(!text(e.description)||!evidenceValid(e))throw new Error('Uncited takeoff exclusion');await addIssue(env,task,`exclude-${i}`,e.description,'Confirm takeoff treatment or provide a readable scaled detail.',e);}
 if(!items.length&&!data.exclusions.length)await addIssue(env,task,'empty','No measurable scope identified on this drawing.','Confirm this drawing requires no takeoff.',{fileId:task.file_id,page:task.page});
 return {key,status:items.length||data.exclusions.length?'WAITING_VERIFICATION':'WAITING_REVIEW'};
}

export function calculateQuantity(unit,g){
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
 if(!g||!Array.isArray(g.points)||!g.points.length||g.points.some(p=>!point(p)))throw new Error('Trace coordinates required');
 if(!Array.isArray(g.viewport)||g.viewport.length!==4||!g.viewport.every(Number.isFinite))throw new Error('Viewport bounds required');
 const [x0,y0,x1,y1]=g.viewport;if(x1<=x0||y1<=y0)throw new Error('Invalid viewport');
 const inside=p=>p[0]>=x0&&p[0]<=x1&&p[1]>=y0&&p[1]<=y1;
 if(g.points.some(p=>!inside(p)))throw new Error('Trace outside calibrated viewport');
 if(unit==='EA'){if(new Set(g.points.map(p=>p.join(','))).size!==g.points.length)throw new Error('Duplicate count markers');return g.points.length;}
 const scale=checkScale(g).feetPerPdfPoint;
 if(unit==='LF'){if(g.points.length<2)throw new Error('Length needs two points');return g.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-g.points[i][0],p[1]-g.points[i][1])*scale,0);}
 if(!['SF','CY'].includes(unit)||g.points.length<3||g.closed!==true)throw new Error('Area requires a closed polygon');
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 for(let i=0;i<g.points.length;i++)for(let j=i+2;j<g.points.length;j++){if(i===0&&j===g.points.length-1)continue;const a=g.points[i],b=g.points[(i+1)%g.points.length],c=g.points[j],d=g.points[(j+1)%g.points.length];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)throw new Error('Self-intersecting polygon');}
 let area=0;for(let i=0;i<g.points.length;i++){const a=g.points[i],b=g.points[(i+1)%g.points.length];area+=a[0]*b[1]-b[0]*a[1];}area=Math.abs(area)/2*scale**2;
 if(area<=0)throw new Error('Zero polygon area');
 if(unit==='CY'){if(!Number.isFinite(g.depthFeet)||g.depthFeet<=0)throw new Error('Verified depth in feet required');return area*g.depthFeet/27;}
 return area;
}

async function finalReview(task,env){
 const scopes=await scopesForFile(env,task.submission_id,task.file_id);
 const takeoffs=(await env.DB.prepare("SELECT * FROM project_takeoffs WHERE submission_id=? AND json_extract(source_json,'$.fileId')=?").bind(task.submission_id,task.file_id).all()).results||[];
 const memories=(await env.DB.prepare('SELECT result_key FROM phase_six_items WHERE submission_id=? AND file_id=?').bind(task.submission_id,task.file_id).all()).results||[];
 const reports=(await env.DB.prepare('SELECT result_key FROM phase_seven_items WHERE submission_id=? AND file_id=?').bind(task.submission_id,task.file_id).all()).results||[];
 const context={scopes,takeoffs,memory:await Promise.all(memories.map(r=>jsonObject(env,r.result_key))),reportAnalysis:await Promise.all(reports.map(r=>jsonObject(env,r.result_key)))};
 const d=await askSource(env,task.file_id,task.page,
 'Phase Ten independent final review: compare this original source against the scope, memory, report recommendations and takeoff. Check missing work, double counts, wrong sizes/units, inconsistent quantities/scales, uncited facts, plan/report conflicts, exclusions and incomplete coverage. Return {completeReview:true,findings:[{description,question,location,evidence,scopeId:null,takeoffId:null,proposedCorrection:null}],limitations:[]}. Propose only source-supported corrections; never invent prices or resolve engineering ambiguities.',context);
 if(d.completeReview!==true||!Array.isArray(d.findings)||!Array.isArray(d.limitations)||d.limitations.length)throw new Error('Final source review incomplete');
 for(let i=0;i<d.findings.length;i++){const f=d.findings[i];if(!text(f.description)||!evidenceValid(f))throw new Error('Uncited review issue');if(f.scopeId&&!scopes.some(s=>s.id===f.scopeId))throw new Error('Correction scope outside source');if(f.takeoffId&&!takeoffs.some(t=>t.id===f.takeoffId))throw new Error('Correction takeoff outside source');await addIssue(env,task,`review-${i}`,f.description,f.question,f);}
 return {key:await saveArtifact(env,task.submission_id,10,task.id,d),status:'COMPLETE'};
}

async function correctionReview(task,env){
 const issue=await env.DB.prepare('SELECT * FROM project_review_issues WHERE id=? AND submission_id=?').bind(JSON.parse(task.input_json).issueId,task.submission_id).first();if(!issue)throw new Error('Correction issue missing');
 if(issue.status==='RESOLVED')return {key:await saveArtifact(env,task.submission_id,11,task.id,{issueId:issue.id,resolution:JSON.parse(issue.resolution_json)}),status:'COMPLETE'};
 const e=JSON.parse(issue.source_json);const scope=e.scopeId?await env.DB.prepare('SELECT * FROM phase_five_estimate_outbox WHERE id=? AND submission_id=?').bind(e.scopeId,task.submission_id).first():null;
 const d=await askSource(env,task.file_id,task.page,
 'Phase Eleven: resolve this review finding using original source evidence. Return {resolvable:boolean,reason,location,evidence,scopeText:null}. Only a source-supported short scope-text clarification may be automatically corrected, maximum 180 characters one line. Do not alter quantities, geometry, pricing, design or unresolved RFIs. Ambiguous or externally dependent issues must return resolvable:false.',{issue,scope});
 if(d.resolvable!==true||!scope||!text(d.scopeText,181)||d.scopeText.length>180||/[\r\n]/.test(d.scopeText)||!evidenceValid(d))return {key:await saveArtifact(env,task.submission_id,11,task.id,{...d,issueId:issue.id,status:'NEEDS_INPUT'}),status:'WAITING_REVIEW'};
 const check=await askSource(env,task.file_id,task.page,'Independently verify this proposed scope correction against the original. Return {supported:boolean,location,evidence,reason}. Reject new work, missing work, ambiguous design decisions or any unsupported change.',{before:scope.scope_text,after:d.scopeText,issue:issue.description});
 if(check.supported!==true||!evidenceValid(check))return {key:await saveArtifact(env,task.submission_id,11,task.id,{proposal:d,check,status:'NEEDS_INPUT'}),status:'WAITING_REVIEW'};
 const resolution={before:scope.scope_text,after:d.scopeText,source:{location:d.location,evidence:d.evidence},independentCheck:check,method:'SOURCE_CHECKED_SCOPE_CORRECTION',at:now()};
 // Corrections invalidate any earlier external delivery receipt.
 await env.DB.batch([
  env.DB.prepare("UPDATE phase_five_estimate_outbox SET scope_text=?,status='WAITING_ESTIMATE_CONNECTION' WHERE id=? AND submission_id=?").bind(d.scopeText,scope.id,task.submission_id),
  env.DB.prepare("UPDATE project_review_issues SET status='RESOLVED',resolution_json=?,updated_at=? WHERE id=? AND status='OPEN'").bind(JSON.stringify(resolution),now(),issue.id)
 ]);
 return {key:await saveArtifact(env,task.submission_id,11,task.id,{issueId:issue.id,resolution}),status:'COMPLETE'};
}
export async function handlePhaseTask(task,env){
 if(task.phase===8)return sheetReview(task,env);
 if(task.phase===9)return takeoffReview(task,env);
 if(task.phase===10)return finalReview(task,env);
 if(task.phase===11)return correctionReview(task,env);
 throw new Error('Unsupported review phase');
}
