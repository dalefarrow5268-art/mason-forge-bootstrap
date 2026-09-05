import assert from 'node:assert/strict';
import {requirePlanLayers} from '../src/plan-layer-handoff.js';
const env=row=>({DB:{prepare:()=>({bind:()=>({first:async()=>row})})}});
for(const row of [null,{status:'PENDING'},{status:'LAYER_REVIEW_REQUIRED',layered_file_id:10},{status:'READY_FOR_TAKEOFF'}])await assert.rejects(requirePlanLayers(env(row),1),/PLAN_LAYER_GATE/);
assert.equal((await requirePlanLayers(env({status:'READY_FOR_TAKEOFF',layered_file_id:10}),1)).layered_file_id,10);
console.log('Plan layer gate: incomplete and unreviewed sheets blocked');
const {validateSheetRoute,SHEET_ROUTING_PROMPT,processSheetRouting,processSheetRoutingFallback}=await import('../src/plan-layer-handoff.js');
assert.match(SHEET_ROUTING_PROMPT,/Return one JSON object/,'JSON mode must be explicitly requested');
for(const [sheetId,title] of [['A0.3','ADA INFORMATION'],['A2.15','GUEST ROOM TAGS AND NOTES'],['G0.0','TITLE PAGE']]){
 const r={route:'REFERENCE_ONLY',sheetId,title,hasProjectGeometry:false,confidence:'HIGH',evidence:[{location:'title block',content:title}]};
 assert.equal(validateSheetRoute(r).route,'REFERENCE_ONLY');
 assert.throws(()=>validateSheetRoute({...r,route:'TAKEOFF'}),/actual project geometry/);
 assert.equal(validateSheetRoute({...r,confidence:'LOW'}).route,'NEEDS_REVIEW');
}
console.log('Sheet route: reference examples cannot qualify without project geometry');

let job={id:'route-1',status:'ROUTING_QUEUED',attempts:0,brain_keys_json:'["brain/1"]'},requestBody;
const routeEnv={
 OPENAI_API_KEY:'fixture-only',
 PROJECT_FILES:{async get(){return{text:async()=>JSON.stringify({review:{coverage:'COMPLETE',findings:[{location:'title block',content:'TITLE PAGE'}]}})}}},
 DB:{prepare(sql){return{async all(){return {results:job&&['ROUTING_PENDING','ROUTING_QUEUED'].includes(job.status)?[{id:job.id}]:[]}},bind(...parameters){return{
 async first(){return job},
  async all(){return {results:job&&['ROUTING_PENDING','ROUTING_QUEUED'].includes(job.status)?[{id:job.id}]:[]}},
  async run(){
   if(sql.includes("SET status='ROUTING_RUNNING'")){job={...job,status:'ROUTING_RUNNING',attempts:job.attempts+1};return{meta:{changes:1}}}
   if(sql.includes('route_json=?,attempts=0')){job={...job,status:parameters[0],route_json:parameters[1],attempts:0,error:parameters[2]};return{meta:{changes:1}}}
   job={...job,status:parameters[0],error:parameters[1]};return{meta:{changes:1}};
  }
 }}}}}
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async(_url,options)=>{requestBody=JSON.parse(options.body);return Response.json({error:{message:'response_format requires JSON in messages'}},{status:400})};
await processSheetRouting({id:job.id},routeEnv);
assert.equal(job.status,'ROUTING_PENDING');assert.match(job.error,/requires JSON in messages/);
job={...job,status:'ROUTING_QUEUED'};
globalThis.fetch=async(_url,options)=>{requestBody=JSON.parse(options.body);return Response.json({output:[{content:[{type:'output_text',text:JSON.stringify({route:'REFERENCE_ONLY',sheetId:'G0.0',title:'TITLE PAGE',hasProjectGeometry:false,confidence:'HIGH',evidence:[{location:'title block',content:'TITLE PAGE'}],regions:[]})}]}]})};
assert.equal(await processSheetRoutingFallback(routeEnv),1,'cron fallback claims a bounded queued route');globalThis.fetch=originalFetch;
assert.equal(job.status,'REFERENCE_ONLY');assert.match(requestBody.input[0].content,/JSON/);
console.log('Sheet route: provider errors retained and explicit JSON request succeeds');
