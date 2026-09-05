// Brain-inspired routing: source pointers and candidate associations, never sensory measurements.
export const ROUTER_VERSION = '1.0.0';
export const BRAIN_AREAS = {
  visual: '01 Occipital - Vision', auditory: '02 Temporal - Hearing and Language',
  touch: '03 Parietal - Touch and Space', smell: '04 Olfactory - Smell Associations',
  taste: '05 Insula - Taste Associations', memory: '06 Hippocampus - Memory Links',
  planning: '07 Frontal - Planning and Decisions', operations: '08 Brainstem - Operations',
  unclassified: '09 Unclassified',
};
const associations = [
  [/\b(CMU|masonry|concrete block)\b/i, '04', 'touch', ['rough', 'gritty'], 'CMU finishes vary'],
  [/\bEIFS\b/i, '07', 'touch', ['textured'], 'Finish must be checked against specification'],
  [/\b(earthwork|soil|excavation)\b/i, '31', 'smell', ['earthy'], 'General soil association only'],
  [/\b(landscap\w*|mulch|planting)\b/i, '32', 'smell', ['vegetation', 'mulch'], 'General landscape association only'],
  [/\b(glass|glazing)\b/i, '08', 'touch', ['smooth'], 'Surface treatment may vary'],
  [/\b(carpet|carpeting)\b/i, '09', 'touch', ['soft'], 'Product-specific verification required'],
  [/\b(water quality|taste|flavor|salinity)\b/i, null, 'taste', [], 'No taste or safety conclusion inferred'],
];
export function classifyBrainRecord(file, evidence = null) {
  const name = String(file.file_name || '');
  const text = evidence == null ? '' : JSON.stringify(evidence);
  const areas = new Set(['memory']);
  const candidates = [];
  if (/\.(pdf|png|jpe?g|webp|gif|tiff?|dwg|dxf)$/i.test(name)) areas.add('visual');
  if (/\.(wav|mp3|m4a|ogg|webm|mp4|mov)$/i.test(name) || /transcript/i.test(name)) areas.add('auditory');
  if (/\.(mp4|mov|webm)$/i.test(name)) areas.add('visual'); // Container may include video; candidate route.
  for (const [pattern, division, area, tags, limitation] of associations) {
    if (pattern.test(text)) {
      areas.add(area);
      candidates.push({division, area, tags, basis:'GENERAL_ASSOCIATION_CANDIDATE', limitation});
    }
  }
  if (areas.size === 1) areas.add('unclassified');
  return {areas:[...areas], associations:candidates};
}
export async function routeBrainRecord(env, file, evidenceKey = null, evidence = null) {
  if (!Number.isSafeInteger(Number(file.project_id)) || Number(file.project_id) < 1 ||
      !Number.isSafeInteger(Number(file.id)) || Number(file.id) < 1 || !file.r2_key) throw Error('Invalid Brain source identity');
  // Hash the retained evidence too: updated interpretation creates a separate immutable routing snapshot.
  const identity = JSON.stringify([ROUTER_VERSION, file.project_id, file.id, file.sha256 || file.r2_key, evidenceKey, evidence]);
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const root = Number(file.project_id) === 13 ? 'SSX Systems/Mason Brain' : 'Mason Project Brain';
  const base = `projects/${file.project_id}/${root}`;
  const recordKey = `${base}/Shared Memory/Records/${file.id}/${digest}.json`;
  const commitKey = `${base}/Routing/Completed/${digest}.json`;
  if (await env.PROJECT_FILES.head(commitKey)) return {cached:true, recordKey};
  const classification = classifyBrainRecord(file, evidence);
  const record = {schemaVersion:1, routerVersion:ROUTER_VERSION, projectId:Number(file.project_id),
    sourceFileId:Number(file.id), sourceKey:file.r2_key, sourceSha256:file.sha256 || null,
    evidenceKey, originalPath:file.relative_path || nameOrEmpty(file), ...classification,
    objectId:null, location:null, revision:null,
    identityStatus:'SOURCE_LINKED_OBJECT_IDENTITY_NOT_RESOLVED',
    evidenceStatus:'SOURCE_OR_MODEL_OUTPUT_NOT_INDEPENDENTLY_VERIFIED',
    rule:'Associations aid retrieval; they are not measured properties. Keep conflicting evidence and resolve identity before merging objects.'};
  const put = (key,value) => env.PROJECT_FILES.put(key,JSON.stringify(value,null,2),{httpMetadata:{contentType:'application/json'}});
  await put(recordKey,record);
  for (const area of classification.areas) {
    await put(`${base}/Lobes/${BRAIN_AREAS[area]}/Links/${file.id}/${digest}.json`,
      {projectId:record.projectId,sourceFileId:record.sourceFileId,recordKey,area});
  }
  // Completion is last; retries repair a partial write without rescanning original bytes.
  await put(commitKey,{recordKey,areas:classification.areas,routerVersion:ROUTER_VERSION});
  return {cached:false,recordKey,areas:classification.areas};
}
function nameOrEmpty(file) {return String(file.file_name || '');}

// Scheduled, resumable indexing. Reads retained evidence only; never invokes OCR or a model.
export async function routePendingBrainFiles(env) {
  const rows = await env.DB.prepare(`SELECT f.*,
    COALESCE((SELECT MAX(h.updated_at) FROM holding_scan_items h WHERE h.output_file_id=f.id),'') AS scan_updated_at,
    (SELECT h.brain_key FROM holding_scan_items h WHERE h.output_file_id=f.id AND h.brain_key IS NOT NULL ORDER BY h.updated_at DESC LIMIT 1) AS scan_brain_key
    FROM project_files f LEFT JOIN brain_lobe_routes b ON b.file_id=f.id
    WHERE f.archived_at IS NULL AND f.r2_key<>'' AND f.review_status NOT LIKE 'UPLOAD%'
      AND (b.file_id IS NULL OR COALESCE(b.source_updated_at,'')<>COALESCE(f.updated_at,'')
        OR COALESCE(b.extraction_key,'')<>COALESCE(f.extracted_text_key,'')
        OR b.scan_updated_at<>COALESCE((SELECT MAX(h.updated_at) FROM holding_scan_items h WHERE h.output_file_id=f.id),''))
    ORDER BY f.id DESC LIMIT 25`).all();
  let routed=0; const failures=[];
  for (const file of rows.results || []) {
    try {
      const evidenceKey=file.extracted_text_key || file.scan_brain_key || null;
      let evidence=null;
      if(evidenceKey){
        const obj=await env.PROJECT_FILES.get(evidenceKey);
        if(!obj) throw Error('Retained evidence missing');
        evidence=await obj.json();
      }
      const result=await routeBrainRecord(env,file,evidenceKey,evidence);
      await env.DB.prepare(`INSERT INTO brain_lobe_routes(file_id,project_id,source_updated_at,extraction_key,scan_updated_at,record_key,routed_at)
        VALUES(?,?,?,?,?,?,?) ON CONFLICT(file_id) DO UPDATE SET
        source_updated_at=excluded.source_updated_at,extraction_key=excluded.extraction_key,
        scan_updated_at=excluded.scan_updated_at,record_key=excluded.record_key,routed_at=excluded.routed_at`)
        .bind(file.id,file.project_id,file.updated_at || '',file.extracted_text_key || '',file.scan_updated_at || '',result.recordKey,new Date().toISOString()).run();
      routed++;
    } catch(error) { failures.push({fileId:file.id,error:String(error.message || error)}); }
  }
  if(failures.length) console.error('Brain routing pending retry',JSON.stringify(failures));
  return {routed,failures};
}
