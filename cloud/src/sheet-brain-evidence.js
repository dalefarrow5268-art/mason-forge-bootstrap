const completeReview = record => {
 const review = record?.review;
 return review?.coverage === 'COMPLETE'
  && Array.isArray(review.unreadableRegions)
  && review.unreadableRegions.length === 0
  && Array.isArray(review.findings)
  && (review.blank === true || review.findings.length > 0)
  && review.findings.every(f => typeof f?.content === 'string' && f.content.trim()
    && typeof f?.location === 'string' && f.location.trim());
};

export function normalizeBrainRecords(records, maxBytes = 160000) {
 if (!Array.isArray(records) || !records.length || !records.every(completeReview)) return null;
 const pages = records.map(record => ({
  sourcePath: record.sourcePath,
  scanAssetPath: record.scanAssetPath,
  assetRole: record.assetRole,
  sheetId: record.review.sheetId || '',
  blank: record.review.blank === true,
  scaleVerified: record.scaleVerified === true,
  findings: record.review.findings.map(f => ({
   kind: typeof f.kind === 'string' ? f.kind.slice(0, 100) : '',
   location: f.location.slice(0, 500),
   content: f.content.slice(0, 4000),
  })),
 }));
 const context = {coverage:'COMPLETE', unreadableRegions:[], pages};
 const serialized = JSON.stringify(context);
 if (new TextEncoder().encode(serialized).length > maxBytes) return null;
 return {context, serialized};
}

export async function loadCompleteSheetBrain(env, fileId, maxBytes = 160000) {
 const layer = await env.DB.prepare(
  'SELECT source_path,brain_keys_json FROM plan_layer_jobs WHERE plan_file_id=?'
 ).bind(fileId).first();
 if (!layer?.brain_keys_json) return null;
 let keys;
 try { keys = JSON.parse(layer.brain_keys_json); } catch { return null; }
 if (!Array.isArray(keys) || !keys.length || keys.some(k => typeof k !== 'string' || !k)) return null;
 const records = [];
 for (const key of keys) {
  const object = await env.PROJECT_FILES.get(key);
  if (!object) return null;
  try { records.push(JSON.parse(await object.text())); } catch { return null; }
 }
 const normalized = normalizeBrainRecords(records,maxBytes);
 return normalized ? {...normalized,sourcePath:layer.source_path,brainKeys:keys} : null;
}
