// Uses existing CI Cloudflare credentials. No secret is returned or persisted.
// Exercises real D1 persistence through the production lifecycle module, not HTTP auth.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { exerciseLifecycle } from './brain-lifecycle.mjs';
const token=process.env.CLOUDFLARE_API_TOKEN, account=process.env.CLOUDFLARE_ACCOUNT_ID;
if(!token || !account) throw new Error('Existing Cloudflare deployment credentials are required.');
const config=await readFile(new URL('../wrangler.toml',import.meta.url),'utf8');
const database=config.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
if(!database)throw new Error('D1 database ID missing.');
const url=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
async function query(batch){
  const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({batch}),signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  if(!response.ok || !data.success || data.result?.some(row=>row.success===false))throw new Error(`D1 smoke request failed (${response.status}): ${JSON.stringify(data.errors||[])}`);
  return data.result;
}
class Statement {
  constructor(sql,params=[]){this.sql=sql;this.params=params;}
  bind(...params){return new Statement(this.sql,params);}
  async all(){return (await query([{sql:this.sql,params:this.params}]))[0];}
  async first(){return (await this.all()).results?.[0] || null;}
  async run(){return this.all();}
}
const env={DB:{prepare:sql=>new Statement(sql),batch:statements=>query(statements.map(({sql,params})=>({sql,params})))}};
const run=process.env.GITHUB_RUN_ID || Date.now();
const attempt=process.env.GITHUB_RUN_ATTEMPT || '1';
const report=await exerciseLifecycle(env,`system-test-${run}-${attempt}`,{principalId:`github-deployment-${run}`,role:'orchestrator',authenticated:true});
await mkdir('../runtime-verification',{recursive:true});
await writeFile('../runtime-verification/brain-storage.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
