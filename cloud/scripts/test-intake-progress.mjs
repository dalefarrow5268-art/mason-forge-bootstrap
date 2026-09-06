import assert from 'node:assert/strict';
import {summarize, intakeProgress} from '../src/intake-progress.js';

const accepted=Array.from({length:20},()=>({status:'READY_FOR_ESTIMATE',result_key:'scopes.json'}));
const rejected={status:'NEEDS_REVIEW',error:'Scope must be one short line with valid source references'};
let p=summarize([...accepted,rejected],[...accepted,rejected],5,{upstreamComplete:false});
assert.equal(p.done,20);
assert.equal(p.total,21);
assert.equal(p.percent,95);
assert.equal(p.status,'NEEDS_REVIEW');
assert.deepEqual(p.errors,[rejected.error]);
p=summarize(accepted,accepted,5,{upstreamComplete:false});
assert.equal(p.status,'RUNNING');
assert.equal(p.done,20);
assert.equal(p.percent,99);
p=summarize(accepted,accepted,5,{upstreamComplete:true});
assert.equal(p.status,'COMPLETE');
assert.equal(p.percent,100);
assert.equal(summarize([],[],5,{upstreamComplete:false}).status,'WAITING');
assert.equal(summarize([{status:'COMPLETE'}],[{status:'SORTED'}],1).done,1);
assert.equal(summarize([{status:'READY_FOR_ESTIMATE'}],[{status:'COMPLETE'}],4).done,1);

// Exercise the actual aggregation call site and persisted tracking state.
for(const upstreamReady of [false,true]){
 const tracking=[];
 const db={prepare(sql){return {async first(){return sql.includes('SELECT (SELECT COUNT(*)')?{divisions:50,sections:1337}:null;},bind(...args){return {
  async all(){
   if(sql.includes('FROM phase_project_submissions'))return {results:[{id:'test',source_file_ids_json:'[]'}]};
   if(sql.includes('FROM phase_three_jobs'))return {results:[{status:'READY_FOR_ESTIMATE'}]};
   if(sql.includes('FROM phase_three_items'))return {results:[{status:'COMPLETE'}]};
   if(sql.includes('FROM phase_four_jobs')&&!sql.includes('phase_four_items'))return {results:[{status:upstreamReady?'READY_FOR_ESTIMATE':'RUNNING'}]};
   if(sql.includes('FROM phase_four_items'))return {results:[{status:upstreamReady?'COMPLETE':'QUEUED'}]};
   if(sql.includes('FROM phase_five_jobs'))return {results:accepted};
   return {results:[]};
  },
  async first(){return sql.includes('SELECT (SELECT COUNT(*)')?{divisions:50,sections:1337}:null;},
  sql,args
 };}};},async batch(writes){tracking.push(...writes);}};
 const result=await intakeProgress({DB:db},3);
 const scope=result.projects[0].phases[4];
 assert.equal(scope.done,20);
 assert.equal(scope.status,upstreamReady?'COMPLETE':'RUNNING');
 const update=tracking.find(w=>w.sql.startsWith('INSERT INTO project_phase_tracking(')&&w.args[1]===5);
 assert.equal(update.args[2],scope.status);
 assert.equal(update.args[4]===null,!upstreamReady);
}
console.log('Intake progress counts accepted scope jobs and preserves upstream completion gates.');
