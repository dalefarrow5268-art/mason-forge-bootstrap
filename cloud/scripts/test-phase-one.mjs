import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ZipWriter,Uint8ArrayWriter,TextReader} from '@zip.js/zip.js';
import {processPhaseOne,queuePhaseOne,safe,normalizeReview,storeStream} from '../src/phase-one-review.js';
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE project_files(id INTEGER PRIMARY KEY,project_id INTEGER,r2_key TEXT UNIQUE,file_name TEXT,relative_path TEXT,file_type TEXT,size_bytes INTEGER,review_status TEXT,source_class TEXT,uploaded_at TEXT,updated_at TEXT,archived_at TEXT); CREATE TABLE project_folders(id TEXT,project_id INTEGER,folder_path TEXT UNIQUE,created_at TEXT,updated_at TEXT);`);
sql.exec(readFileSync(new URL('../schema/0007_phase_one_review.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0008_phase_two.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0017_holding_preparation.sql',import.meta.url),'utf8')); 
sql.exec(readFileSync(new URL('../schema/0018_holding_brain_scan.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0020_holding_detail_tiles.sql',import.meta.url),'utf8'));
const DB={async batch(statements){return Promise.all(statements.map(s=>s.run()));},prepare(s){return {bind(...p){return {
 async run(){return {meta:{changes:sql.prepare(s).run(...p).changes}};},
 async first(){return sql.prepare(s).get(...p);},
 async all(){return {results:sql.prepare(s).all(...p)};}
 };},async all(){return {results:sql.prepare(s).all()};}};}};
const objects=new Map(),sent=[];
const bucket={async head(k){return objects.has(k)?{size:objects.get(k).length}:null},async get(k,o){let b=objects.get(k);if(!b)return null;if(o?.range)b=b.slice(o.range.offset,o.range.offset+o.range.length);return{size:b.length,body:new Blob([b]).stream(),async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}},async put(k,v){objects.set(k,typeof v==='string'?new TextEncoder().encode(v):v);},async delete(k){objects.delete(k)},async createMultipartUpload(k){const parts=[];return{async uploadPart(n,b){parts[n-1]=b.slice();return{partNumber:n,etag:String(n)}},async complete(){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}objects.set(k,out)},async abort(){objects.delete(k)}}}};
const env={DB,PROJECT_FILES:bucket,DEPARTMENT_QUEUE:{async send(b){sent.push(b)}}};
assert(!safe('../escape'));assert(!safe('/abs'));assert(!safe('C:/bad'));assert(safe('nested/plans.pdf'));
assert.equal(normalizeReview({category:'Plans',confidence:'LOW',reason:'uncertain'}).category,'Needs Review');
const zip=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});await zip.add('nested/model.dwg',new TextReader('exact original bytes'));const bytes=await zip.close();objects.set('original',bytes);
sql.prepare('INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes) VALUES(1,13,?,?,?,?)').run('original','submission.zip','SSX Project Holding Folder/Phase One Project Review/Test/submission.zip',bytes.length);
sql.prepare('INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes) VALUES(2,13,?,?,?,?)').run('untouched','other.zip','SSX Project Holding Folder/other.zip',10);
await queuePhaseOne(env);assert.equal(sent.length,1);await queuePhaseOne(env);assert.equal(sent.length,1,'queued jobs not duplicated');
await processPhaseOne(sent.shift(),env);await queuePhaseOne(env);assert.equal(sent.length,1);await processPhaseOne(sent.shift(),env);await queuePhaseOne(env);
const item=sql.prepare('SELECT * FROM phase_one_items').get();assert.equal(item.status,'NEEDS_REVIEW');assert.equal(new TextDecoder().decode(objects.get('projects/13/phase-one/'+item.id)),'exact original bytes');assert.deepEqual(objects.get('original'),bytes);
assert.equal(sql.prepare('SELECT status FROM phase_one_jobs').get().status,'COMPLETE');assert.equal(sql.prepare('SELECT count(*) n FROM phase_one_jobs').get().n,1,'holding untouched');
const large=new Uint8Array(9*1024**2+13).fill(91);await storeStream(env,'large',new Blob([large]).stream(),large.length);assert.deepEqual(objects.get('large'),large);
await assert.rejects(()=>storeStream(env,'bad',new Blob([large]).stream(),2));assert(!objects.has('bad'));
console.log('PASS: Phase One trigger isolation, durable queue, ZIP extraction, original preservation, uncertain review, report, multipart integrity and size checks');
const bulk=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false,level:0});for(let i=0;i<5000;i++)await bulk.add(`project/folder-${i%30}/file-${i}.bin`,new TextReader('x'));const bulkBytes=await bulk.close();objects.set('bulk',bulkBytes);
sql.prepare('INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes) VALUES(100,13,?,?,?,?)').run('bulk','bulk.zip','SSX Project Holding Folder/Phase One Project Review/Bulk/bulk.zip',bulkBytes.length);
await queuePhaseOne(env);await processPhaseOne(sent.shift(),env);
assert.equal(sql.prepare("SELECT count(*) n FROM phase_one_items WHERE job_id='intake-100'").get().n,5000);
console.log('PASS: 5,000 nested archive files inventoried in bounded database batches');


// Holding originals cannot be inventoried, including an already-delivered message.
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(200,3,'holding200','original.zip','Holding/original.zip',100,'PHASE ONE INTAKE')").run();
sql.prepare("INSERT INTO phase_one_jobs(id,source_file_id,created_at,updated_at) VALUES('intake-200',200,'now','now')").run();
await queuePhaseOne(env);assert(!sent.some(x=>x.id==='intake-200'));
await processPhaseOne({table:'phase_one_jobs',id:'intake-200'},env);
assert.equal(sql.prepare("SELECT status FROM phase_one_jobs WHERE id='intake-200'").get().status,'PENDING');
objects.set('prepared200',bytes);
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(201,3,'prepared200','prepared.zip','Prepared/200.zip',?,'HOLDING PREPARED PACKAGE')").run(bytes.length);
sql.prepare("UPDATE holding_preparations SET status='SCANNED',prepared_file_id=201,updated_at='now' WHERE source_file_id=200").run();
await queuePhaseOne(env);assert(sent.some(x=>x.id==='intake-200'));
await processPhaseOne({table:'phase_one_jobs',id:'intake-200'},env);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM phase_one_items WHERE job_id='intake-200'").get().n,1);
console.log('PASS: preparation gate, stale-message gate and verified-package inventory');
// Brain scan must precede Phase One. Use real ZIP handling and mocked model evidence.
const {queueHoldingScan,processHoldingScan,validScan}=await import('../src/holding-brain-scan.js');
sql.exec(readFileSync(new URL('../schema/0018_holding_brain_scan.sql',import.meta.url),'utf8'));
assert(!validScan({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[]}));
assert(validScan({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[],blank:true}));
assert(!validScan({coverage:'PARTIAL',category:'Plans',unreadableRegions:[],findings:[{location:'top',content:'note'}]}));
const scanZip=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});await scanZip.add('source/notes.txt',new TextReader('Project note: retain original.'));const scanBytes=await scanZip.close();objects.set('scan300',scanBytes);
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(300,3,'source300','original.zip','Holding/original.zip',100,'PHASE ONE INTAKE')").run();
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(301,3,'scan300','prepared.zip','Prepared/300.zip',?,'HOLDING PREPARED PACKAGE')").run(scanBytes.length);
sql.prepare("INSERT INTO phase_one_jobs(id,source_file_id,created_at,updated_at) VALUES('intake-300',300,'now','now')").run();
sql.prepare("INSERT INTO holding_preparations(source_file_id,status,prepared_file_id,units_done,updated_at) VALUES(300,'READY',301,1,'now')").run();
await queuePhaseOne(env);assert(!sent.some(x=>x.id==='intake-300'),'preparation alone cannot start phases');
await queueHoldingScan(env);const task=sent.find(x=>x.kind==='HOLDING_SCAN');assert(task);
const originalFetch=globalThis.fetch;env.OPENAI_API_KEY='fixture-only';
globalThis.fetch=async()=>Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({coverage:'COMPLETE',category:'Documents',unreadableRegions:[],findings:[{kind:'note',location:'line 1',content:'Project note: retain original.'}],scaleVerified:false})}]}]});
await processHoldingScan(task,env);globalThis.fetch=originalFetch;
await queueHoldingScan(env);assert.equal(sql.prepare('SELECT status FROM holding_preparations WHERE source_file_id=300').get().status,'SCANNED');
const scanned=sql.prepare('SELECT * FROM holding_scan_items WHERE source_file_id=300').get();assert.equal(scanned.status,'COMPLETE');assert(objects.has(scanned.brain_key));
await queuePhaseOne(env);assert(sent.some(x=>x.id==='intake-300'),'only saved Brain scan releases Phase One');
console.log('PASS: preparation is not review; complete saved Brain scan required before Phase One');

// Detail tiles are scanner evidence, not duplicate Phase One source files.
sent.length=0;
const tiledZip=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});
await tiledZip.add('plans/page-00001.pdf',new TextReader('lossless page source'));
await tiledZip.add('plans/page-00001.pdf.brain-scan/tile-r1-c1.pdf',new TextReader('tile one'));
await tiledZip.add('plans/page-00001.pdf.brain-scan/tile-r1-c2.pdf',new TextReader('tile two'));
const tiledBytes=await tiledZip.close();objects.set('prepared400',tiledBytes);
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(400,3,'source400','original.zip','Holding/original.zip',100,'PHASE ONE INTAKE')").run();
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(401,3,'prepared400','prepared.zip','Prepared/400.zip',?,'HOLDING PREPARED PACKAGE')").run(tiledBytes.length);
sql.prepare("INSERT INTO phase_one_jobs(id,source_file_id,created_at,updated_at) VALUES('intake-400',400,'now','now')").run();
sql.prepare("INSERT INTO holding_preparations(source_file_id,status,prepared_file_id,units_done,scan_units_total,updated_at) VALUES(400,'SCANNED',401,1,2,'now')").run();
sql.prepare("INSERT INTO holding_scan_items(id,source_file_id,entry_index,original_path,source_path,asset_role,size_bytes,status,brain_key,category,updated_at) VALUES('scan-400-1',400,1,'plans/page-00001.pdf.brain-scan/tile-r1-c1.pdf','plans/page-00001.pdf','DETAIL_TILE',8,'COMPLETE','brain/1','Plans','now'),('scan-400-2',400,2,'plans/page-00001.pdf.brain-scan/tile-r1-c2.pdf','plans/page-00001.pdf','DETAIL_TILE',8,'COMPLETE','brain/2','Plans','now')").run();
await queuePhaseOne(env);await processPhaseOne(sent.find(x=>x.id==='intake-400'),env);await queuePhaseOne(env);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM phase_one_items WHERE job_id='intake-400'").get().n,1);
const tiledTask={table:'phase_one_items',id:sql.prepare("SELECT id FROM phase_one_items WHERE job_id='intake-400'").get().id};
await processPhaseOne(tiledTask,env);
assert.equal(sql.prepare("SELECT category FROM phase_one_items WHERE job_id='intake-400'").get().category,'Plans');
console.log('PASS: overlapping detail assets are excluded from Phase One inventory and linked to the preserved page');
