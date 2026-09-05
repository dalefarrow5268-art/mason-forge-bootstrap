import assert from 'node:assert/strict';
import {requirePlanLayers} from '../src/plan-layer-handoff.js';
const env=row=>({DB:{prepare:()=>({bind:()=>({first:async()=>row})})}});
for(const row of [null,{status:'PENDING'},{status:'LAYER_REVIEW_REQUIRED',layered_file_id:10},{status:'READY_FOR_TAKEOFF'}])await assert.rejects(requirePlanLayers(env(row),1),/PLAN_LAYER_GATE/);
assert.equal((await requirePlanLayers(env({status:'READY_FOR_TAKEOFF',layered_file_id:10}),1)).layered_file_id,10);
console.log('Plan layer gate: incomplete and unreviewed sheets blocked');
const {validateSheetRoute}=await import('../src/plan-layer-handoff.js');
for(const [sheetId,title] of [['A0.3','ADA INFORMATION'],['A2.15','GUEST ROOM TAGS AND NOTES'],['G0.0','TITLE PAGE']]){
 const r={route:'REFERENCE_ONLY',sheetId,title,hasProjectGeometry:false,confidence:'HIGH',evidence:[{location:'title block',content:title}]};
 assert.equal(validateSheetRoute(r).route,'REFERENCE_ONLY');
 assert.throws(()=>validateSheetRoute({...r,route:'TAKEOFF'}),/actual project geometry/);
 assert.equal(validateSheetRoute({...r,confidence:'LOW'}).route,'NEEDS_REVIEW');
}
console.log('Sheet route: reference examples cannot qualify without project geometry');
