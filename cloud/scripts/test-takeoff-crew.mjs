import assert from 'node:assert/strict';
import {calculateQuantity} from '../src/quantity-engine.js';
import {normalizeWorkerResult,recorderKey,TAKEOFF_WORKERS} from '../src/takeoff-crew.js';

assert.deepEqual(TAKEOFF_WORKERS,['ENVELOPE_SITE','INTERIOR_SPACES','OPENINGS','SYSTEMS_FOUNDATIONS']);
const calibrated={viewport:[0,0,100,100],anchors:[{points:[[0,0],[10,0]],knownFeet:1,label:"1'-0\""},{points:[[0,0],[0,20]],knownFeet:2,label:"2'-0\""}],notToScale:false};
assert.equal(calculateQuantity('LF',{...calibrated,points:[[0,0],[30,0]]}),3);
assert.ok(Math.abs(calculateQuantity('SF',{...calibrated,points:[[0,0],[10,0],[10,10],[0,10]],closed:true})-1)<1e-9);
assert.equal(calculateQuantity('EA',{viewport:[0,0,100,100],points:[[1,1],[2,2]]}),2);
assert.throws(()=>calculateQuantity('EA',{viewport:[0,0,100,100],points:[[1,1],[1,1]]}),/Duplicate/);

const data={completeReview:true,objects:[{canonicalId:'wall-101-102',objectType:'PHYSICAL_WALL',scopeId:'scope-1',description:'Shared partition',size:'',unit:'LF',location:'A2.1 grid B-C',evidence:'Dimension string and wall line',geometry:{...calibrated,points:[[10,20],[30,20]]},roomNames:['Mechanical','Corridor'],roomNumbers:['109'],adjacentRooms:['109','110'],finishFaces:[{side:'A'},{side:'B'}]}],exclusions:[]};
const normalized=normalizeWorkerResult(data,[{id:'scope-1'}],'INTERIOR_SPACES');
assert.equal(normalized.objects.length,1);
assert.equal(normalized.objects[0].finishFaces.length,2);
const forward=recorderKey(normalized.objects[0]);
const reverse=recorderKey({...normalized.objects[0],geometry:{...normalized.objects[0].geometry,points:[[30,20],[10,20]]}});
assert.equal(forward,reverse);
assert.throws(()=>normalizeWorkerResult(data,[{id:'other'}],'INTERIOR_SPACES'),/Invalid/);

console.log('takeoff crew tests passed');
