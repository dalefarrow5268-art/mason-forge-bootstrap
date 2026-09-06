import {queuePhaseThree,processPhaseThree,normalizeDivisions,phaseThreeFormat,validateDivisionCatalogDocument,importDivisionCatalog,validateFulfillmentDivisionRows,syncDivisionCatalogFromFulfillment} from '../src/phase-three-review.js';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {ZipWriter,Uint8ArrayWriter,TextReader} from '@zip.js/zip.js';
import {queuePhaseTwo,processPhaseTwo,sourceIds,normalizeFacts} from '../src/phase-two-review.js';
const sql=new DatabaseSync(':memory:');
sql.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY); INSERT INTO projects(id) VALUES(13); CREATE TABLE project_files(id INTEGER PRIMARY KEY,project_id INTEGER,r2_key TEXT UNIQUE,file_name TEXT,relative_path TEXT,file_type TEXT,size_bytes INTEGER,review_status TEXT,source_class TEXT,uploaded_at TEXT,updated_at TEXT,archived_at TEXT); CREATE TABLE project_folders(id TEXT,project_id INTEGER,folder_path TEXT UNIQUE,created_at TEXT,updated_at TEXT);`);
sql.exec(readFileSync(new URL('../schema/0007_phase_one_review.sql',import.meta.url),'utf8'));
const DB={async batch(statements){return Promise.all(statements.map(s=>s.run()));},prepare(s){return {bind(...p){return {
 async run(){return {meta:{changes:sql.prepare(s).run(...p).changes}};},
 async first(){return sql.prepare(s).get(...p);},
 async all(){return {results:sql.prepare(s).all(...p)};}
 };},async first(){return sql.prepare(s).get();},async all(){return {results:sql.prepare(s).all()};}};}};
const objects=new Map(),sent=[];
const bucket={async head(k){return objects.has(k)?{size:objects.get(k).length}:null},async get(k,o){let b=objects.get(k);if(!b)return null;if(o?.range)b=b.slice(o.range.offset,o.range.offset+o.range.length);return{size:b.length,body:new Blob([b]).stream(),async text(){return new TextDecoder().decode(b)},async arrayBuffer(){return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}},async put(k,v){objects.set(k,typeof v==='string'?new TextEncoder().encode(v):v);},async delete(k){objects.delete(k)},async createMultipartUpload(k){const parts=[];return{async uploadPart(n,b){parts[n-1]=b.slice();return{partNumber:n,etag:String(n)}},async complete(){const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}objects.set(k,out)},async abort(){objects.delete(k)}}}};
const env={DB,PROJECT_FILES:bucket,PHASE_TWO_QUEUE:{async send(b){sent.push(b)}},PHASE_THREE_QUEUE:{async send(b){sent.push(b)}}};
sql.exec(readFileSync(new URL('../schema/0008_phase_two.sql',import.meta.url),'utf8'));
sql.exec(readFileSync(new URL('../schema/0004_fulfillment_inventory.sql',import.meta.url),'utf8'));
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
const livingDivisions=Array.from({length:50},(_,i)=>{const code=String(i).padStart(2,'0');return {inventory_number:`SFC-DIV-${String(i+15).padStart(6,'0')}`,csi_code:code,item_name:`${code} Registered Division ${code}`,folder_path:`SSX Fulfillment Center/01 CSI Divisions/${code} Registered Division ${code}`};});
assert.equal(validateFulfillmentDivisionRows(livingDivisions).length,50);
assert.throws(()=>validateFulfillmentDivisionRows(livingDivisions.slice(1)),/exactly 50/);
for(const [i,row] of livingDivisions.entries())sql.prepare("INSERT INTO fulfillment_inventory(inventory_number,project_id,item_type,item_name,csi_code,folder_path,status,created_at,updated_at) VALUES(?,13,'DIV',?,?,?,'ACTIVE','now','now')").run(row.inventory_number,row.item_name,row.csi_code,row.folder_path);
const synced=await syncDivisionCatalogFromFulfillment(env);assert.equal(synced.divisions.length,50);assert.match(synced.source,/Living Schedule permanent inventory/);
assert.throws(()=>validateDivisionCatalogDocument({edition:'2026',licensedAccessConfirmed:true,completeCatalog:true,expectedDivisionCount:2,sourceReference:'https://www.csiresources.org/standards/masterformat2026',divisions:[{code:'03',title:'Concrete'}]}),/count/);
assert.throws(()=>validateDivisionCatalogDocument({edition:'2026',licensedAccessConfirmed:true,completeCatalog:true,expectedDivisionCount:2,sourceReference:'https://www.csiresources.org/standards/masterformat2026',divisions:[{code:'03',title:'Concrete'},{code:'03',title:'Concrete'}]}),/Duplicate/);
sql.exec("UPDATE phase_one_items SET category='Plans'");
await queuePhaseThree(env);assert.equal(sql.prepare('SELECT status FROM phase_three_jobs').get().status,'RUNNING');assert.equal(sent.length,1);
sql.exec("DELETE FROM phase_three_items; UPDATE phase_three_jobs SET status='WAITING_STANDARD',catalog_json=NULL; DELETE FROM phase_three_catalogs; DELETE FROM phase_three_divisions;");sent.length=0;
const catalogDocument={edition:'2026',licensedAccessConfirmed:true,completeCatalog:true,expectedDivisionCount:1,sourceReference:'https://www.csiresources.org/standards/masterformat2026',divisions:[{code:'03',title:'Test Concrete'}]};
const catalogBytes=new TextEncoder().encode(JSON.stringify(catalogDocument));objects.set('catalog',catalogBytes);sql.exec("INSERT INTO project_files(id,project_id,r2_key,file_name,relative_path,file_type,size_bytes,uploaded_at,updated_at) VALUES(999,13,'catalog','catalog.json','catalog.json','application/json',"+catalogBytes.length+",'now','now')");
const catalogHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',catalogBytes)),b=>b.toString(16).padStart(2,'0')).join('');
const imported=await importDivisionCatalog(env,'project-1',999,catalogHash);assert.equal(imported.status,'VERIFIED_CATALOG_LOADED');assert.equal(imported.divisionCount,1);
const fixture={divisions:[{code:'03',title:'Test Concrete'}]};
const format=phaseThreeFormat(fixture);assert.equal(format.type,'json_schema');assert.equal(format.strict,true);assert.deepEqual(format.schema.properties.divisions.items.properties.code.enum,['03']);
assert(normalizeDivisions({divisions:[{code:'99',scope:'bad',sheet:'A1',evidence:'bad',confidence:'HIGH'}],completeReview:true},fixture).issues.length);
assert.deepEqual(normalizeDivisions({divisions:[{code:'03',scope:'possible',sheet:'A1',evidence:'uncertain',confidence:'LOW'}],issues:[],completeReview:true,coverageNote:'Current sheet fully reviewed'},fixture),{divisions:[],issues:[],coverageNote:'Current sheet fully reviewed'});
assert.equal(normalizeDivisions({divisions:[],issues:[],completeReview:true,coverageNote:'No supported work on current sheet'},fixture).issues.length,0);
assert.match(normalizeDivisions({divisions:[],issues:[],completeReview:false},fixture).issues[0],/Current sheet/);
await queuePhaseThree(env);assert.equal(sent.length,1);await queuePhaseThree(env);assert.equal(sent.length,1);
globalThis.fetch=async(_url,options)=>{const request=JSON.parse(options.body);assert.equal(request.text.format.type,'json_schema');assert.equal(request.text.format.strict,true);return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({divisions:[{code:'03',scope:'Slab',sheet:'S1',evidence:'Concrete slab note',confidence:'HIGH'}],issues:[],completeReview:true,coverageNote:'Complete fixture review'})}]}]});};
try{await processPhaseThree(sent.shift(),{...env,OPENAI_API_KEY:'test'});}finally{globalThis.fetch=originalFetch;}
await queuePhaseThree(env);await queuePhaseThree(env);
assert.equal(sql.prepare('SELECT status FROM phase_three_jobs').get().status,'READY_FOR_ESTIMATE');
const outbox=sql.prepare('SELECT * FROM phase_three_estimate_outbox').all();assert.equal(outbox.length,1);assert.equal(outbox[0].division_code,'03');assert.equal(outbox[0].status,'WAITING_ESTIMATE_CONNECTION');
console.log('PASS: 2026 catalog gate, plan routing, code validation, evidence report, duplicate-safe estimate outbox; no estimate writes');
