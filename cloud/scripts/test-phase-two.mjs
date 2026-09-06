import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ZipWriter,Uint8ArrayWriter,TextReader} from '@zip.js/zip.js';
import {queuePhaseTwo,processPhaseTwo,sourceIds,normalizeFacts,phaseTwoFormat} from '../src/phase-two-review.js';
assert.match(readFileSync(new URL('../src/phase-two-review.js',import.meta.url),'utf8'),/env\.PHASE_TWO_QUEUE\?\[env\.PHASE_TWO_QUEUE\]/);
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE project_files(id INTEGER PRIMARY KEY,project_id INTEGER,r2_key TEXT UNIQUE,file_name TEXT,relative_path TEXT,file_type TEXT,size_bytes INTEGER,review_status TEXT,source_class TEXT,uploaded_at TEXT,updated_at TEXT,archived_at TEXT); CREATE TABLE project_folders(id TEXT,project_id INTEGER,folder_path TEXT UNIQUE,created_at TEXT,updated_at TEXT);`);
sql.exec(readFileSync(new URL('../schema/0007_phase_one_review.sql',import.meta.url),'utf8'));
const DB={async batch(statements){return Promise.all(statements.map(s=>s.run()));},prepare(s){return {bind(...p){return {
 async run(){return {meta:{changes:sql.prepare(s).run(...p).changes}};},
 async first(){return sql.prepare(s).get(...p);},
 async all(){return {results:sql.prepare(s).all(...p)};}
 };},async all(){return {results:sql.prepare(s).all()};}};}};
const objects=new Map(),sent=[];
const bucket={async head(k){return objects.has(k)?{size:objects.get(k).length}:null},async get(k,o){let b=objects.get(k);if(!b)return null;if(o?.range)b=b.slice(o.range.offset,o.range.offset+o.range.length);return{size:b.length,body:new Blob([b]).stream(),async text(){return new TextDecoder().decode(b)},async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}},async put(k,v){objects.set(k,typeof v==='string'?new TextEncoder().encode(v):v);},async delete(k){objects.delete(k)},async createMultipartUpload(k){const parts=[];return{async uploadPart(n,b){parts[n-1]=b.slice();return{partNumber:n,etag:String(n)}},async complete(){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}objects.set(k,out)},async abort(){objects.delete(k)}}}};
const env={DB,PROJECT_FILES:bucket,PHASE_TWO_QUEUE:{async send(b){sent.push(b)}}};
sql.exec(readFileSync(new URL('../schema/0008_phase_two.sql',import.meta.url),'utf8'));
assert.equal(sourceIds('[1,1]'),null);assert.equal(sourceIds('[]'),null);
assert.equal(normalizeFacts({findings:[{question:'Who',fact:'guess'}]}).findings.length,0);
const format=phaseTwoFormat();assert.equal(format.type,'json_schema');assert.equal(format.strict,true);assert.equal(format.schema.additionalProperties,false);assert.equal(format.schema.properties.findings.maxItems,30);
sql.exec(`INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes) VALUES(1,13,'original','submission.zip','SSX Project Holding Folder/Phase One Project Review/Test/submission.zip',12);
INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes) VALUES(2,13,'copy','project.txt','SSX Project Holding Folder/Phase One Project Review/1/Docs/project.txt',12);
INSERT INTO phase_one_jobs VALUES('p1',1,'COMPLETE','now','now',NULL);
INSERT INTO phase_one_items(id,job_id,entry_index,original_path,size_bytes,status,output_file_id,updated_at) VALUES('p1-1','p1',0,'project.txt',12,'NEEDS_REVIEW',2,'now');
INSERT INTO phase_project_submissions VALUES('project-1',13,'Test Project','[1]','now',NULL);`);
await queuePhaseTwo(env);assert.equal(sent.length,0,'unresolved review blocks phase two');
sql.exec("UPDATE phase_one_items SET status='SORTED'");await queuePhaseTwo(env);assert.equal(sent.length,1);await queuePhaseTwo(env);assert.equal(sent.length,1,'no duplicate queue');
objects.set('copy',new TextEncoder().encode('Test project'));
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_url,options)=>{const request=JSON.parse(options.body);assert.equal(request.text.format.type,'json_schema');assert.equal(request.text.format.strict,true);assert.equal(request.max_output_tokens,12000);return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({findings:['Who','What','Where','When','Why'].map(q=>({question:q,field:q,fact:'Explicit source fact '+q,quote:'source excerpt',location:'section 1'})),limitations:['Owner is not stated on this individual sheet']})}]}]});};
try{await processPhaseTwo(sent.shift(),{...env,OPENAI_API_KEY:'test'});}finally{globalThis.fetch=originalFetch;}
await queuePhaseTwo(env);assert.equal(sql.prepare('SELECT status FROM phase_two_jobs').get().status,'COMPLETE');
const report=JSON.parse(new TextDecoder().decode(objects.get('projects/13/phase-two/project-1/project-information.json')));assert.equal(report.sections.Who[0].sourceFileId,2);assert.deepEqual(report.missingInformation,[]);
assert.equal(report.reviewIssues.length,1);assert.deepEqual(report.blockingIssues,[]);assert.equal(sql.prepare('SELECT status FROM phase_two_jobs').get().status,'COMPLETE');
sql.exec("UPDATE phase_two_jobs SET status='NEEDS_REVIEW'");await queuePhaseTwo(env);assert.equal(sql.prepare('SELECT status FROM phase_two_jobs').get().status,'COMPLETE','completed evidence can be safely reevaluated after an aggregate-gate repair');
assert.equal(sql.prepare('SELECT relative_path FROM project_files WHERE id=1').get().relative_path,'SSX Project Holding Folder/Phase One Project Review/Test/submission.zip');
console.log('PASS: submission gate, review blocks, idempotent queue, five questions, citations, report, originals');
