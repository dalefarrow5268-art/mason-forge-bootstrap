import {queuePhaseFour,processPhaseFour,normalizeSections} from '../src/phase-four-review.js';
import {queuePhaseThree,processPhaseThree,normalizeDivisions} from '../src/phase-three-review.js';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ZipWriter,Uint8ArrayWriter,TextReader} from '@zip.js/zip.js';
import {queuePhaseTwo,processPhaseTwo,sourceIds,normalizeFacts} from '../src/phase-two-review.js';
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE project_files(id INTEGER PRIMARY KEY,project_id INTEGER,r2_key TEXT UNIQUE,file_name TEXT,relative_path TEXT,file_type TEXT,size_bytes INTEGER,review_status TEXT,source_class TEXT,uploaded_at TEXT,updated_at TEXT,archived_at TEXT); CREATE TABLE project_folders(id TEXT,project_id INTEGER,folder_path TEXT UNIQUE,created_at TEXT,updated_at TEXT);`);
sql.exec(readFileSync(new URL('../schema/0007_phase_one_review.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0008_phase_two.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0017_holding_preparation.sql',import.meta.url),'utf8')); 
sql.exec(readFileSync(new URL('../schema/0018_holding_brain_scan.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0020_holding_detail_tiles.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0022_plan_layer_handoff.sql',import.meta.url),'utf8'));
const DB={async batch(statements){return Promise.all(statements.map(s=>s.run()));},prepare(s){return {bind(...p){return {
 async run(){return {meta:{changes:sql.prepare(s).run(...p).changes}};},
 async first(){return sql.prepare(s).get(...p);},
 async all(){return {results:sql.prepare(s).all(...p)};}
 };},async first(){return sql.prepare(s).get();},async all(){return {results:sql.prepare(s).all()};}};}};
const objects=new Map(),sent=[];
const bucket={async head(k){return objects.has(k)?{size:objects.get(k).length}:null},async get(k,o){let b=objects.get(k);if(!b)return null;if(o?.range)b=b.slice(o.range.offset,o.range.offset+o.range.length);return{size:b.length,body:new Blob([b]).stream(),async text(){return new TextDecoder().decode(b)},async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}},async put(k,v){objects.set(k,typeof v==='string'?new TextEncoder().encode(v):v);},async delete(k){objects.delete(k)},async createMultipartUpload(k){const parts=[];return{async uploadPart(n,b){parts[n-1]=b.slice();return{partNumber:n,etag:String(n)}},async complete(){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}objects.set(k,out)},async abort(){objects.delete(k)}}}};
const env={DB,PROJECT_FILES:bucket,DEPARTMENT_QUEUE:{async send(b){sent.push(b)}}};
sql.exec(readFileSync(new URL('../schema/0008_phase_two.sql',import.meta.url),'utf8'));
assert.equal(sourceIds('[1,1]'),null);assert.equal(sourceIds('[]'),null);
assert.equal(normalizeFacts({findings:[{question:'Who',fact:'guess'}]}).findings.length,0);
sql.exec(`INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes) VALUES(1,13,'original','submission.zip','SSX Project Holding Folder/Phase One Project Review/Test/submission.zip',12);
INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes) VALUES(2,13,'copy','project.txt','SSX Project Holding Folder/Phase One Project Review/1/Docs/project.txt',12);
INSERT INTO phase_one_jobs VALUES('p1',1,'COMPLETE','now','now',NULL);
INSERT INTO phase_one_items(id,job_id,entry_index,original_path,size_bytes,status,output_file_id,updated_at) VALUES('p1-1','p1',0,'project.txt',12,'NEEDS_REVIEW',2,'now');
INSERT INTO phase_project_submissions VALUES('project-1',13,'Test Project','[1]','now',NULL);`);
await queuePhaseTwo(env);assert.equal(sent.length,0,'unresolved review blocks phase two');
sql.exec("UPDATE phase_one_items SET status='SORTED'");await queuePhaseTwo(env);assert.equal(sent.length,1);await queuePhaseTwo(env);assert.equal(sent.length,1,'no duplicate queue');
objects.set('copy',new TextEncoder().encode('Test project'));
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({findings:['Who','What','Where','When','Why'].map(q=>({question:q,field:q,fact:'Explicit source fact '+q,quote:'source excerpt',location:'section 1'})),limitations:[]})}]}]});
try{await processPhaseTwo(sent.shift(),{...env,OPENAI_API_KEY:'test'});}finally{globalThis.fetch=originalFetch;}
await queuePhaseTwo(env);assert.equal(sql.prepare('SELECT status FROM phase_two_jobs').get().status,'COMPLETE');
const report=JSON.parse(new TextDecoder().decode(objects.get('projects/13/phase-two/project-1/project-information.json')));assert.equal(report.sections.Who[0].sourceFileId,2);assert.deepEqual(report.missingInformation,[]);
assert.equal(sql.prepare('SELECT relative_path FROM project_files WHERE id=1').get().relative_path,'SSX Project Holding Folder/Phase One Project Review/Test/submission.zip');
console.log('PASS: submission gate, review blocks, idempotent queue, five questions, citations, report, originals');

sql.exec(readFileSync(new URL('../schema/0009_phase_three.sql',import.meta.url),'utf8'));
sql.exec("UPDATE phase_one_items SET category='Plans'");
await queuePhaseThree(env);assert.equal(sql.prepare('SELECT status FROM phase_three_jobs').get().status,'WAITING_STANDARD');assert.equal(sent.length,0);
sql.exec("INSERT INTO phase_three_catalogs VALUES('2026','test-only fixture','now'); INSERT INTO phase_three_divisions VALUES('2026','03','Test Concrete');");
const fixture={divisions:[{code:'03',title:'Test Concrete'}]};
assert(normalizeDivisions({divisions:[{code:'99',scope:'bad',sheet:'A1',evidence:'bad',confidence:'HIGH'}],completeReview:true},fixture).issues.length);
await queuePhaseThree(env);assert.equal(sent.length,1);await queuePhaseThree(env);assert.equal(sent.length,1);
globalThis.fetch=async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({divisions:[{code:'03',scope:'Slab',sheet:'S1',evidence:'Concrete slab note',confidence:'HIGH'}],issues:[],completeReview:true})}]}]});
try{await processPhaseThree(sent.shift(),{...env,OPENAI_API_KEY:'test'});}finally{globalThis.fetch=originalFetch;}
await queuePhaseThree(env);await queuePhaseThree(env);
assert.equal(sql.prepare('SELECT status FROM phase_three_jobs').get().status,'READY_FOR_ESTIMATE');
const outbox=sql.prepare('SELECT * FROM phase_three_estimate_outbox').all();assert.equal(outbox.length,1);assert.equal(outbox[0].division_code,'03');assert.equal(outbox[0].status,'WAITING_ESTIMATE_CONNECTION');
console.log('PASS: 2026 catalog gate, plan routing, code validation, evidence report, duplicate-safe estimate outbox; no estimate writes');

sql.exec(readFileSync(new URL('../schema/0010_phase_four.sql',import.meta.url),'utf8'));
await queuePhaseFour(env);assert.equal(sql.prepare('SELECT status FROM phase_four_jobs').get().status,'WAITING_STANDARD');assert.equal(sent.length,0);
sql.exec("INSERT INTO phase_four_catalogs VALUES('2026','test-only fixture','now'); INSERT INTO phase_four_sections VALUES('2026','03','03 30 00','Test Section');");
const sc={division:'03',sections:[{code:'03 30 00',title:'Test Section'}]};
assert.equal(normalizeSections({sections:[{code:'04 30 00',scope:'x',sheet:'A1',evidence:'x',confidence:'HIGH'}],completeReview:true},sc).sections.length,0);
await queuePhaseFour(env);assert.equal(sent.length,1);await queuePhaseFour(env);assert.equal(sent.length,1);
globalThis.fetch=async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({sections:[],issues:[],completeReview:true})}]}]});
try{await processPhaseFour(sent.shift(),{...env,OPENAI_API_KEY:'test'});}finally{globalThis.fetch=originalFetch;}
await queuePhaseFour(env);assert.equal(sql.prepare('SELECT count(*) n FROM phase_four_estimate_outbox').get().n,0,'empty section review must create NO estimate entries');
assert.equal(sql.prepare('SELECT status FROM phase_four_jobs').get().status,'NEEDS_REVIEW');
sql.exec("UPDATE phase_four_jobs SET status='RUNNING'; UPDATE phase_four_items SET status='PENDING'");
await queuePhaseFour(env);
globalThis.fetch=async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({sections:[{code:'03 30 00',scope:'Slab',sheet:'S1',evidence:'Slab note',confidence:'HIGH'}],issues:[],completeReview:true})}]}]});
try{await processPhaseFour(sent.shift(),{...env,OPENAI_API_KEY:'test'});}finally{globalThis.fetch=originalFetch;}
await queuePhaseFour(env);await queuePhaseFour(env);
const sectionRows=sql.prepare('SELECT * FROM phase_four_estimate_outbox').all();assert.equal(sectionRows.length,1);assert.equal(sectionRows[0].section_code,'03 30 00');assert.equal(sectionRows[0].division_code,'03');assert.equal(sectionRows[0].parent_outbox_id,'project-1-03');
console.log('PASS: section catalog gate, correct parent division, no empty entries, evidence-only sections, duplicate protection');

const {queuePhaseFive,processPhaseFive,normalizeScopes}=await import('../src/phase-five-review.js');
sql.exec(readFileSync(new URL('../schema/0011_phase_five.sql',import.meta.url),'utf8'));
assert(normalizeScopes({lines:[{text:'Unsupported',evidenceIndexes:[9]}],issues:[],completeReview:true},[{}]).issues.length);
assert(normalizeScopes({lines:[{text:'Two\nlines',evidenceIndexes:[0]}],issues:[],completeReview:true},[{}]).issues.length);
sql.exec("UPDATE phase_four_jobs SET status='NEEDS_REVIEW'");
await queuePhaseFive(env);assert.equal(sql.prepare('SELECT COUNT(*) n FROM phase_five_jobs').get().n,0);
sql.exec("UPDATE phase_four_jobs SET status='READY_FOR_ESTIMATE'");
await queuePhaseFive(env);assert.equal(sent.length,1);await queuePhaseFive(env);assert.equal(sent.length,1);
const task=sent.shift();
globalThis.fetch=async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({lines:[{text:'Place concrete slab.',evidenceIndexes:[0]}],issues:[],completeReview:true})}]}]});
try { await processPhaseFive(task,{...env,OPENAI_API_KEY:'test'}); await processPhaseFive(task,{...env,OPENAI_API_KEY:'test'}); } finally {globalThis.fetch=originalFetch;}
assert.equal(sql.prepare('SELECT status FROM phase_five_jobs').get().status,'READY_FOR_ESTIMATE');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM phase_five_estimate_outbox').get().n,1);
assert.equal(sql.prepare('SELECT status FROM phase_five_estimate_outbox').get().status,'WAITING_ESTIMATE_CONNECTION');
// Missing original source must block output, even with an existing section report.
sql.exec("DELETE FROM phase_five_estimate_outbox; UPDATE phase_five_jobs SET status='PENDING', attempts=4");
objects.delete('copy');await processPhaseFive(task,env);
assert.equal(sql.prepare('SELECT status FROM phase_five_jobs').get().status,'NEEDS_REVIEW');
assert.equal(sql.prepare('SELECT COUNT(*) n FROM phase_five_estimate_outbox').get().n,0);
console.log('PASS: phase-five predecessor gate, cited short scopes, duplicate delivery, estimate pending, missing original blocks output');
const {queuePhaseSix,processPhaseSix,normalizeMemory}=await import('../src/phase-six-brain.js');
sql.exec(readFileSync(new URL('../schema/0012_phase_six.sql',import.meta.url),'utf8'));
assert(normalizeMemory({summary:'x',facts:[{statement:'Uncited'}],issues:[],completeReview:true}).issues.length);
await queuePhaseSix(env);assert.equal(sql.prepare('SELECT COUNT(*) n FROM phase_six_items').get().n,0);
sql.exec("UPDATE phase_five_jobs SET status='READY_FOR_ESTIMATE'");objects.set('copy',new TextEncoder().encode('Test project'));
await queuePhaseSix(env);assert.equal(sent.length,1);await queuePhaseSix(env);assert.equal(sent.length,1);
globalThis.fetch=async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({summary:'Test project memory',facts:[{statement:'Test fact',location:'paragraph 1',evidence:'Test project'}],issues:[],conflicts:[],completeReview:true})}]}]});
try{await processPhaseSix(sent.shift(),{...env,OPENAI_API_KEY:'test'});}finally{globalThis.fetch=originalFetch;}
await queuePhaseSix(env);
assert.equal(sql.prepare('SELECT status FROM phase_six_brains').get().status,'COMPLETE');
const brain=sql.prepare('SELECT manifest_key FROM phase_six_brains').get();
const manifest=JSON.parse(new TextDecoder().decode(objects.get(brain.manifest_key)));
assert.equal(manifest.files[0].file_id,2);assert(manifest.originalsPreserved);
console.log('PASS: Phase Six all-file memory, predecessor block, citation checks, persistent manifest, idempotent scheduling');
sql.exec("CREATE TABLE companies(id INTEGER PRIMARY KEY,name TEXT); CREATE TABLE contacts(id INTEGER PRIMARY KEY,company_id INTEGER,name TEXT,email TEXT,phone TEXT,trade TEXT,source TEXT); INSERT INTO companies VALUES(1,'Test Concrete'); INSERT INTO contacts VALUES(1,1,'Test Contact','test@example.invalid',NULL,'Concrete','test fixture');");
const {PDFDocument}=await import('pdf-lib');
const {queuePhaseSeven,processPhaseSeven,normalizeReport}=await import('../src/phase-seven-reports.js');
const {queueCompletionPhases,processCompletionPhase}=await import('../src/project-phase-pipeline.js');
const {calculateQuantity}=await import('../src/project-phase-handlers.js');
const {projectPhaseRoute}=await import('../src/project-phase-api.js');
sql.exec(readFileSync(new URL('../schema/0013_phase_seven.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0014_completion_pipeline.sql',import.meta.url),'utf8'));
assert(normalizeReport({classification:'REPORT',summary:'x',completeReview:true,issues:[]}).issues.length);
const geom={viewport:[0,0,600,600],points:[[0,0],[100,0],[100,100]],notToScale:false,anchors:[{points:[[0,0],[100,0]],knownFeet:10,label:'10 feet horizontal'},{points:[[0,0],[0,100]],knownFeet:10,label:'10 feet vertical'}]};
assert.equal(calculateQuantity('LF',geom),20);
assert(Math.abs(calculateQuantity('SF',{...geom,points:[[0,0],[100,0],[100,100],[0,100]],closed:true})-100)<1e-8);
assert.throws(()=>calculateQuantity('LF',{...geom,notToScale:true}));
assert.throws(()=>calculateQuantity('LF',{...geom,anchors:[geom.anchors[0],geom.anchors[0]]}));
assert.throws(()=>calculateQuantity('LF',{...geom,anchors:[geom.anchors[0],{...geom.anchors[1],knownFeet:20}]}));
assert.throws(()=>calculateQuantity('LF',{...geom,points:[[0,0],[700,0]]}));
const pdf=await PDFDocument.create();pdf.addPage([600,600]);pdf.addPage([600,600]);const pdfBytes=await pdf.save();objects.set('copy',pdfBytes);
sql.prepare("UPDATE project_files SET file_name='plans.pdf',size_bytes=? WHERE id=2").run(pdfBytes.length);
sql.exec("INSERT INTO phase_five_estimate_outbox(id,submission_id,section_code,scope_text,evidence_json,result_key,created_at) VALUES('scope-1','project-1','03 30 00','Place concrete slab.','[{\"sourceFileId\":2,\"sheet\":\"A1\",\"evidence\":\"slab\"}]','scope-result','now')");
sql.exec("INSERT INTO plan_layer_jobs(id,source_file_id,prepared_file_id,plan_file_id,source_path,brain_keys_json,status,layered_file_id,updated_at) VALUES('test-layer',1,1,2,'plans.pdf','[]','READY_FOR_TAKEOFF',2,'now')");
const model=async(url,options)=>{
 if(String(url).includes('/v1/files'))return Response.json({id:'test-upload'});
 const body=JSON.parse(options.body),prompt=body.input[0].content;
 let result;
 if(prompt.includes('Phase Seven'))result={classification:'REPORT',classificationEvidence:{location:'page 1',evidence:'Geotechnical investigation'},reportType:'Geotechnical',summary:'Test soil report',findings:[{statement:'Test finding',location:'page 1',evidence:'test soil'}],authorRecommendations:[],masonRecommendations:[{action:'Ask engineer to confirm foundation basis',rationale:'Source finding',findingIndexes:[0]}],limitations:[],issues:[],completeReview:true};
 else if(prompt.includes('Phase Eight')){const page=body.input[1].content[0].text.includes('page 2')?2:1;result={completeReview:true,isDrawing:true,sheetId:'A'+page,summary:'Test drawing '+page,references:page===1?[{sheetId:'A2',location:'detail 1',evidence:'See A2'}]:[],brokenChains:[],limitations:[]};}
 else if(prompt.includes('Phase Nine'))result={completeReview:true,items:[{scopeId:'scope-1',description:'Test measured edge',size:'test',unit:'LF',location:'drawing',evidence:'dimensioned edge',geometry:geom}],exclusions:[]};
 else if(prompt.includes('Phase Ten'))result={completeReview:true,findings:[{description:'Clarify scope text',question:'Confirm slab scope wording',location:'drawing',evidence:'concrete slab note',scopeId:'scope-1',takeoffId:null}],limitations:[]};
 else if(prompt.includes('Phase Eleven'))result={resolvable:true,reason:'Source wording',location:'drawing',evidence:'slab note',scopeText:'Place concrete slab per structural notes.'};
 else if(prompt.includes('Independently verify'))result={supported:true,location:'drawing',evidence:'slab note',reason:'Supported wording'};
 else throw Error('Unexpected model request');
 return Response.json({output_text:JSON.stringify(result)});
};
const testEnv={...env,OPENAI_API_KEY:'test',MASON_API_TOKEN:'test-admin'};
sql.exec("UPDATE phase_six_brains SET status='RUNNING'");await queuePhaseSeven(testEnv);assert.equal(sent.length,0);
sql.exec("UPDATE phase_six_brains SET status='COMPLETE'");await queuePhaseSeven(testEnv);assert.equal(sent.length,1);
globalThis.fetch=model;
try{
 await processPhaseSeven(sent.shift(),testEnv);await queuePhaseSeven(testEnv);
 assert.equal(sql.prepare('SELECT status FROM phase_seven_jobs').get().status,'COMPLETE');
 await queueCompletionPhases(testEnv);assert.equal(sent.length,2,'one task for each actual PDF page');
 await queueCompletionPhases(testEnv);assert.equal(sent.length,2,'idempotent page queue');
 for(const task of sent.splice(0))await processCompletionPhase(task,testEnv);
 await queueCompletionPhases(testEnv);assert.equal(sent.length,2,'takeoff follows completed page inventory');
 for(const task of sent.splice(0))await processCompletionPhase(task,testEnv);
 await queueCompletionPhases(testEnv);assert.equal(sql.prepare('SELECT count(*) n FROM project_phase_runs WHERE phase=10').get().n,0,'unverified takeoff blocks next phase');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pdfBytes)),b=>b.toString(16).padStart(2,'0')).join('');
 for(const t of sql.prepare('SELECT * FROM project_takeoffs').all()){
  const path=`https://local/api/project-phases/project-1/takeoffs/${t.id}/verify`;
  const denied=await projectPhaseRoute(new Request(path,{method:'POST',body:'{}'}),testEnv);assert.equal(denied.status,401);
  const verified=await projectPhaseRoute(new Request(path,{method:'POST',headers:{authorization:'Bearer test-admin','content-type':'application/json'},body:JSON.stringify({sourceReviewed:true,reviewer:'test verifier',evidence:'Test-only original comparison',sourceSha256:sha})}),testEnv);
  assert.equal(verified.status,200,await verified.text());
 }
 await queueCompletionPhases(testEnv);assert.equal(sent.length,2,'verification automatically resumes independent review');
 for(const task of sent.splice(0))await processCompletionPhase(task,testEnv);
 await queueCompletionPhases(testEnv);
 assert.equal(sent.length,2,'one correction worker per review finding');
 for(const task of sent.splice(0))await processCompletionPhase(task,testEnv);
 await queueCompletionPhases(testEnv);
 assert.equal(sql.prepare('SELECT scope_text FROM phase_five_estimate_outbox').get().scope_text,'Place concrete slab per structural notes.');
 assert.equal(sql.prepare('SELECT status FROM project_phase_runs WHERE phase=12').get().status,'COMPLETE');
 assert.equal(sql.prepare('SELECT status FROM project_phase_runs WHERE phase=13').get().status,'DRAFTS_READY');
 assert.equal(sql.prepare('SELECT count(*) n FROM project_bid_packages').get().n,1);
 assert.equal(sql.prepare('SELECT status FROM project_bid_candidates').get().status,'UNVERIFIED','trade match is not qualification approval');
 const v=sql.prepare('SELECT * FROM project_estimate_versions').get();const final=JSON.parse(new TextDecoder().decode(objects.get(v.result_key)));assert.equal(final.sections.length,1);assert.equal(final.pricingStatus,'NOT_PRICED');assert.equal(final.deliveryStatus,'WAITING_ESTIMATE_CONNECTION');
 await queueCompletionPhases(testEnv);assert.equal(sql.prepare('SELECT count(*) n FROM project_estimate_versions').get().n,1,'immutable version is idempotent');
 const frozen=await projectPhaseRoute(new Request('https://local/api/project-phases/project-1/retry',{method:'POST',headers:{authorization:'Bearer test-admin'},body:'{"phase":9}'}),testEnv);assert.equal(frozen.status,409);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS: report analysis, physical PDF page inventory, sequential automatic handoffs 7–13, scale gates, authenticated verification, final version, unsent bid packages');
// A terminal failure is visible and can be explicitly retried without deleting successes.
sql.exec("INSERT INTO phase_project_submissions VALUES('retry-case',13,'Retry fixture','[1]','now',NULL); INSERT INTO phase_six_brains VALUES('retry-case','COMPLETE',NULL,'now'); INSERT INTO phase_seven_jobs VALUES('retry-case','RUNNING',NULL,'now'); INSERT INTO phase_seven_items(id,submission_id,file_id,attempts,updated_at) VALUES('retry-item','retry-case',9999,4,'now')");
await processPhaseSeven({id:'retry-item'},testEnv);
assert.equal(sql.prepare("SELECT status FROM phase_seven_items WHERE id='retry-item'").get().status,'NEEDS_REVIEW');
const retried=await projectPhaseRoute(new Request('https://local/api/project-phases/retry-case/retry',{method:'POST',headers:{authorization:'Bearer test-admin'},body:'{"phase":7,"reason":"source repaired"}'}),testEnv);
assert.equal(retried.status,200);assert.equal(sql.prepare("SELECT attempts FROM phase_seven_items WHERE id='retry-item'").get().attempts,0);
assert.equal(sql.prepare("SELECT status FROM phase_seven_items WHERE submission_id='project-1'").get().status,'COMPLETE');
console.log('PASS: bounded terminal retry, operator recovery, preservation of completed work');
import {intakeProgress,intakeDashboardRoute,summarize} from '../src/intake-progress.js';
sql.exec(readFileSync(new URL('../schema/0016_phase_tracking.sql',import.meta.url),'utf8'));
assert.equal(summarize([{status:'COMPLETE'}],[{status:'NEEDS_REVIEW'}],1).status,'NEEDS_REVIEW');
assert.equal(summarize([{status:'RUNNING'}],[{status:'COMPLETE'},{status:'PENDING'}],8).percent,50);
const progress=await intakeProgress(env);assert.equal(progress.projects.find(p=>p.id==='project-1').phases.length,13);
const events=sql.prepare('SELECT COUNT(*) n FROM project_phase_tracking_events').get().n;
await intakeProgress(env);assert.equal(sql.prepare('SELECT COUNT(*) n FROM project_phase_tracking_events').get().n,events);
assert.equal((await intakeDashboardRoute(new Request('https://local/api/intake-dashboard'),env)).status,401);
console.log('PASS: 13 live phase rows, honest blocked progress, persistent nonduplicate timing events, protected dashboard');
