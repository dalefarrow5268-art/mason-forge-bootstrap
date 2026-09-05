"""Hash-check and record only the Bradenton layer pairs already visually reviewed."""
import hashlib, json, pathlib, tempfile
from run_holding import query, r2, now

REVIEWS={
 'plan-layers-3000':{
  'sheet':'A2.4 FOURTH FLOOR PLAN',
  'source':'cbb29231c3a20ffe1c2ee6ed936c8bebedf87d4dc6a09f3a56641c919a67beb7',
  'layer':'bbba4837fec3b71c5a954fd6eeb0d1c0536208d6176ea5928c28f4c06bd61c30'},
 'plan-layers-3002':{
  'sheet':'A2.5 FIFTH FLOOR PLAN',
  'source':'887081f2a366ecce4a195f7b8b79269fdcc404aead03508d44adb6e59e4eba2f',
  'layer':'0741359272e8ee645071187d685ce11d2f1a8478070c39e1a1887d9e7baa0873'}
}

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
 submission=query("SELECT s.id FROM phase_project_submissions s,json_each(s.source_file_ids_json) j WHERE CAST(j.value AS INTEGER)=2514 LIMIT 1")[0]['id']
 # Correct the earlier region-approval audit linkage to the registered submission.
 query("UPDATE project_phase_audit SET submission_id=? WHERE id IN ('region-review-plan-layers-3000','region-review-plan-layers-3002','region-review-plan-layers-3012')",[submission])
 with tempfile.TemporaryDirectory() as td:
  root=pathlib.Path(td)
  for jid,expected in REVIEWS.items():
   rows=query("""SELECT l.*,source.r2_key source_key,layer.r2_key layer_key
    FROM plan_layer_jobs l JOIN project_files source ON source.id=l.plan_file_id
    JOIN project_files layer ON layer.id=l.layered_file_id WHERE l.id=?""",[jid])
   if not rows:raise RuntimeError(jid+' layer job missing')
   job=rows[0]
   if job['status']=='READY_FOR_TAKEOFF':print(json.dumps({'id':jid,'status':'READY_FOR_TAKEOFF','skipped':True}));continue
   if job['status']!='LAYER_REVIEW_REQUIRED':raise RuntimeError(jid+' is not ready for layer review')
   source=root/(jid+'-source.pdf');layer=root/(jid+'-layers.pdf');manifest_file=root/(jid+'-manifest.json')
   r2('get',job['source_key'],source);r2('get',job['layer_key'],layer);r2('get',job['manifest_key'],manifest_file)
   manifest=json.loads(manifest_file.read_text());source_hash=sha(source);layer_hash=sha(layer)
   if source_hash!=job['source_sha256'] or source_hash!=expected['source']:raise RuntimeError(jid+' source hash differs from reviewed source')
   if layer_hash!=expected['layer'] or manifest.get('artifactSha256',{}).get('layers.pdf')!=layer_hash:raise RuntimeError(jid+' layer hash differs from reviewed layer')
   reviewed_at=now();review={'reviewer':'OpenAI Codex visual PDF comparison for Dale Farrow','evidence':expected['sheet']+' source and measuring-layer PDFs were compared side by side at full-page resolution. Measurable plan walls, openings, doors, room names and room numbers remain; room matrices, general notes and title-block/reference content are excluded. Classification only; scale and quantities are not verified.','sourceSha256':source_hash,'layerSha256':layer_hash,'classificationComplete':True,'scaleVerified':False,'at':reviewed_at}
   review_file=root/(jid+'-review.json');review_file.write_text(json.dumps(review,indent=2));r2('put',job['manifest_key']+'.review.json',review_file)
   query("INSERT OR IGNORE INTO project_phase_audit(id,submission_id,action,target_id,detail_json,created_at) VALUES(?,?,?,?,?,?)",['layer-review-'+jid+'-'+layer_hash[:12],submission,'VERIFY_PLAN_LAYERS',jid,json.dumps(review),reviewed_at])
   changed=query("UPDATE plan_layer_jobs SET status='READY_FOR_TAKEOFF',error=NULL,updated_at=? WHERE id=? AND status='LAYER_REVIEW_REQUIRED' RETURNING id",[reviewed_at,jid])
   if not changed:raise RuntimeError(jid+' layer status changed during review')
   print(json.dumps({'id':jid,'status':'READY_FOR_TAKEOFF','sourceSha256':source_hash,'layerSha256':layer_hash,'scaleVerified':False}))

if __name__=='__main__':main()
