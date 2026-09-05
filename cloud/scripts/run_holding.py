"""Scheduled preparation runner using the existing Cloudflare deployment credential."""
import datetime, json, os, pathlib, subprocess, tempfile, time, tomllib, urllib.request
from prepare_holding import prepare,sha
BASE='https://api.cloudflare.com/client/v4/accounts/'+os.environ['CLOUDFLARE_ACCOUNT_ID']
TOKEN=os.environ['CLOUDFLARE_API_TOKEN']
DB='736f655b-889d-4fb2-8948-0a396d39436f'
BUCKET='mason-forge-project-files'
PREPARATION_VERSION='native-capture-v2'
CONFIG=tomllib.loads((pathlib.Path(__file__).resolve().parents[1]/'wrangler.toml').read_text())
EXPECTED_RELEASE=CONFIG['vars']['RELEASE_ID']
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
def query(sql,params=()):
    req=urllib.request.Request(BASE+'/d1/database/'+DB+'/query',data=json.dumps({'sql':sql,'params':list(params)}).encode(),headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=60) as r:d=json.load(r)
    if not d.get('success') or any(not x.get('success') for x in d['result']):raise RuntimeError('D1 query failed')
    return d['result'][0].get('results',[])
def r2(action,key,path):
    p=subprocess.run(['npx','wrangler','r2','object',action,BUCKET+'/'+key,'--remote','--file',str(path)],capture_output=True,text=True,timeout=600)
    if p.returncode:raise RuntimeError('R2 '+action+' failed: '+p.stderr[-300:])
def main():
    # The deployment applies this migration. Do not release work to an old Worker.
    req=urllib.request.Request(BASE+'/workers/scripts/mason-forge-cloud/settings',headers={'Authorization':'Bearer '+TOKEN})
    with urllib.request.urlopen(req,timeout=60) as r:settings=json.load(r)
    bindings=settings.get('result',{}).get('bindings',[])
    if not any(x.get('name')=='RELEASE_ID' and x.get('text')==EXPECTED_RELEASE for x in bindings):raise RuntimeError('Holding scanner deployment not live')
    query("INSERT OR IGNORE INTO holding_preparations(source_file_id,updated_at) SELECT j.source_file_id,? FROM phase_one_jobs j JOIN project_files f ON f.id=j.source_file_id WHERE f.source_class='PHASE ONE INTAKE' AND j.status='PENDING'",[now()])
    jobs=query("SELECT p.*,f.r2_key,f.file_name,f.size_bytes,f.project_id FROM holding_preparations p JOIN project_files f ON f.id=p.source_file_id WHERE f.archived_at IS NULL AND (p.status='PENDING' OR (p.status='RUNNING' AND p.updated_at<?)) AND p.attempts<5 ORDER BY p.source_file_id LIMIT 3",[(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=40)).isoformat()])
    for job in jobs:
        sid=job['source_file_id'];at=now()
        claimed=query("UPDATE holding_preparations SET status='RUNNING',attempts=attempts+1,started_at=COALESCE(started_at,?),updated_at=?,error=NULL WHERE source_file_id=? AND updated_at=? RETURNING source_file_id",[at,at,sid,job['updated_at']])
        if not claimed:continue
        try:
            with tempfile.TemporaryDirectory() as td:
                root=pathlib.Path(td);src=root/'source';out=root/'prepared.zip';mp=root/'manifest.json'
                r2('get',job['r2_key'],src)
                if src.stat().st_size!=job['size_bytes']:raise ValueError('Source size changed')
                last=[0]
                def progress(m):
                    if time.monotonic()-last[0]>10:
                        query('UPDATE holding_preparations SET pages_total=?,units_done=?,scan_units_total=?,files_total=?,updated_at=? WHERE source_file_id=?',[m['pagesTotal'],m['unitsDone'],m['scanUnitsTotal'],len(m['files']),now(),sid]);last[0]=time.monotonic()
                m=prepare(src,job['file_name'],out,mp,progress)
                key=f"projects/{job['project_id']}/Mason Project Brain/Intake/{sid}/{m['sourceSha256']}/{PREPARATION_VERSION}/prepared.zip";mk=key+'.manifest.json'
                r2('put',key,out);r2('put',mk,mp)
                # Download and hash the stored package before releasing Phase One.
                check=root/'verify.zip';r2('get',key,check)
                if sha(check)!=m['preparedSha256']:raise ValueError('Stored package checksum mismatch')
                at=now();path=f"SSX Project Holding Folder/Prepared/{sid}/prepared.zip"
                query("INSERT OR IGNORE INTO project_files(project_id,r2_key,file_name,relative_path,file_type,size_bytes,review_status,source_class,uploaded_at,updated_at) VALUES(?,?,?,?,?,?,'PREPARED - AWAITING PHASE ONE','HOLDING PREPARED PACKAGE',?,?)",[job['project_id'],key,'prepared.zip',path,'application/zip',out.stat().st_size,at,at])
                fid=query('SELECT id FROM project_files WHERE r2_key=?',[key])[0]['id']
                query("UPDATE holding_preparations SET status='READY',prepared_file_id=?,manifest_key=?,source_sha256=?,prepared_sha256=?,files_total=?,pages_total=?,units_done=?,scan_units_total=?,finished_at=?,updated_at=?,error=NULL WHERE source_file_id=?",[fid,mk,m['sourceSha256'],m['preparedSha256'],len(m['files']),m['pagesTotal'],m['unitsDone'],m['scanUnitsTotal'],at,at,sid])
                print(json.dumps({'sourceFileId':sid,'preparation':'READY_FOR_PHASE_ONE','files':len(m['files']),'pages':m['pagesTotal'],'sourceUnits':m['unitsDone'],'scanUnits':m['scanUnitsTotal']}),flush=True)
        except Exception as e:
            terminal=isinstance(e,ValueError) or job['attempts']+1>=5
            query('UPDATE holding_preparations SET status=?,error=?,updated_at=? WHERE source_file_id=?',['NEEDS_REVIEW' if terminal else 'PENDING',str(e)[:500],now(),sid])
            print(json.dumps({'sourceFileId':sid,'preparation':'NEEDS_REVIEW' if terminal else 'RETRY_PENDING','error':str(e)[:300]}),flush=True)
            raise
    # Wake the existing authenticated-by-internal-binding scheduler via its health hook.
    # The two-minute Worker cron now starts scanner jobs without an HTTP wakeup.
    print(json.dumps(query("SELECT j.id,j.status,COUNT(i.id) inventoried FROM phase_one_jobs j LEFT JOIN phase_one_items i ON i.job_id=j.id WHERE j.source_file_id IN (SELECT source_file_id FROM holding_preparations) GROUP BY j.id")),flush=True)
if __name__=='__main__':main()
