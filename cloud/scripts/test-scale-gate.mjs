import assert from 'node:assert/strict';
import {checkScale} from '../src/scale-gate.js';
const g={viewport:[0,0,3000,1800],notToScale:false,anchors:[
 {points:[[1145.16748046875,703.8394775390625],[1259.27978515625,703.8394775390625]],knownFeet:12+8/12,label:`12'-8"`},
 {points:[[1145.16748046875,703.8394775390625],[1145.16748046875,822.8316040039062]],knownFeet:13+2.5/12,label:`13'-2 1/2"`} ]};
const ok=checkScale(g);assert(ok.relativeDisagreement<0.000001);assert.equal(ok.printedScaleTrusted,false);
for(const edit of [v=>v.anchors=[],v=>v.notToScale=true,v=>v.anchors[1]=v.anchors[0],v=>v.anchors[1].knownFeet*=1.006,v=>v.anchors[1].knownFeet=NaN,v=>v.anchors[1].points[1]=[4000,100],v=>v.anchors[1].points=[[10,10],[100,10]]]){const v=structuredClone(g);edit(v);assert.throws(()=>checkScale(v),/SCALE_GATE_BLOCKED/);}
assert.throws(()=>checkScale({printedScale:`1/8" = 1'`,viewport:g.viewport}),/SCALE_GATE_BLOCKED/);
console.log('PASS scale gate: actual A2.1 X/Y dimensions; missing, NTS, duplicate, distortion, NaN, wrong viewport, parallel and printed-only blocked');
