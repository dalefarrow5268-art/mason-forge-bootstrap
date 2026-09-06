import assert from 'node:assert/strict';
import {normalizeBrainRecords} from '../src/sheet-brain-evidence.js';

const record={sourcePath:'page.pdf',scanAssetPath:'page.pdf',assetRole:'SOURCE',scaleVerified:false,review:{coverage:'COMPLETE',unreadableRegions:[],blank:false,sheetId:'A2.1',findings:[{kind:'note',location:'detail 1',content:'Concrete curb shown'}]}};
assert.ok(normalizeBrainRecords([record]));
assert.equal(normalizeBrainRecords([{...record,review:{...record.review,coverage:'PARTIAL'}}]),null);
assert.equal(normalizeBrainRecords([{...record,review:{...record.review,unreadableRegions:[{location:'x',reason:'blur'}]}}]),null);
assert.equal(normalizeBrainRecords([{...record,review:{...record.review,findings:[{location:'x',content:''}]}}]),null);
assert.equal(normalizeBrainRecords([record],10),null);
console.log('Sheet Brain evidence reuse checks passed.');
