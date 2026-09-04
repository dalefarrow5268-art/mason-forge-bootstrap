import { INTAKE_PUBLIC_KEY } from './project-center-key.js';
const ROOT='SSX Project Holding Folder', PROJECT=13, PART=64*1024*1024;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const decode=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function authenticateIntake(request) {
 try {
  const token=(request.headers.get('authorization')||'').replace(/^Bearer /,''),[head,body,sig]=token.split('.');
  const h=JSON.parse(new TextDecoder().decode(decode(head))),b=JSON.parse(new TextDecoder().decode(decode(body)));
  const now=Math.floor(Date.now()/1000);
  if(h.alg!=='ES256'||b.aud!=='ssx-project-holding'||b.iss!=='ssx-project-center'||typeof b.sub!=='string'||!b.sub||b.sub.length>200||!Number.isInteger(b.exp)||b.exp<now||b.exp>now+120)return null;
  const key=await crypto.subtle.importKey('jwk',INTAKE_PUBLIC_KEY,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decode(sig),new TextEncoder().encode(head+'.'+body))?b.sub:null;
 }catch{return null;}
}
const validId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
export function validIntakePath(path){return typeof path==='string'&&path.length>0&&path.length<=3500&&!/[\\\x00-\x1f]/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');}
export async function projectCenterIntake(request,env){
 const url=new URL(request.url);if(url.pathname!=='/api/project-center/intake')return null;
 const owner=await authenticateIntake(request);if(!owner)return json({error:'Unauthorized'},401);
 try{
 const id=url.searchParams.get('id'),action=url.searchParams.get('action');
 if(request.method==='GET'&&action==='status'){
  const root=await env.DB.prepare('SELECT id FROM project_folders WHERE project_id=? AND folder_path=? AND archived_at IS NULL').bind(PROJECT,ROOT).first();
  return json({connected:Boolean(root),destination:ROOT,partSize:PART,maxFileBytes:PART*10000});
 }
 if(request.method==='GET'&&action==='list'){
  const rows=await env.DB.prepare("SELECT i.id,i.name,i.client_project AS project,i.size,i.revision,i.issued,i.created FROM project_center_intake i JOIN project_files f ON f.id=i.file_id WHERE i.owner=? AND i.client_project=? AND i.status='SAVED' AND f.archived_at IS NULL ORDER BY i.created DESC").bind(owner,url.searchParams.get('project')).all();
  return json(rows.results||[]);
 }
 if(!validId(id))return json({error:'Invalid transfer ID'},400);
 let row=await env.DB.prepare('SELECT * FROM project_center_intake WHERE id=?').bind(id).first();
 if(row&&row.owner!==owner)return json({error:'Transfer unavailable'},404);
 if(request.method==='GET'&&action==='download'){
  if(!row||row.status!=='SAVED')return json({error:'File unavailable'},404);
  const file=await env.DB.prepare('SELECT archived_at FROM project_files WHERE id=?').bind(row.file_id).first();
  if(!file||file.archived_at)return json({error:'File unavailable'},404);
  const obj=await env.PROJECT_FILES.get(row.r2_key);if(!obj)return json({error:'File unavailable'},404);
  return new Response(obj.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(obj.size),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(row.name.split('/').pop()),'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
 }
 if(action==='start'&&request.method==='POST'){
  const b=await request.json();
  if(!validIntakePath(b.name)||!validId(b.project)||!validId(b.batch)||!Number.isSafeInteger(b.size)||b.size<0||b.size>PART*10000)return json({error:'Invalid file metadata'},400);
  if(row){if(row.name!==b.name||row.size!==b.size||row.client_project!==b.project)return json({error:'Transfer ID conflict'},409);return json({id,saved:row.status==='SAVED',partSize:PART});}
  const root=await env.DB.prepare('SELECT id FROM project_folders WHERE project_id=? AND folder_path=? AND archived_at IS NULL').bind(PROJECT,ROOT).first();
  if(!root)return json({error:'Holding folder unavailable'},503);
  const key=`projects/${PROJECT}/holding/${id}/original`,path=`${ROOT}/${b.project}/${b.batch}/${b.name}`;
  const multipart=b.size>0?await env.PROJECT_FILES.createMultipartUpload(key,{httpMetadata:{contentType:'application/octet-stream'}}):null;
  try{await env.DB.prepare('INSERT INTO project_center_intake (id,owner,client_project,name,relative_path,r2_key,size,upload_id,revision,issued,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(id,owner,b.project,b.name,path,key,b.size,multipart?.uploadId||null,String(b.revision||'').slice(0,100),String(b.issued||'').slice(0,20),new Date().toISOString()).run();}catch(e){if(multipart)await multipart.abort();throw e;}
  return json({id,partSize:PART});
 }
 if(!row)return json({error:'Transfer unavailable'},404);
 if(row.status==='SAVED')return json({id,saved:true});
 const multipart=row.upload_id?env.PROJECT_FILES.resumeMultipartUpload(row.r2_key,row.upload_id):null;
 if(request.method==='PUT'){
  const n=Number(url.searchParams.get('part')),count=Math.ceil(row.size/PART),expected=n===count?row.size-PART*(count-1):PART;
  if(!multipart||!Number.isInteger(n)||n<1||n>count||!request.body||Number(request.headers.get('content-length'))!==expected)return json({error:'Invalid file part'},400);
  return json(await multipart.uploadPart(n,request.body));
 }
 if(action!=='complete'||request.method!=='POST')return json({error:'Unsupported action'},405);
 const b=await request.json(),count=Math.ceil(row.size/PART);
 if(!Array.isArray(b.parts)||b.parts.length!==count||b.parts.some((p,i)=>p.partNumber!==i+1||typeof p.etag!=='string'))return json({error:'Missing file parts'},400);
 let object=await env.PROJECT_FILES.head(row.r2_key);
 if(!object){if(multipart)await multipart.complete(b.parts);else await env.PROJECT_FILES.put(row.r2_key,new Uint8Array(0));object=await env.PROJECT_FILES.head(row.r2_key);}
 if(!object||object.size!==row.size)return json({error:'Stored size mismatch'},409);
 const timestamp=new Date().toISOString();
 // Register originals for SSX staff without sending them to extraction or processing queues.
 await env.DB.prepare("INSERT OR IGNORE INTO project_files (project_id,r2_key,file_name,relative_path,file_type,size_bytes,review_status,source_class,uploaded_at,updated_at) VALUES (?,?,?,?,?,?,'HOLDING REVIEW REQUIRED: ORIGINAL','PROJECT CENTER INTAKE',?,?)").bind(PROJECT,row.r2_key,row.name.split('/').pop(),row.relative_path,'application/octet-stream',row.size,timestamp,timestamp).run();
 const file=await env.DB.prepare('SELECT id FROM project_files WHERE r2_key=?').bind(row.r2_key).first();
 await env.DB.prepare("UPDATE project_center_intake SET status='SAVED',file_id=? WHERE id=? AND owner=?").bind(file.id,id,owner).run();
 return json({id,saved:true,destination:ROOT});
 }catch(e){console.error('Project center intake failed',e);return json({error:'Transfer interrupted. Retry to continue.'},503);}
}
