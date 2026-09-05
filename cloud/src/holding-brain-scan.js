import {ZipReader} from '@zip.js/zip.js';
import {R2Reader,unpack,register,safe} from './phase-one-review.js';
import {askSource} from './project-phase-common.js';
const now=()=>new Date().toISOString();
const stale=()=>new Date(Date.now()-20*60000).toISOString();
const categories=['Plans','Documents','Photos','Geotech'];
export function validScan(r){return r&&r.coverage==='COMPLETE'&&Array.isArray(r.unreadableRegions)&&r.unreadableRegions.length===0&&categories.includes(r.category)&&Array.isArray(r.findings)&&(r.blank===true||r.findings.length>0)&&r.findings.every(f=>typeof f.content==='string'&&f.content.trim()&&typeof f.location==='string'&&f.location.trim());}
export async function queueHoldingScan(env){
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
 const tasks=(await env.DB.prepare("SELECT i.id FROM holding_scan_items i JOIN holding_preparations p ON p.source_file_id=i.source_file_id WHERE p.status='SCANNING' AND (i.status='PENDING' OR (i.status IN ('QUEUED','RUNNING') AND i.updated_at<?)) LIMIT 10").bind(stale()).all()).results||[];
 for(const row of tasks){const c=await env.DB.prepare("UPDATE holding_scan_items SET status='QUEUED',updated_at=? WHERE id=? AND (status='PENDING' OR (status IN ('QUEUED','RUNNING') AND updated_at<?))").bind(now(),row.id,stale()).run();if(!c.meta.changes)continue;try{await env.DEPARTMENT_QUEUE.send({kind:'HOLDING_SCAN',id:row.id});}catch(e){await env.DB.prepare("UPDATE holding_scan_items SET status='PENDING' WHERE id=? AND status='QUEUED'").bind(row.id).run();throw e;}}
 const scans=(await env.DB.prepare("SELECT * FROM holding_preparations p WHERE status='SCANNING' AND NOT EXISTS(SELECT 1 FROM holding_scan_items i WHERE i.source_file_id=p.source_file_id AND i.status IN ('PENDING','QUEUED','RUNNING'))").all()).results||[];
 for(const p of scans){const items=(await env.DB.prepare('SELECT * FROM holding_scan_items WHERE source_file_id=? ORDER BY entry_index').bind(p.source_file_id).all()).results||[];const complete=items.length===Number(p.scan_units_total||p.units_done)&&items.every(x=>x.status==='COMPLETE');await env.DB.prepare('UPDATE holding_preparations SET status=?,error=?,updated_at=? WHERE source_file_id=?').bind(complete?'SCANNED':'NEEDS_REVIEW',complete?null:'Brain scanner found unreadable or incomplete coverage; review scanner records',now(),p.source_file_id).run();}
}
export async function processHoldingScan(body,env){
 const i=await env.DB.prepare('SELECT * FROM holding_scan_items WHERE id=?').bind(body.id).first();if(!i||!['PENDING','QUEUED','RUNNING'].includes(i.status))return;
 const attemptStart=Date.now();
 const c=await env.DB.prepare("UPDATE holding_scan_items SET status='RUNNING',attempts=attempts+1,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND (status IN ('PENDING','QUEUED') OR (status='RUNNING' AND updated_at<?))").bind(now(),now(),i.id,stale()).run();if(!c.meta.changes)return;
 try{
  const source=await env.DB.prepare('SELECT f.* FROM holding_preparations p JOIN project_files f ON f.id=p.prepared_file_id WHERE p.source_file_id=? AND f.archived_at IS NULL').bind(i.source_file_id).first();if(!source)throw Error('Prepared source unavailable');
  const root=`projects/${source.project_id}/Mason Project Brain/Intake/${i.source_file_id}`;const key=`${root}/sources/${i.id}`;
  await unpack(env,source,i,key);
  const path=`Mason Project Brain/Intake/${i.source_file_id}/Sources/${i.original_path}`;
  const fid=await register(env,source,key,path,i.size_bytes,'BRAIN SCAN');
  await env.DB.prepare("UPDATE project_files SET source_class='BRAIN SCAN SOURCE' WHERE id=?").bind(fid).run();
  const detail=i.asset_role==='DETAIL_TILE';
  const r=await askSource(env,fid,null,`${detail?'Review the ENTIRE supplied overlapping detail region of one construction sheet':'Review the ENTIRE supplied page or file'} before project phases begin. This is a detailed source record, not a summary. Read all visible titles, sheet IDs, notes, dimensions and units, legends, schedules and tables (including every readable row), symbols, details, keynotes, callouts, revisions, cross references and drawing scale labels. Describe photos. Record every observed item with its location and exact text where legible. Do not infer obscured text, dimensions or measurements. A printed scale is not verified. Return JSON {category:Plans|Documents|Photos|Geotech,coverage:COMPLETE|PARTIAL,blank:boolean,unreadableRegions:[{location,reason}],findings:[{kind,location,content}],sheetId:string,scaleVerified:false}. Set blank true only after inspecting the entire supplied region and confirming it contains no project content. If content is unreadable, review cannot fit within the response, or any region was not inspected, return PARTIAL and identify each gap. Do not claim complete coverage from a summary.`,{sourcePath:i.source_path||i.original_path,scanAssetPath:i.original_path,assetRole:i.asset_role||'SOURCE',originalHoldingFileId:i.source_file_id});
  const brainKey=`${root}/reviews/${i.id}.json`;
  await env.PROJECT_FILES.put(brainKey,JSON.stringify({reviewedAt:now(),sourceFileId:fid,originalHoldingFileId:i.source_file_id,sourcePath:i.source_path||i.original_path,scanAssetPath:i.original_path,assetRole:i.asset_role||'SOURCE',preparedPackageFileId:source.id,scaleVerified:false,review:r,verification:'MODEL_REVIEW_NOT_INDEPENDENT_VERIFICATION'}));
  const complete=validScan(r);
  await env.DB.prepare('UPDATE holding_scan_items SET status=?,output_file_id=?,brain_key=?,category=?,error=?,updated_at=?,finished_at=?,processing_ms=processing_ms+? WHERE id=?').bind(complete?'COMPLETE':'NEEDS_REVIEW',fid,brainKey,categories.includes(r.category)?r.category:null,complete?null:'Incomplete or unreadable source coverage; see Brain record',now(),now(),Date.now()-attemptStart,i.id).run();
 }catch(e){const terminal=i.attempts+1>=5;await env.DB.prepare('UPDATE holding_scan_items SET status=?,error=?,updated_at=?,processing_ms=processing_ms+? WHERE id=?').bind(terminal?'NEEDS_REVIEW':'PENDING',String(e.message||e).slice(0,500),now(),Date.now()-attemptStart,i.id).run();if(!terminal)throw e;}
}
