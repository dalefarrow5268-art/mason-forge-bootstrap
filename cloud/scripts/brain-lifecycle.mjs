import assert from 'node:assert/strict';
import { handleBrainAction, RECORD_CONTRACT } from '../src/brain-records.js';

// Synthetic fixture only. Independently counted by /root/independent_verification:
// TEST-A [a,b] = 2; TEST-B [c,d,e] = 3; total 5 EA. No project takeoff.
export const fixture = { 'TEST-A': ['a', 'b'], 'TEST-B': ['c', 'd', 'e'] };
export const fixtureReview = {
  workerId: 'verification',
  runId: 'independent_verification-2026-09-04-synthetic-fixture',
  evidenceRefs: ['cloud/scripts/brain-lifecycle.mjs:fixture', 'Independent agent /root/independent_verification: counted TEST-A=2, TEST-B=3; 2+3=5 EA; synthetic only.'],
  quantity: 5, unit: 'EA', calculation: 'Count TEST-A [a,b] = 2; count TEST-B [c,d,e] = 3; 2 + 3 = 5 EA.',
};
export function testRecord() {
  return {
    ...Object.fromEntries(RECORD_CONTRACT.map(field => [field, null])),
    scopeNumber: 'SYSTEM-TEST-001', recordKind: 'SYSTEM_TEST', status: 'Calculated', division: 'SYSTEM TEST',
    scope: 'Synthetic workflow fixture — never a construction quantity',
    quantity: Object.values(fixture).flat().length, unit: 'EA', calculation: '2 + 3 = 5 EA',
    sourceRefs: ['cloud/scripts/brain-lifecycle.mjs:fixture'],
    producer: { workerId: 'quantity-takeoff', runId: 'root-2026-09-04-synthetic-fixture', evidenceRefs: ['cloud/scripts/brain-lifecycle.mjs:fixture'] },
    locationBreakdown: [{ location: 'TEST-A', quantity: 2 }, { location: 'TEST-B', quantity: 3 }],
    assumptions: ['Synthetic software fixture.'], exclusions: ['All construction estimating.'], brokenChains: [],
  };
}

export async function exerciseLifecycle(env, prefix, context) {
  const call = (action, payload = {}) => handleBrainAction(env, action, { projectId: 3, ...payload }, context);
  await call('setup');
  const id = `${prefix}-fixture`, assignmentId = `${prefix}-assignment`;
  await call('assign', { id: assignmentId, expectedVersion: 0, workerId: 'quantity-takeoff', title: 'SYSTEM TEST — synthetic workflow fixture', sourceRefs: testRecord().sourceRefs });
  await call('start_assignment', { id: assignmentId, expectedVersion: 1, runId: testRecord().producer.runId });
  const created = await call('save', { id, expectedVersion: 0, record: testRecord() });
  assert.equal(created.version, 1);
  await assert.rejects(call('approve', { id, expectedVersion: 1, approval: { workerId: 'mason', runId: 'mason-fixture-review', evidenceRefs: testRecord().sourceRefs } }), /Verified/);
  await assert.rejects(call('verify', { id, expectedVersion: 1, verifier: { ...fixtureReview, runId: testRecord().producer.runId } }), /differ/);
  await assert.rejects(call('verify', { id, expectedVersion: 1, verifier: { ...fixtureReview, quantity: 6 } }), /match/);
  await call('verify', { id, expectedVersion: 1, verifier: fixtureReview });
  await assert.rejects(call('save', { id, expectedVersion: 1, record: testRecord() }), /Version conflict/);
  await call('approve', { id, expectedVersion: 2, approval: { workerId: 'mason', runId: 'root-2026-09-04-synthetic-reconciliation', evidenceRefs: ['cloud/scripts/brain-lifecycle.mjs:fixtureReview', 'Synthetic lifecycle acceptance only; not project approval.'] } });
  await assert.rejects(call('mark_entered', { id, expectedVersion: 3, entryEvidence: ['SYSTEM TEST MUST NOT ENTER'] }), /TAKEOFF/);
  await call('complete_assignment', { id: assignmentId, expectedVersion: 2, outputRecordIds: [id] });
  const retrieved = await call('get', { id });
  assert.equal(retrieved.record.status, 'Verified');
  assert.equal(retrieved.record.quantity, 5);
  assert.equal(retrieved.record.masonApproval.workerId, 'mason');
  assert.equal(retrieved.history.length, 3);
  assert.deepEqual(retrieved.history.map(row => row.action), ['save', 'verify', 'approve']);
  const summary = await call('list');
  assert.equal(summary.roles.length, 8);
  assert.equal(summary.assignments.find(row => row.id === assignmentId).status, 'COMPLETED');
  return { success: true, projectId: 3, recordId: id, assignmentId, versions: 3, quantity: 5, unit: 'EA', recordKind: 'SYSTEM_TEST', estimateEntered: false, independentReviewScope: 'Synthetic fixture only', storage: 'D1 via the same lifecycle module used by MCP', checkedAt: new Date().toISOString() };
}
