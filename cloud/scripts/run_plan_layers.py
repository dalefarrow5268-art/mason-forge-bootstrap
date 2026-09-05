"""Consume scanned plan handoffs using the existing authorized CF job credential."""
import sys, pathlib, tempfile, json, datetime, hashlib
from run_holding import query, r2, now
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]/'workers'/'plan-layers'))
from pipeline import run

def main():
    cutoff=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=45)).isoformat()
    jobs=query("SELECT l.*,f.project_id,f.r2_key,f.size_bytes,f.file_name FROM plan_layer_jobs l JOIN project_files f ON f.id=l.plan_file_id WHERE f.archived_at IS NULL AND l.attempts<5 AND (l.status='PENDING' OR (l.status='RUNNING' AND l.updated_at<?)) ORDER BY l.updated_at LIMIT 2",[cutoff])
    for job in jobs:
        at=now();jid=job['id']
        if not query("UPDATE plan_layer_jobs SET status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND updated_at=? RETURNING id",[at,jid,job['updated_at']]):continue
        try:
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);source=root/'source.pdf'
                # Ensure every saved scan record still exists before layer processing.
                keys=json.loads(job['brain_keys_json'])
                if not keys:raise ValueError('No Brain scan records')
                for n,key in enumerate(keys):
                    record=root/f'brain-{n}.json';r2('get',key,record)
                    saved=json.loads(record.read_text());review=saved.get('review',{})
                    if saved.get('originalHoldingFileId')!=job['source_file_id'] or saved.get('preparedPackageFileId')!=job['prepared_file_id'] or saved.get('sourcePath')!=job['source_path'] or review.get('coverage')!='COMPLETE' or review.get('unreadableRegions')!=[]:raise ValueError('Brain coverage or source linkage invalid')
                r2('get',job['r2_key'],source)
                if source.stat().st_size!=job['size_bytes']:raise ValueError('Source size changed')
                import fitz
                with fitz.open(source) as doc:
                    if len(doc)!=1:raise ValueError('Prepared handoff must identify exactly one source page')
                result=run(source,1,{'adapter':'auto-revit-candidates'},root/'cache')
                folder=pathlib.Path(result['folder']);manifest=result['manifest']
                prefix=f"projects/{job['project_id']}/Mason Project Brain/Plan Layers/{job['plan_file_id']}/{manifest['cacheKey']}"
                manifest['holdingBrainRecords']=keys;manifest['holdingSourceFileId']=job['source_file_id'];manifest['planFileId']=job['plan_file_id']
                # Verify persisted bytes before publishing the handoff marker.
                layer_id=None
                for file in folder.iterdir():
                    if file.name=='layer-manifest.json':continue
                    key=prefix+'/'+file.name;r2('put',key,file)
                    verify=root/'verify';r2('get',key,verify)
                    if hashlib.sha256(verify.read_bytes()).digest()!=hashlib.sha256(file.read_bytes()).digest():raise ValueError('Stored layer artifact checksum mismatch')
                    path=f"Mason Project Brain/Plan Layers/{job['plan_file_id']}/{manifest['cacheKey']}/{file.name}"
                    typ={'pdf':'application/pdf','json':'application/json','png':'image/png'}.get(file.suffix[1:],'application/octet-stream')
                    query("INSERT OR IGNORE INTO project_files(project_id,r2_key,file_name,relative_path,file_type,size_bytes,review_status,source_class,uploaded_at,updated_at) VALUES(?,?,?,?,?,?,'LAYER CLASSIFICATION REVIEW REQUIRED','PLAN LAYER OUTPUT',?,?)",[job['project_id'],key,file.name,path,typ,file.stat().st_size,now(),now()])
                    if file.name=='layers.pdf':layer_id=query('SELECT id FROM project_files WHERE r2_key=?',[key])[0]['id']
                    query("UPDATE plan_layer_jobs SET updated_at=? WHERE id=? AND status='RUNNING'",[now(),jid])
                manifest_file=folder/'layer-manifest.json';manifest_file.write_text(json.dumps(manifest,indent=2));mk=prefix+'/layer-manifest.json';r2('put',mk,manifest_file)
                status='LAYER_REVIEW_REQUIRED' if layer_id else 'UNSUPPORTED_REQUIRES_ADAPTER'
                query("UPDATE plan_layer_jobs SET status=?,source_sha256=?,manifest_key=?,layered_file_id=?,error=?,updated_at=?,finished_at=? WHERE id=?",[status,manifest['identity']['sourceSha256'],mk,layer_id,'Measuring-layer classification must be validated before takeoff' if layer_id else manifest['layerStatus'],now(),now(),jid])
                print(json.dumps({'id':jid,'status':status,'counts':manifest['counts']}),flush=True)
        except Exception as error:
            terminal=isinstance(error,ValueError) or job['attempts']+1>=5
            query('UPDATE plan_layer_jobs SET status=?,error=?,updated_at=? WHERE id=?',['NEEDS_REVIEW' if terminal else 'PENDING',str(error)[:400],now(),jid])
            print(json.dumps({'id':jid,'status':'NEEDS_REVIEW' if terminal else 'RETRY_PENDING','error':str(error)[:200]}),flush=True)
    print(json.dumps(query('SELECT status,COUNT(*) count FROM plan_layer_jobs GROUP BY status')),flush=True)
if __name__=='__main__':main()
