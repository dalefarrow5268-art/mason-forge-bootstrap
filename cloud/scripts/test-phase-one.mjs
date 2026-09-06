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
sql.exec(readFileSync(new URL('../schema/0022_plan_layer_handoff.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0024_holding_scan_highres_retry.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0025_native_capture_replaces_tiles.sql',import.meta.url),'utf8'));
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
const {queueHoldingScan,processHoldingScan,validScan,scanPrompt,nativeCapturePrompt,nativeCaptureGateReady,normalizeScan,vectorRegionPrompt}=await import('../src/holding-brain-scan.js');
const scanSource=readFileSync(new URL('../src/holding-brain-scan.js',import.meta.url),'utf8');
assert.match(scanSource,/i\.asset_role!='DETAIL_TILE' AND i\.attempts<3/);
assert.match(scanSource,/LIMIT 100/);
assert.match(nativeCapturePrompt(),/coordinate-preserving textBlocks and words/);
assert(nativeCaptureGateReady([{asset_role:'NATIVE_PAGE',capture_path:'page.brain-capture/native.json'}],1));
assert(!nativeCaptureGateReady([{asset_role:'NATIVE_PAGE',capture_path:null}],1));
assert(!nativeCaptureGateReady([{asset_role:'SOURCE',capture_path:'capture.json'}],1));
sql.exec(readFileSync(new URL('../schema/0018_holding_brain_scan.sql',import.meta.url),'utf8'));
assert(!validScan({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[]}));
assert(validScan({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[],blank:true}));
assert(!validScan({coverage:'PARTIAL',category:'Plans',unreadableRegions:[],findings:[{location:'top',content:'note'}]}));
assert.match(scanPrompt(true),/Judge coverage only for the pixels visible inside this supplied tile/);
assert.match(scanPrompt(true),/do not mark coverage PARTIAL/);
assert.match(scanPrompt(true),/requires all tiles before releasing the logical page/);
assert.match(vectorRegionPrompt('plans/page.pdf.brain-scan/tile-r3-c1.jpg'),/row 3, column 1/);
assert.match(vectorRegionPrompt('plans/page.pdf.brain-scan/tile-r3-c1.jpg'),/0.0%-36.0%/);
assert.throws(()=>vectorRegionPrompt('plans/page.pdf'),/does not identify/);
const normalizedFinding=normalizeScan({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[{location:'lower-left',content:{text:'Door note',value:3}}]});
assert.equal(normalizedFinding.findings[0].content,'{"text":"Door note","value":3}');
assert(validScan(normalizedFinding));
const normalizedLocation=normalizeScan({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[{location:{sheet:'A1.1',region:'upper-left'},content:'General notes'}]});
assert.equal(normalizedLocation.findings[0].location,'{"sheet":"A1.1","region":"upper-left"}');
assert(validScan(normalizedLocation));
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

// A verified native-capture package is the deterministic first scan. It releases
// Phase One immediately while semantic sheet interpretation stays queued.
sent.length=0;
const nativeZip=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});
await nativeZip.add('plans/page-00001.pdf',new TextReader('preserved vector page'));
await nativeZip.add('plans/page-00001.pdf.brain-capture/native.json',new TextReader(JSON.stringify({captureStatus:'CAPTURED_NOT_SEMANTICALLY_REVIEWED',cacheKey:'fixture',captureSha256:'abc'})));
const nativeBytes=await nativeZip.close();objects.set('prepared350',nativeBytes);
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(350,3,'source350','original.zip','Holding/original.zip',100,'PHASE ONE INTAKE')").run();
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(351,3,'prepared350','prepared.zip','Prepared/350.zip',?,'HOLDING PREPARED PACKAGE')").run(nativeBytes.length);
sql.prepare("INSERT INTO phase_one_jobs(id,source_file_id,created_at,updated_at) VALUES('intake-350',350,'now','now')").run();
sql.prepare("INSERT INTO holding_preparations(source_file_id,status,prepared_file_id,units_done,scan_units_total,updated_at) VALUES(350,'READY',351,1,1,'now')").run();
await queueHoldingScan(env);
assert.equal(sql.prepare('SELECT status FROM holding_preparations WHERE source_file_id=350').get().status,'SCANNED');
assert(sent.some(x=>x.kind==='HOLDING_SCAN'&&x.id.startsWith('scan-350-351-')),'semantic review continues in background');
await queuePhaseOne(env);
assert.equal(sql.prepare('SELECT status FROM holding_preparations WHERE source_file_id=350').get().status,'COMPLETE');
assert(sent.some(x=>x.id==='intake-350'),'deterministic capture releases Phase One');
sql.prepare("UPDATE holding_scan_items SET status='PENDING',updated_at='now' WHERE source_file_id=350").run();
sent.length=0;await queueHoldingScan(env);
assert(sent.some(x=>x.kind==='HOLDING_SCAN'&&x.id.startsWith('scan-350-351-')),'semantic review survives Phase One release');
console.log('PASS: deterministic native capture releases phases while semantic review continues');

// Detail tiles are scanner evidence, not duplicate Phase One source files.
sent.length=0;
const tiledZip=new ZipWriter(new Uint8ArrayWriter(),{useWebWorkers:false});
await tiledZip.add('plans/page-00001.pdf',new TextReader('lossless page source'));
await tiledZip.add('plans/page-00001.pdf.brain-scan/tile-r1-c1.jpg',new TextReader('tile one'));
await tiledZip.add('plans/page-00001.pdf.brain-scan/tile-r1-c2.jpg',new TextReader('tile two'));
const tiledBytes=await tiledZip.close();objects.set('prepared400',tiledBytes);
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(400,3,'source400','original.zip','Holding/original.zip',100,'PHASE ONE INTAKE')").run();
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,size_bytes,source_class) VALUES(401,3,'prepared400','prepared.zip','Prepared/400.zip',?,'HOLDING PREPARED PACKAGE')").run(tiledBytes.length);
sql.prepare("INSERT INTO phase_one_jobs(id,source_file_id,created_at,updated_at) VALUES('intake-400',400,'now','now')").run();
sql.prepare("INSERT INTO holding_preparations(source_file_id,status,prepared_file_id,units_done,scan_units_total,updated_at) VALUES(400,'SCANNED',401,1,2,'now')").run();
sql.prepare("INSERT INTO holding_scan_items(id,source_file_id,entry_index,original_path,source_path,asset_role,size_bytes,status,brain_key,category,updated_at) VALUES('scan-400-1',400,1,'plans/page-00001.pdf.brain-scan/tile-r1-c1.jpg','plans/page-00001.pdf','DETAIL_TILE',8,'COMPLETE','brain/1','Plans','now'),('scan-400-2',400,2,'plans/page-00001.pdf.brain-scan/tile-r1-c2.jpg','plans/page-00001.pdf','DETAIL_TILE',8,'COMPLETE','brain/2','Plans','now')").run();
await queuePhaseOne(env);await processPhaseOne(sent.find(x=>x.id==='intake-400'),env);await queuePhaseOne(env);
assert.equal(sql.prepare("SELECT COUNT(*) n FROM phase_one_items WHERE job_id='intake-400'").get().n,1);
const tiledTask={table:'phase_one_items',id:sql.prepare("SELECT id FROM phase_one_items WHERE job_id='intake-400'").get().id};
await processPhaseOne(tiledTask,env);
assert.equal(sql.prepare("SELECT category FROM phase_one_items WHERE job_id='intake-400'").get().category,'Plans');
console.log('PASS: overlapping detail assets are excluded from Phase One inventory and linked to the preserved page');

// A terminal low-resolution tile gets one bounded retry against its preserved
// vector page; successful tiles are not reset and unreadable content is not waived.
sent.length=0;
sql.prepare("UPDATE holding_preparations SET status='SCANNING',scan_units_total=2,updated_at='now' WHERE source_file_id=400").run();
sql.prepare("UPDATE holding_scan_items SET status='NEEDS_REVIEW',attempts=3,error='fine text unreadable',updated_at='now' WHERE id='scan-400-1'").run();
await queueHoldingScan(env);
const vectorTask=sent.find(x=>x.id==='scan-400-1');assert(vectorTask,'terminal raster review receives a vector-region retry');
const calls=[];globalThis.fetch=async(url,options={})=>{
 calls.push({url:String(url),body:options.body});
 if(String(url).endsWith('/v1/files'))return Response.json({id:'file-vector'});
 if(String(url).includes('/v1/files/file-vector')&&options.method==='DELETE')return Response.json({deleted:true});
 return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[{kind:'note',location:'bottom-left target region',content:'Fine print read from vector source.'}],scaleVerified:false})}]}]});
};
await processHoldingScan(vectorTask,env);globalThis.fetch=originalFetch;
const retried=sql.prepare("SELECT * FROM holding_scan_items WHERE id='scan-400-1'").get();
assert.equal(retried.status,'COMPLETE');assert.equal(retried.attempts,4);
assert.equal(sql.prepare("SELECT status FROM holding_scan_items WHERE id='scan-400-2'").get().status,'COMPLETE','successful neighbor stays intact');
const responseCall=calls.find(call=>String(call.url).endsWith('/v1/responses'));assert(responseCall);
assert.match(String(responseCall.body),/VECTOR_REGION_RETRY/);assert.match(String(responseCall.body),/row 1, column 1/);
console.log('PASS: bounded vector-region retry preserves completed tiles and keeps the unreadable-content gate');

// A terminal vector-region review can use one lossless high-resolution crop.
// The override is bound to this project and does not reset completed neighbors.
objects.set('highres400',new TextEncoder().encode('lossless high-resolution region'));
sql.prepare("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,file_type,size_bytes,source_class) VALUES(4500,3,'highres400','scan-400-1.png','Brain/retry.png','image/png',31,'BRAIN SCAN HIGH RES RETRY SOURCE')").run();
sql.prepare("UPDATE holding_scan_items SET status='PENDING',attempts=4,override_file_id=4500,override_asset_role='HIGH_RES_REGION_RETRY',error=NULL,updated_at='now' WHERE id='scan-400-1'").run();
const highresCalls=[];globalThis.fetch=async(url,options={})=>{
 highresCalls.push({url:String(url),body:options.body});
 if(String(url).endsWith('/v1/files'))return Response.json({id:'file-highres'});
 if(String(url).includes('/v1/files/file-highres')&&options.method==='DELETE')return Response.json({deleted:true});
 return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({coverage:'COMPLETE',category:'Plans',unreadableRegions:[],findings:[{kind:'brand',location:'bottom edge',content:'Waldorf Astoria; LXR; Conrad; Canopy; Signia Hilton; Hilton'}],scaleVerified:false})}]}]});
};
await processHoldingScan({kind:'HOLDING_SCAN',id:'scan-400-1'},env);globalThis.fetch=originalFetch;
const highres=sql.prepare("SELECT * FROM holding_scan_items WHERE id='scan-400-1'").get();
assert.equal(highres.status,'COMPLETE');assert.equal(highres.attempts,5);assert.equal(highres.output_file_id,4500);
assert.equal(sql.prepare("SELECT status FROM holding_scan_items WHERE id='scan-400-2'").get().status,'COMPLETE');
const highresResponse=highresCalls.find(call=>String(call.url).endsWith('/v1/responses'));assert(highresResponse);
assert.match(String(highresResponse.body),/HIGH_RES_REGION_RETRY/);assert.doesNotMatch(String(highresResponse.body),/VECTOR_REGION_RETRY/);
console.log('PASS: exact high-resolution override preserves successful scans and the unreadable-content gate');
