// One-time, idempotent enrollment of Dale's selected Bradenton upload.
// Credentials remain in GitHub Actions secrets; no document contents are logged.
const base='https://api.cloudflare.com/client/v4/accounts/'+process.env.CLOUDFLARE_ACCOUNT_ID;
const database='736f655b-889d-4fb2-8948-0a396d39436f';
const expected='2026-09-05-bradenton-intake';
const submission='bask-bradenton-2513-v1';
async function query(sql,params=[]){
 const response=await fetch(base+'/d1/database/'+database+'/query',{method:'POST',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN,'content-type':'application/json'},body:JSON.stringify({sql,params})});
 const data=await response.json();if(!response.ok||!data.success||data.result.some(r=>!r.success))throw new Error('D1 operation failed, HTTP '+response.status);return data.result[0].results||[];
}
let deployed=false;
for(let i=0;i<24;i++){
 const r=await fetch('https://mason-forge-cloud.mason-forge-ssx.workers.dev/health',{signal:AbortSignal.timeout(30000)});const h=await r.json();
 if(r.ok&&h.releaseId===expected){deployed=true;break;}
 await new Promise(resolve=>setTimeout(resolve,15000));
}
if(!deployed)throw new Error('Required intake deployment is not live; no enrollment performed');
const [original]=await query('SELECT id,project_id,file_name,size_bytes,archived_at FROM project_files WHERE id=?',[2513]);
if(!original||original.project_id!==13||original.archived_at||original.file_name!=='Downtown Bradenton (2).zip'||original.size_bytes!==162701142)throw new Error('Selected source no longer matches verified upload');
const [project]=await query('SELECT id,name FROM projects WHERE id=?',[3]);if(project?.name!=='Bask Development')throw new Error('BASK destination identity mismatch');
const [prior]=await query('SELECT * FROM phase_intake_submissions WHERE id=?',[submission]);
if(prior&&(prior.project_id!==3||prior.original_ids_json!=='[2513]'))throw new Error('Conflicting existing intake submission');
const at=new Date().toISOString();
await query('INSERT OR IGNORE INTO phase_intake_submissions(id,project_id,project_name,original_ids_json,created_at) VALUES(?,?,?,?,?)',[submission,3,'Downtown Bradenton','[2513]',at]);
await query('INSERT OR IGNORE INTO phase_intake_jobs(id,submission_id,original_file_id,updated_at) VALUES(?,?,?,?)',[submission+'-2513',submission,2513,at]);
console.log('Bradenton intake enrolled; original remains in holding.');
for(let i=0;i<12;i++){
 await fetch('https://mason-forge-cloud.mason-forge-ssx.workers.dev/health',{signal:AbortSignal.timeout(30000)});
 const jobs=await query('SELECT status,staged_file_id,error FROM phase_intake_jobs WHERE submission_id=?',[submission]);
 console.log('Intake status:',JSON.stringify(jobs));
 if(jobs.some(j=>j.status==='NEEDS_REVIEW'))throw new Error('Intake requires review');
 if(jobs.every(j=>j.status==='COMPLETE'))break;
 await new Promise(resolve=>setTimeout(resolve,15000));
}
const state=await query('SELECT status FROM phase_intake_submissions WHERE id=?',[submission]);console.log('Submission state:',JSON.stringify(state));
const phaseOne=await query('SELECT j.status,COUNT(i.id) inventoried,SUM(i.status=\'SORTED\') sorted,SUM(i.status=\'NEEDS_REVIEW\') needs_review FROM phase_intake_jobs x JOIN phase_one_jobs j ON j.source_file_id=x.staged_file_id LEFT JOIN phase_one_items i ON i.job_id=j.id WHERE x.submission_id=? GROUP BY j.id',[submission]);console.log('Phase One:',JSON.stringify(phaseOne));
const counts=await query("SELECT (SELECT COUNT(*) FROM phase_three_divisions WHERE edition='2026') division_count,(SELECT COUNT(*) FROM phase_four_sections WHERE edition='2026') section_count");console.log('Verified-catalog row counts:',JSON.stringify(counts));
