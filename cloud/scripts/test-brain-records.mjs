import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { BRAIN_SCHEMA_STATEMENTS, handleBrainAction, validateRecord } from '../src/brain-records.js';
import { exerciseLifecycle, testRecord, fixtureReview } from './brain-lifecycle.mjs';
const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE projects(id INTEGER PRIMARY KEY); INSERT INTO projects VALUES(3),(4);');
for (const sql of BRAIN_SCHEMA_STATEMENTS) sqlite.exec(sql);
class Statement {
  constructor(sql, params=[]) { this.sql=sql; this.params=params; }
  bind(...params) { return new Statement(this.sql, params); }
  async first() { return sqlite.prepare(this.sql).get(...this.params) || null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.params) }; }
  async run() { const result=sqlite.prepare(this.sql).run(...this.params); return {success:true,meta:{changes:Number(result.changes)}}; }
}
const env={DB:{prepare:sql=>new Statement(sql),async batch(statements){
  sqlite.exec('BEGIN'); try {const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}
}}};
const context={principalId:'local-test-orchestrator',role:'orchestrator',authenticated:true};
const report=await exerciseLifecycle(env,'local-smoke',context);
const call=(action,args)=>handleBrainAction(env,action,{projectId:3,...args},context);
await assert.rejects(handleBrainAction(env,'list',{projectId:3},{...context,authenticated:false}),/Authenticated/);
await assert.rejects(call('save',{id:'invalid',expectedVersion:0,record:{...testRecord(),sourceRefs:[]}}),/evidence/);
await assert.rejects(call('save',{id:'reserved',expectedVersion:0,record:{...testRecord(),id:'misleading'}}),/reserved/i);
assert.throws(()=>validateRecord({...testRecord(),quantity:NaN}),/quantity/);
assert.throws(()=>validateRecord({...testRecord(),unitCost:10,scopeTotal:49}),/scopeTotal/);
assert.throws(()=>sqlite.prepare("DELETE FROM brain_revisions WHERE record_id='local-smoke-fixture'").run(),/immutable/);
assert.throws(()=>sqlite.prepare("UPDATE brain_revisions SET action='tampered'").run(),/immutable/);
const hidden=await handleBrainAction(env,'get',{projectId:4,id:'local-smoke-fixture'},context);
assert.equal(hidden.record,null);
const original=await call('get',{id:'local-smoke-fixture'});
const assignmentSnapshot=await call('get_assignment',{id:'local-smoke-assignment'});
assert.equal(assignmentSnapshot.assignment.outputRecords[0].version,3);
assert.equal(assignmentSnapshot.history.length,3);
await call('save',{id:'local-smoke-fixture',expectedVersion:3,record:{...testRecord(),quantity:7,calculation:'new unverified observation'}});
const revised=await call('get',{id:'local-smoke-fixture'});
assert.equal(revised.record.masonApproval,null);
assert.equal(revised.record.verifier,null);
assert.equal(revised.history.length,4);
assert.equal(JSON.parse(revised.history[2].data_json).quantity,original.record.quantity);
assert.equal((await call('get_assignment',{id:'local-smoke-assignment'})).assignment.outputRecords[0].version,3);
await call('save',{id:'memory',expectedVersion:0,record:{recordKind:'MEMORY',memoryType:'SHEET_REVIEW',status:'Observed',scope:'Local memory fixture',division:'TEST',content:'Source review without a measured takeoff.',sourceRefs:['LOCAL TEST'],producer:testRecord().producer}});
await assert.rejects(call('verify',{id:'memory',expectedVersion:1,verifier:fixtureReview}),/Memory/);
const isolated=await handleBrainAction(env,'list',{projectId:4},context);
assert.equal(isolated.counts.records,0);
assert.equal(isolated.roles.length,8);
const allowance={...testRecord(),recordKind:'TAKEOFF',status:'Estimated allowance'};
await call('save',{id:'local-allowance',expectedVersion:0,record:allowance});
await assert.rejects(call('verify',{id:'local-allowance',expectedVersion:1,verifier:fixtureReview}),/observed/);
await assert.rejects(call('approve_allowance',{id:'local-allowance',expectedVersion:1,approval:{workerId:'mason',runId:'local',evidenceRefs:['test']}}),/daleApproval/);
await call('approve_allowance',{id:'local-allowance',expectedVersion:1,approval:{workerId:'mason',runId:'local',evidenceRefs:['LOCAL TEST ONLY']},daleApproval:{evidenceRefs:['LOCAL TEST ONLY — fabricated test approval, never production']}});
const entry=await call('mark_entered',{id:'local-allowance',expectedVersion:2,entryEvidence:['LOCAL TEST receipt']});
assert.equal(entry.basisStatus,'Estimated allowance');
console.log(JSON.stringify({...report,additionalGates:'auth, evidence, reserved fields, arithmetic, immutable history, project isolation, invalidation, allowance approval'},null,2));
