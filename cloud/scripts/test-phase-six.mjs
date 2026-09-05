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
