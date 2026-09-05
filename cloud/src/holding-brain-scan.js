import {queuePlanLayers,queueSheetRouting} from './plan-layer-handoff.js';
import {ZipReader} from '@zip.js/zip.js';
import {R2Reader,unpack,register,safe} from './phase-one-review.js';
import {askSource} from './project-phase-common.js';
const now=()=>new Date().toISOString();
const stale=()=>new Date(Date.now()-20*60000).toISOString();
const categories=['Plans','Documents','Photos','Geotech'];
const structuredText=value=>{if(typeof value==='string')return value;if(value&&typeof value==='object'){try{return JSON.stringify(value);}catch{return value;}}return value;};
export function normalizeScan(r){if(!r||!Array.isArray(r.findings))return r;return {...r,findings:r.findings.map(f=>f&&typeof f==='object'?{...f,content:structuredText(f.content)}:f)};}
export function validScan(r){return r&&r.coverage==='COMPLETE'&&Array.isArray(r.unreadableRegions)&&r.unreadableRegions.length===0&&categories.includes(r.category)&&Array.isArray(r.findings)&&(r.blank===true||r.findings.length>0)&&r.findings.every(f=>typeof f.content==='string'&&f.content.trim()&&typeof f.location==='string'&&f.location.trim());}
export function scanPrompt(detail=false){return `${detail?'Review the ENTIRE supplied overlapping detail tile from one construction sheet':'Review the ENTIRE supplied page or file'} before project phases begin. This is a detailed source record, not a summary. ${detail?'Judge coverage only for the pixels visible inside this supplied tile. The tile edges and the absence of the rest of the sheet are expected: do not mark coverage PARTIAL, and do not create an unreadable region, merely because this asset is a tile or because content continues beyond a tile edge. Adjacent overlapping tiles are reviewed separately and the system requires all tiles before releasing the logical page. Mark PARTIAL only when visible content inside this tile is actually illegible, obscured, uninspected, or cannot fit in the response.':'Judge coverage for the complete supplied page or file.'} Read all visible titles, sheet IDs, notes, dimensions and units, legends, schedules and tables (including every readable row), symbols, details, keynotes, callouts, revisions, cross references and drawing scale labels. Describe photos. Record every observed item with its location and exact text where legible. Do not infer obscured text, dimensions or measurements. A printed scale is not verified. Return JSON {category:Plans|Documents|Photos|Geotech,coverage:COMPLETE|PARTIAL,blank:boolean,unreadableRegions:[{location,reason}],findings:[{kind,location,content}],sheetId:string,scaleVerified:false}. Set blank true only after inspecting the entire supplied ${detail?'tile':'region'} and confirming it contains no project content. If visible content is unreadable, review cannot fit within the response, or any part inside the supplied ${detail?'tile':'region'} was not inspected, return PARTIAL and identify each real gap. Do not claim complete coverage from a summary.`;}
export function vectorRegionPrompt(path){
 const match=/\.brain-scan\/tile-r([1-3])-c([1-3])\.(?:jpe?g|png|webp)$/i.exec(path||'');
 if(!match)throw new Error('Detail tile path does not identify a 3-by-3 review region');
 const row=Number(match[1]),column=Number(match[2]),overlap=.08/3;
 const left=Math.max(0,(column-1)/3-overlap),right=Math.min(1,column/3+overlap);
 const top=Math.max(0,(row-1)/3-overlap),bottom=Math.min(1,row/3+overlap);
 const percent=value=>(value*100).toFixed(1)+'%';
 return `Review only the target region of this complete, lossless/vector construction-sheet PDF: row ${row}, column ${column} of a 3-by-3 grid, including the same 8%-of-cell overlap used by the detail scanner. The target spans approximately ${percent(left)}-${percent(right)} of sheet width from the left and ${percent(top)}-${percent(bottom)} of sheet height from the top. The full page is supplied only so fine text in that region can be read from the highest-fidelity source after the raster tile proved insufficient. Ignore content outside the target region; adjacent regions are reviewed separately. Judge coverage only inside the target region, and do not mark outside content or the region boundary unreadable. Read every legible title, note, dimension and unit, legend or table row, symbol, detail, keynote, callout, revision, cross-reference and scale label inside the target. Do not infer obscured text or measurements. Return JSON {category:Plans|Documents|Photos|Geotech,coverage:COMPLETE|PARTIAL,blank:boolean,unreadableRegions:[{location,reason}],findings:[{kind,location,content}],sheetId:string,scaleVerified:false}. Set blank true only if the entire target region has no project content. Mark PARTIAL and identify the real gap if any content inside the target remains illegible or uninspected. Do not claim complete coverage from a summary.`;
}
async function preparedEntry(env,source,path){
 if(!safe(path))throw new Error('Prepared source path is unsafe');
 const reader=new ZipReader(new R2Reader(env.PROJECT_FILES,source.r2_key,source.size_bytes));let index=0;
 try{for await(const entry of reader.getEntriesGenerator()){
  const entryIndex=index++;if(entry.directory)continue;
  if(entry.filename===path){if(entry.encrypted||entry.symlink||entry.uncompressedSize>20*1024**2)throw new Error('Vector retry source is invalid');return {entry_index:entryIndex,original_path:path,size_bytes:entry.uncompressedSize};}
 }}finally{await reader.close();}
 throw new Error('Vector retry source page is missing from prepared package');
}
export async function queueHoldingScan(env){
 await queuePlanLayers(env);
 await queueSheetRouting(env);
 const waiting=(await env.DB.prepare("SELECT p.*,f.r2_key,f.size_bytes FROM holding_preparations p JOIN project_files f ON f.id=p.prepared_file_id WHERE p.status='READY' LIMIT 3").all()).results||[];
 for(const p of waiting){
  const reader=new ZipReader(new R2Reader(env.PROJECT_FILES,p.r2_key,p.size_bytes));let index=0,count=0;const entries=[];
  try{for await(const e of reader.getEntriesGenerator()){
   const i=index++;if(e.directory)continue;if(!safe(e.filename)||e.encrypted||e.symlink||e.uncompressedSize>20*1024**2)throw Error('Prepared scan entry is invalid');entries.push({e,i});
  }}finally{await reader.close();}
  const tiled=new Set(entries.filter(({e})=>e.filename.includes('.brain-scan/')).map(({e})=>e.filename.slice(0,e.filename.indexOf('.brain-scan/'))));
  for(const {e,i} of entries){
   const marker=e.filename.indexOf('.brain-scan/');
   if(marker<0&&tiled.has(e.filename))continue;
   const sourcePath=marker>=0?e.filename.slice(0,marker):e.filename;
   await env.DB.prepare('INSERT OR IGNORE INTO holding_scan_items(id,source_file_id,entry_index,original_path,source_path,asset_role,size_bytes,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(`scan-${p.source_file_id}-${p.prepared_file_id}-${i}`,p.source_file_id,i,e.filename,sourcePath,marker>=0?'DETAIL_TILE':'SOURCE',e.uncompressedSize,now()).run();count++;
  }
  const expected=Number(p.scan_units_total||p.units_done);
  if(count!==expected)throw Error(`Scanner inventory differs from preparation manifest: ${count} != ${expected}`);
  await env.DB.prepare("UPDATE holding_preparations SET status='SCANNING',updated_at=? WHERE source_file_id=? AND status='READY'").bind(now(),p.source_file_id).run();
 }
 const tasks=(await env.DB.prepare("SELECT i.id FROM holding_scan_items i JOIN holding_preparations p ON p.source_file_id=i.source_file_id WHERE p.status='SCANNING' AND (i.status='PENDING' OR (i.asset_role='DETAIL_TILE' AND i.status='NEEDS_REVIEW' AND i.attempts<4) OR (i.status IN ('QUEUED','RUNNING') AND i.updated_at<?)) ORDER BY CASE WHEN i.status='NEEDS_REVIEW' THEN 0 ELSE 1 END,i.entry_index LIMIT 10").bind(stale()).all()).results||[];
 for(const row of tasks){const c=await env.DB.prepare("UPDATE holding_scan_items SET status='QUEUED',updated_at=? WHERE id=? AND (status='PENDING' OR (asset_role='DETAIL_TILE' AND status='NEEDS_REVIEW' AND attempts<4) OR (status IN ('QUEUED','RUNNING') AND updated_at<?))").bind(now(),row.id,stale()).run();if(!c.meta.changes)continue;try{await env.DEPARTMENT_QUEUE.send({kind:'HOLDING_SCAN',id:row.id});}catch(e){await env.DB.prepare("UPDATE holding_scan_items SET status='PENDING' WHERE id=? AND status='QUEUED'").bind(row.id).run();throw e;}}
 const scans=(await env.DB.prepare("SELECT * FROM holding_preparations p WHERE status='SCANNING' AND NOT EXISTS(SELECT 1 FROM holding_scan_items i WHERE i.source_file_id=p.source_file_id AND i.status IN ('PENDING','QUEUED','RUNNING'))").all()).results||[];
 for(const p of scans){const items=(await env.DB.prepare('SELECT * FROM holding_scan_items WHERE source_file_id=? ORDER BY entry_index').bind(p.source_file_id).all()).results||[];const complete=items.length===Number(p.scan_units_total||p.units_done)&&items.every(x=>x.status==='COMPLETE');await env.DB.prepare('UPDATE holding_preparations SET status=?,error=?,updated_at=? WHERE source_file_id=?').bind(complete?'SCANNED':'NEEDS_REVIEW',complete?null:'Brain scanner found unreadable or incomplete coverage; review scanner records',now(),p.source_file_id).run();}
}
export async function processHoldingScan(body,env){
 const i=await env.DB.prepare('SELECT * FROM holding_scan_items WHERE id=?').bind(body.id).first();if(!i||!['PENDING','QUEUED','RUNNING'].includes(i.status))return;
 const attemptStart=Date.now();
 const c=await env.DB.prepare("UPDATE holding_scan_items SET status='RUNNING',attempts=attempts+1,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND (status IN ('PENDING','QUEUED') OR (status='RUNNING' AND updated_at<?))").bind(now(),now(),i.id,stale()).run();if(!c.meta.changes)return;
 try{
  const source=await env.DB.prepare('SELECT f.* FROM holding_preparations p JOIN project_files f ON f.id=p.prepared_file_id WHERE p.source_file_id=? AND f.archived_at IS NULL').bind(i.source_file_id).first();if(!source)throw Error('Prepared source unavailable');
  const root=`projects/${source.project_id}/Mason Project Brain/Intake/${i.source_file_id}`;
  const detail=i.asset_role==='DETAIL_TILE';let reviewFileId,reviewAssetRole=i.asset_role||'SOURCE',prompt=scanPrompt(detail);
  if(i.override_file_id){
   const override=await env.DB.prepare('SELECT * FROM project_files WHERE id=? AND project_id=? AND archived_at IS NULL').bind(i.override_file_id,source.project_id).first();
   if(!override||override.source_class!=='BRAIN SCAN HIGH RES RETRY SOURCE')throw new Error('High-resolution retry source unavailable or invalid');
   reviewFileId=override.id;reviewAssetRole=i.override_asset_role||'HIGH_RES_REGION_RETRY';prompt=scanPrompt(true);
  }else{
   const key=`${root}/sources/${i.id}`;
   await unpack(env,source,i,key);
   const path=`Mason Project Brain/Intake/${i.source_file_id}/Sources/${i.original_path}`;
   reviewFileId=await register(env,source,key,path,i.size_bytes,'BRAIN SCAN');
   await env.DB.prepare("UPDATE project_files SET source_class='BRAIN SCAN SOURCE' WHERE id=?").bind(reviewFileId).run();
  }
  // After three conservative raster reviews, retry only the same bounded region
  // against the preserved vector page. Completed tiles and the original upload
  // remain untouched, and genuinely illegible vector content still fails validScan.
  if(!i.override_file_id&&detail&&i.attempts>=3){
   const page=await preparedEntry(env,source,i.source_path);
   const vectorKey=`${root}/vector-retry-sources/${i.id}`;
   await unpack(env,source,page,vectorKey);
   const vectorPath=`Mason Project Brain/Intake/${i.source_file_id}/Vector Retry Sources/${i.id}/${i.source_path.split('/').pop()}`;
   reviewFileId=await register(env,source,vectorKey,vectorPath,page.size_bytes,'BRAIN SCAN VECTOR RETRY');
   await env.DB.prepare("UPDATE project_files SET source_class='BRAIN SCAN VECTOR RETRY SOURCE' WHERE id=?").bind(reviewFileId).run();
   reviewAssetRole='VECTOR_REGION_RETRY';prompt=vectorRegionPrompt(i.original_path);
  }
  const r=normalizeScan(await askSource(env,reviewFileId,null,prompt,{sourcePath:i.source_path||i.original_path,scanAssetPath:i.original_path,assetRole:reviewAssetRole,originalHoldingFileId:i.source_file_id}));
  const brainKey=`${root}/reviews/${i.id}.json`;
  await env.PROJECT_FILES.put(brainKey,JSON.stringify({reviewedAt:now(),sourceFileId:reviewFileId,originalHoldingFileId:i.source_file_id,sourcePath:i.source_path||i.original_path,scanAssetPath:i.original_path,assetRole:reviewAssetRole,preparedPackageFileId:source.id,scaleVerified:false,review:r,verification:'MODEL_REVIEW_NOT_INDEPENDENT_VERIFICATION'}));
  const complete=validScan(r);
  await env.DB.prepare('UPDATE holding_scan_items SET status=?,output_file_id=?,brain_key=?,category=?,error=?,updated_at=?,finished_at=?,processing_ms=processing_ms+? WHERE id=?').bind(complete?'COMPLETE':'NEEDS_REVIEW',reviewFileId,brainKey,categories.includes(r.category)?r.category:null,complete?null:'Incomplete or unreadable source coverage; see Brain record',now(),now(),Date.now()-attemptStart,i.id).run();
 }catch(e){const terminal=i.attempts+1>=5;await env.DB.prepare('UPDATE holding_scan_items SET status=?,error=?,updated_at=?,processing_ms=processing_ms+? WHERE id=?').bind(terminal?'NEEDS_REVIEW':'PENDING',String(e.message||e).slice(0,500),now(),Date.now()-attemptStart,i.id).run();if(!terminal)throw e;}
}

// Release a completed logical page without releasing its incomplete upload batch.
export const completedPlanPagesSql=`SELECT p.source_file_id,p.prepared_file_id,
 COALESCE(i.source_path,i.original_path) source_path,
 json_group_array(i.brain_key) brain_keys_json
 FROM holding_preparations p JOIN holding_scan_items i ON i.source_file_id=p.source_file_id
 WHERE p.status IN ('SCANNING','SCANNED','COMPLETE')
 AND NOT EXISTS(SELECT 1 FROM plan_layer_jobs l WHERE l.source_file_id=p.source_file_id
 AND l.prepared_file_id=p.prepared_file_id AND l.source_path=COALESCE(i.source_path,i.original_path))
 GROUP BY p.source_file_id,p.prepared_file_id,COALESCE(i.source_path,i.original_path)
 HAVING SUM(CASE WHEN i.status='COMPLETE' AND i.brain_key IS NOT NULL THEN 0 ELSE 1 END)=0
 AND SUM(CASE WHEN i.category='Plans' THEN 1 ELSE 0 END)>0
 AND ((COUNT(*)=9 AND MIN(i.asset_role)='DETAIL_TILE' AND MAX(i.asset_role)='DETAIL_TILE')
 OR (COUNT(*)=1 AND MIN(i.asset_role)='SOURCE'))
 ORDER BY p.source_file_id,MIN(i.entry_index) LIMIT 2`;
export async function releaseCompletedPlanPages(env){
 const pages=(await env.DB.prepare(completedPlanPagesSql).all()).results||[];
 for(const page of pages){
  const source=await env.DB.prepare('SELECT * FROM project_files WHERE id=? AND archived_at IS NULL').bind(page.prepared_file_id).first();if(!source)continue;
  const entry=await preparedEntry(env,source,page.source_path);
  const job=await env.DB.prepare('SELECT id FROM phase_one_jobs WHERE source_file_id=?').bind(page.source_file_id).first();if(!job)continue;
  // Match the identity used by later Phase One inventory, preserving downstream file links.
  const itemId=`${job.id}-prepared-${source.id}-${entry.entry_index}`;
  const key=`projects/${source.project_id}/phase-one/${itemId}`;
  const existing=await env.PROJECT_FILES.head(key);
  if(!existing)await unpack(env,source,entry,key);
  else if(existing.size!==entry.size_bytes)throw new Error('Completed page source size mismatch');
  const path=`Mason Project Brain/Intake/${page.source_file_id}/Completed Pages/${page.source_path}`;
  const fileId=await register(env,source,key,path,entry.size_bytes,'COMPLETE PAGE SCAN');
  await env.DB.prepare(`INSERT OR IGNORE INTO plan_layer_jobs(id,source_file_id,prepared_file_id,plan_file_id,source_path,brain_keys_json,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(`plan-layers-${fileId}`,page.source_file_id,page.prepared_file_id,fileId,page.source_path,page.brain_keys_json,now()).run();
 }
}

// A bounded pilot: one native PDF review may cover all nine regions. A failed
// full-page coverage check returns untouched tile work to its existing fallback.
export async function trialNativePageScan(env){
 if(env.NATIVE_PAGE_TRIALS_ENABLED!=='true')return;
 const expired=(await env.DB.prepare("SELECT * FROM native_page_scan_trials WHERE status='RUNNING' AND updated_at<?").bind(stale()).all()).results||[];
 for(const t of expired)await env.DB.batch([
  env.DB.prepare("UPDATE holding_scan_items SET status='PENDING',updated_at=? WHERE source_file_id=? AND COALESCE(source_path,original_path)=? AND status='RUNNING' AND attempts=0").bind(now(),t.source_file_id,t.source_path),
  env.DB.prepare("UPDATE native_page_scan_trials SET status='TILE_FALLBACK',error='Native page trial lease expired; tile work resumed',updated_at=? WHERE id=? AND status='RUNNING'").bind(now(),t.id)
 ]);
 const count=await env.DB.prepare('SELECT COUNT(*) n FROM native_page_scan_trials').first();if(count.n>=3)return;
 const page=await env.DB.prepare(`SELECT p.source_file_id,p.prepared_file_id,COALESCE(i.source_path,i.original_path) source_path
 FROM holding_preparations p JOIN holding_scan_items i ON i.source_file_id=p.source_file_id
 WHERE p.status='SCANNING' AND NOT EXISTS(SELECT 1 FROM native_page_scan_trials t WHERE t.source_file_id=p.source_file_id AND t.source_path=COALESCE(i.source_path,i.original_path))
 GROUP BY p.source_file_id,p.prepared_file_id,COALESCE(i.source_path,i.original_path)
 HAVING COUNT(*)=9 AND SUM(CASE WHEN i.attempts=0 AND i.status IN ('PENDING','QUEUED') AND i.asset_role='DETAIL_TILE' THEN 1 ELSE 0 END)=9
 ORDER BY MIN(i.entry_index) LIMIT 1`).first();if(!page)return;
 const id=`native-${page.source_file_id}-${crypto.randomUUID()}`,at=now(),start=Date.now();
 // The claim and all nine locks share a D1 transaction, so queued messages cannot
 // begin a competing tile review between the eligibility check and the locks.
 const claimed=await env.DB.batch([
  env.DB.prepare(`INSERT INTO native_page_scan_trials(id,source_file_id,source_path,status,previous_items_json,updated_at)
  SELECT ?,?,?,'RUNNING',json_group_array(json_object('id',id,'status',status,'attempts',attempts)),?
  FROM holding_scan_items WHERE source_file_id=? AND COALESCE(source_path,original_path)=?
  HAVING COUNT(*)=9 AND SUM(CASE WHEN attempts=0 AND status IN ('PENDING','QUEUED') AND asset_role='DETAIL_TILE' THEN 1 ELSE 0 END)=9
  AND (SELECT COUNT(*) FROM native_page_scan_trials)<3
  ON CONFLICT(source_file_id,source_path) DO NOTHING`).bind(id,page.source_file_id,page.source_path,at,page.source_file_id,page.source_path),
  env.DB.prepare(`UPDATE holding_scan_items SET status='RUNNING',updated_at=? WHERE source_file_id=? AND COALESCE(source_path,original_path)=? AND EXISTS(SELECT 1 FROM native_page_scan_trials WHERE id=?)`).bind(at,page.source_file_id,page.source_path,id)
 ]);if(!claimed[0].meta.changes)return;
 try{
  const source=await env.DB.prepare('SELECT * FROM project_files WHERE id=? AND archived_at IS NULL').bind(page.prepared_file_id).first();if(!source)throw new Error('Prepared source missing');
  const entry=await preparedEntry(env,source,page.source_path),key=`projects/${source.project_id}/Mason Project Brain/Intake/${page.source_file_id}/native-sources/${id}`;
  await unpack(env,source,entry,key);
  const fileId=await register(env,source,key,`Mason Project Brain/Intake/${page.source_file_id}/Native Page Trials/${id}.pdf`,entry.size_bytes,'FULL PAGE SCAN TRIAL');
  const r=normalizeScan(await askSource(env,fileId,null,scanPrompt(false),{sourcePath:page.source_path,assetRole:'FULL_NATIVE_PAGE',originalHoldingFileId:page.source_file_id}));
  const brainKey=key+'.review.json';await env.PROJECT_FILES.put(brainKey,JSON.stringify({reviewedAt:now(),sourceFileId:fileId,originalHoldingFileId:page.source_file_id,sourcePath:page.source_path,scanAssetPath:page.source_path,assetRole:'FULL_NATIVE_PAGE',preparedPackageFileId:source.id,scaleVerified:false,review:r,verification:'MODEL_REVIEW_NOT_INDEPENDENT_VERIFICATION'}));
  await env.DB.prepare('UPDATE native_page_scan_trials SET brain_key=? WHERE id=?').bind(brainKey,id).run();
  if(!validScan(r))throw new Error('Whole-page coverage incomplete; retaining detail-tile fallback');
  const elapsed=Date.now()-start;
  await env.DB.batch([
   env.DB.prepare("UPDATE holding_scan_items SET status='COMPLETE',brain_key=?,output_file_id=?,category=?,error=NULL,finished_at=?,updated_at=? WHERE source_file_id=? AND COALESCE(source_path,original_path)=? AND status='RUNNING' AND attempts=0").bind(brainKey,fileId,r.category,now(),now(),page.source_file_id,page.source_path),
   env.DB.prepare("UPDATE native_page_scan_trials SET status='COMPLETE',processing_ms=?,updated_at=? WHERE id=?").bind(elapsed,now(),id)
  ]);
 }catch(e){await env.DB.batch([
  env.DB.prepare("UPDATE holding_scan_items SET status='PENDING',updated_at=? WHERE source_file_id=? AND COALESCE(source_path,original_path)=? AND status='RUNNING' AND attempts=0").bind(now(),page.source_file_id,page.source_path),
  env.DB.prepare("UPDATE native_page_scan_trials SET status='TILE_FALLBACK',error=?,processing_ms=?,updated_at=? WHERE id=?").bind(String(e.message||e).slice(0,400),Date.now()-start,now(),id)
 ]);}
}

// One explicit A2.1 benchmark. This records timing and evidence without marking
// any production tiles or takeoff quantities complete.
export async function benchmarkA21NativePage(env){
 const id='benchmark-a21-inline-v2', sourceId=2937, path='original-page.pdf';
 const claim=await env.DB.prepare("INSERT OR IGNORE INTO native_page_scan_trials(id,source_file_id,source_path,status,previous_items_json,updated_at) VALUES(?,?,?,'RUNNING','[]',?)").bind(id,sourceId,path+'#inline-v2',now()).run();
 if(!claim.meta.changes)return;
 const start=Date.now();
 try{
  const source=await env.DB.prepare('SELECT * FROM project_files WHERE id=? AND project_id=3 AND archived_at IS NULL').bind(sourceId).first();
  if(!source)throw new Error('A2.1 benchmark package unavailable');
  const entry=await preparedEntry(env,source,path);
  const key=`projects/3/Mason Project Brain/Scanner Benchmarks/${id}/source.pdf`;
  await unpack(env,source,entry,key);
  const fileId=await register(env,source,key,'Mason Project Brain/Scanner Benchmarks/A2.1/native-source.pdf',entry.size_bytes,'SCANNER BENCHMARK');
  const r=normalizeScan(await askSource({...env,INLINE_PDF_INPUT_ENABLED:'true'},fileId,null,scanPrompt(false),{sheetId:'A2.1',assetRole:'FULL_NATIVE_PAGE_BENCHMARK',scaleVerified:false}));
  const elapsed=Date.now()-start,brainKey=key+'.review.json';
  await env.PROJECT_FILES.put(brainKey,JSON.stringify({reviewedAt:now(),sourceFileId:fileId,sourcePackageFileId:sourceId,sourcePath:path,assetRole:'FULL_NATIVE_PAGE_BENCHMARK',processingMs:elapsed,scaleVerified:false,review:r,verification:'MODEL_REVIEW_NOT_INDEPENDENT_VERIFICATION',productionScanItemsChanged:false}));
  await env.DB.prepare('UPDATE native_page_scan_trials SET status=?,brain_key=?,processing_ms=?,updated_at=? WHERE id=?').bind(validScan(r)?'MODEL_COMPLETE':'NEEDS_REVIEW',brainKey,elapsed,now(),id).run();
 }catch(e){await env.DB.prepare("UPDATE native_page_scan_trials SET status='FAILED',error=?,processing_ms=?,updated_at=? WHERE id=?").bind(String(e.message||e).slice(0,400),Date.now()-start,now(),id).run();}
}
