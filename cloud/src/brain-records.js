/** Durable records. Worker identities below are attestations by a shared authenticated
 * orchestrator, NOT independently authenticated people or autonomous processors. */
export const BRAIN_SCHEMA_STATEMENTS = [
`CREATE TABLE IF NOT EXISTS brain_roles (project_id INTEGER NOT NULL REFERENCES projects(id), role_id TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'CONFIGURED', created_at TEXT NOT NULL, PRIMARY KEY(project_id,role_id))`,
`CREATE TABLE IF NOT EXISTS brain_records (project_id INTEGER NOT NULL REFERENCES projects(id), id TEXT NOT NULL, version INTEGER NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id,id))`,
`CREATE TABLE IF NOT EXISTS brain_revisions (project_id INTEGER NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE, action TEXT NOT NULL, principal_id TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,record_id,version), FOREIGN KEY(project_id,record_id) REFERENCES brain_records(project_id,id))`,
`CREATE TRIGGER IF NOT EXISTS brain_revisions_no_update BEFORE UPDATE ON brain_revisions BEGIN SELECT RAISE(ABORT,'Brain revisions are immutable'); END`,
`CREATE TRIGGER IF NOT EXISTS brain_revisions_no_delete BEFORE DELETE ON brain_revisions BEGIN SELECT RAISE(ABORT,'Brain revisions are immutable'); END`,
`CREATE TABLE IF NOT EXISTS brain_assignments (project_id INTEGER NOT NULL REFERENCES projects(id), id TEXT NOT NULL, version INTEGER NOT NULL, data_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(project_id,id))`,
`CREATE TABLE IF NOT EXISTS brain_assignment_events (project_id INTEGER NOT NULL, assignment_id TEXT NOT NULL, version INTEGER NOT NULL, event_id TEXT NOT NULL UNIQUE, principal_id TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,assignment_id,version))`,
`CREATE TRIGGER IF NOT EXISTS brain_assignment_events_no_update BEFORE UPDATE ON brain_assignment_events BEGIN SELECT RAISE(ABORT,'Assignment events are immutable'); END`,
`CREATE TRIGGER IF NOT EXISTS brain_assignment_events_no_delete BEFORE DELETE ON brain_assignment_events BEGIN SELECT RAISE(ABORT,'Assignment events are immutable'); END`,
];
export const DEFAULT_ROLES = [
 ['sheet-review','Sheet Review Worker — source review in five-sheet batches'],
 ['quantity-takeoff','Quantity Takeoff Worker — counts, measurements, calculations'],
 ['trade','Trade Worker — trace complete systems'],
 ['schedule-equipment','Schedule and Equipment Worker — models, capacities, accessories'],
 ['broken-chain-rfi','Broken-Chain and RFI Worker'],
 ['estimate','Estimate Worker — verified scope entry'],
 ['verification','Verification Worker — independent source and quantity review'],
 ['mason','Mason — reconciliation, approval, project memory'],
];
BRAIN_SCHEMA_STATEMENTS.push(...DEFAULT_ROLES.map(([id,name]) =>
 `INSERT OR IGNORE INTO brain_roles(project_id,role_id,name,state,created_at) SELECT id,'${id}','${name}','CONFIGURED',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM projects`));
export const RECORD_CONTRACT = ['scopeNumber','materialBasis','laborBasis','unitCost','scopeTotal','divisionTotal','locationBreakdown','manufacturer','model','assumptions','exclusions','waste','brokenChains'];
export const MEMORY_TYPES = ['SHEET_REVIEW','TRADE_TRACE','EQUIPMENT_SCHEDULE','BROKEN_CHAIN','PROJECT_MEMORY'];
export const ACTION_CONTRACT = {
 envelope: 'manage_project_brain({projectId,action,payload}); get_brain_record({projectId,recordId}); get_project_brain({projectId})',
 versioning: 'Every mutation except setup needs payload.id and payload.expectedVersion (0 for new records/assignments; current returned version for updates). Conflicts require reload. projectId is provided by envelope.',
 provenance: 'producer/verifier/approval use {workerId,runId,evidenceRefs:string[]}. References must identify durable server source files/sheets/details or durable review/run artifacts. Shared orchestrator attests identities; it does not authenticate individual workers.',
 setup: 'No payload required. Configure eight roles; does not execute processors.',
 save: {payload:'{id,expectedVersion,record}', common:'recordKind, status, scope, division, sourceRefs:string[], producer:{workerId,runId,evidenceRefs:string[]}', takeoff:'recordKind TAKEOFF or SYSTEM_TEST; status Observed|Calculated|Estimated allowance|Missing or RFI; quantity/unit/calculation required unless Missing or RFI, when quantity must be null and blocker required. All recordContract fields must be present (null if unresolved). Save invalidates prior verification/approval; never send verifier/approval/entry fields.', memory:'recordKind MEMORY; memoryType SHEET_REVIEW|TRADE_TRACE|EQUIPMENT_SCHEDULE|BROKEN_CHAIN|PROJECT_MEMORY; content nonempty string; status Observed|Missing or RFI; blocker required for Missing or RFI. No takeoff financial fields required; quantity absent or null. Cannot be verified, approved, or entered.'},
 verify:'{id,expectedVersion,verifier:{workerId:verification,runId,evidenceRefs,quantity,unit,calculation}}; workerId and runId differ from producer, quantity/unit match, previous status Observed or Calculated. No MEMORY records.',
 approve:'{id,expectedVersion,approval:{workerId:mason,runId,evidenceRefs}}; requires Verified status.',
 approve_allowance:'{id,expectedVersion,approval:{workerId:mason,runId,evidenceRefs},daleApproval:{evidenceRefs}}; requires Estimated allowance. References attest Dale approval; never invent it.',
 mark_entered:'{id,expectedVersion,entryEvidence:string[]}; TAKEOFF only, verified + Mason approval or allowance + Mason and attested Dale approval. Records external entry receipts; DOES NOT write to live estimator.',
 assign:'{id,expectedVersion:0,workerId,title,sourceRefs:string[]}; creates QUEUED supervised assignment.',
 start_assignment:'{id,expectedVersion,runId}; QUEUED/BLOCKED to RUNNING. This records supervised execution, not automatic model dispatch.',
 block_assignment:'{id,expectedVersion,blocker}; QUEUED/RUNNING to BLOCKED.',
 complete_assignment:'{id,expectedVersion,outputRecordIds:string[]}; RUNNING to COMPLETED only when each stored output links assignment workerId/runId in producer/verifier/approval. MEMORY outputs supported. Output record IDs and immutable versions are pinned at completion; later edits do not alter that completed snapshot. Completion means outputs stored, not full project takeoff complete.',
};
export const RECORD_STATUSES = ['Observed','Calculated','Verified','Estimated allowance','Missing or RFI','Entered'];
const required = (value, field) => { if (typeof value !== 'string' || !value.trim() || value.length > 12000) throw new Error(`${field} must be a nonempty string`); return value.trim(); };
function refs(value, field) { if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error(`${field} requires 1–100 evidence references`); value.forEach(v => required(v, field)); }
function attestation(value, field) { if (!value || typeof value !== 'object') throw new Error(`${field} required`); required(value.workerId,`${field}.workerId`); required(value.runId,`${field}.runId`); refs(value.evidenceRefs,`${field}.evidenceRefs`); }
export function validateRecord(record) {
 if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('record required');
 for (const field of ['id','version','projectId','project_id']) if(Object.hasOwn(record,field))throw new Error(`${field} is a reserved record field`);
 if (!['TAKEOFF','SYSTEM_TEST','MEMORY'].includes(record.recordKind)) throw new Error('recordKind must be TAKEOFF, SYSTEM_TEST, or MEMORY');
 if (!RECORD_STATUSES.includes(record.status)) throw new Error('Invalid record status');
 if (record.recordKind === 'MEMORY') {
  if (!MEMORY_TYPES.includes(record.memoryType)) throw new Error('Invalid memoryType');
  if (!['Observed','Missing or RFI'].includes(record.status)) throw new Error('Memory records may only be Observed or Missing or RFI');
  if (typeof record.content !== 'string' || !record.content.trim() || record.content.length > 262144) throw new Error('Memory content must contain 1–262144 characters'); required(record.scope,'scope'); required(record.division,'division'); refs(record.sourceRefs,'sourceRefs'); attestation(record.producer,'producer');
  if (record.quantity != null) throw new Error('Memory records cannot assert quantities');
  if (record.masonApproval || record.daleApproval || record.verifier || record.entryEvidence) throw new Error('Memory records cannot assert verification, approval, or entry');
  if (record.status === 'Missing or RFI') required(record.blocker,'blocker');
  return record;
 }

 for (const field of RECORD_CONTRACT) if (!Object.hasOwn(record,field)) throw new Error(`${field} must be present (null if unresolved)`);
 for (const field of ['unitCost','scopeTotal','divisionTotal','waste']) if (record[field] !== null && (typeof record[field] !== 'number' || !Number.isFinite(record[field]) || record[field] < 0)) throw new Error(`${field} must be null or a finite nonnegative number`);
 for (const field of ['locationBreakdown','assumptions','exclusions','brokenChains']) if (record[field] !== null && !Array.isArray(record[field])) throw new Error(`${field} must be null or an array`);
 if (record.unitCost !== null && record.quantity !== null) {
  const total=Math.round(record.quantity*record.unitCost*100)/100;
  if (record.scopeTotal === null || Math.abs(record.scopeTotal-total)>0.005) throw new Error('scopeTotal must equal quantity × unitCost rounded to cents');
 }
 required(record.scopeNumber,'scopeNumber'); required(record.scope,'scope'); required(record.division,'division'); refs(record.sourceRefs,'sourceRefs'); attestation(record.producer,'producer');
 if (record.status !== 'Missing or RFI') {
  if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity < 0) throw new Error('Finite nonnegative quantity required');
  required(record.unit,'unit'); required(record.calculation,'calculation');
 } else { if (record.quantity !== null) throw new Error('Missing quantities must be null'); required(record.blocker,'blocker'); }
 if (record.masonApproval && record.status === 'Verified') {
  if (!Array.isArray(record.brokenChains) || record.brokenChains.some(issue => !issue || !['CLOSED','RESOLVED','NOT_APPLICABLE'].includes(issue.status))) throw new Error('Resolve or explicitly dispose broken chains before Mason approval');
 }
 if (record.status === 'Verified' || (record.status === 'Entered' && record.basisStatus !== 'Estimated allowance')) {
  attestation(record.verifier,'verifier');
  if (record.verifier.workerId !== 'verification') throw new Error('Verification Worker role required');
  if (record.verifier.workerId === record.producer.workerId || record.verifier.runId === record.producer.runId) throw new Error('Verifier worker and run must differ from producer');
  if (record.verifier.quantity !== record.quantity || record.verifier.unit !== record.unit) throw new Error('Independent quantity and unit must match');
  required(record.verifier.calculation,'verifier.calculation');
 }
 if(record.status==='Entered' && record.basisStatus==='Estimated allowance') { if(!record.daleApproval)throw new Error('Allowance requires attested Dale approval evidence'); refs(record.daleApproval.evidenceRefs,'daleApproval.evidenceRefs'); }
 if (record.status === 'Entered' && (record.recordKind !== 'TAKEOFF' || !record.masonApproval || !record.entryEvidence)) throw new Error('Only approved verified TAKEOFF records can be entered');
 return record;
}
export function validateTransition(previous, next, action) {
 validateRecord(next);
 if ((previous?.recordKind === 'MEMORY' || next.recordKind === 'MEMORY') && action !== 'save') throw new Error('Memory records support save only');
 if (previous && previous.recordKind !== next.recordKind) throw new Error('Record kind is immutable; create a separate record');
 if (action === 'save') { if (!['Observed','Calculated','Estimated allowance','Missing or RFI'].includes(next.status) || next.masonApproval || next.daleApproval || next.verifier || next.entryEvidence) throw new Error('Save cannot assert verification, approval, or entry'); }
 else if (action === 'verify') { if (!previous || !['Observed','Calculated'].includes(previous.status) || next.status !== 'Verified') throw new Error('Only observed/calculated records can be independently verified'); }
 else if (action === 'approve') { if (!previous || previous.status !== 'Verified' || next.status !== 'Verified') throw new Error('Mason approval requires Verified record'); }
 else if (action === 'approve_allowance') { if(!previous || previous.status!=='Estimated allowance' || next.status!=='Estimated allowance' || !next.daleApproval || !next.masonApproval) throw new Error('Allowance approval requires estimated allowance and Dale approval evidence'); }
 else if (action === 'mark_entered') { if (!previous || !['Verified','Estimated allowance'].includes(previous.status) || !previous.masonApproval || (previous.status==='Estimated allowance' && !previous.daleApproval) || next.status !== 'Entered') throw new Error('Entry requires prior verification and Mason approval'); }
 else throw new Error('Unsupported transition');
 return next;
}
function trust(context) { if (context?.authenticated !== true || context.role !== 'orchestrator') throw new Error('Authenticated orchestrator required'); return required(context.principalId,'principalId'); }
const decode = row => row ? { ...JSON.parse(row.data_json), version: row.version } : null;
async function roleExists(env, projectId, roleId) { if (!(await env.DB.prepare('SELECT role_id FROM brain_roles WHERE project_id=? AND role_id=?').bind(projectId,roleId).first())) throw new Error(`Worker role is not configured: ${roleId}`); }
async function commit(env, projectId, recordId, expectedVersion, data, action, principal, assignment=false) {
 const head = assignment ? 'brain_assignments':'brain_records', history = assignment?'brain_assignment_events':'brain_revisions', key = assignment?'assignment_id':'record_id';
 const version = expectedVersion + 1, timestamp = new Date().toISOString(), eventId=crypto.randomUUID(), serialized=JSON.stringify(data);
 const statements=[];
 if (expectedVersion === 0) statements.push(env.DB.prepare(`INSERT INTO ${head}(project_id,id,version,data_json,updated_at) VALUES(?,?,?,?,?)`).bind(projectId,recordId,version,serialized,timestamp));
 const columns = assignment ? '' : ',action'; const placeholders = assignment ? '' : ',?';
 const values=[projectId,recordId,version,eventId,principal,serialized,timestamp]; if (!assignment) values.push(action);
 statements.push(env.DB.prepare(`INSERT INTO ${history}(project_id,${key},version,event_id,principal_id,data_json,created_at${columns}) SELECT ?,?,?,?,?,?,?${placeholders} WHERE EXISTS(SELECT 1 FROM ${head} WHERE project_id=? AND id=? AND version=?)`).bind(...values,projectId,recordId,expectedVersion===0?1:expectedVersion));
 if (expectedVersion>0) statements.push(env.DB.prepare(`UPDATE ${head} SET version=?,data_json=?,updated_at=? WHERE project_id=? AND id=? AND version=? AND EXISTS(SELECT 1 FROM ${history} WHERE event_id=?)`).bind(version,serialized,timestamp,projectId,recordId,expectedVersion,eventId));
 const result=await env.DB.batch(statements);
 if (result.some(r => Number(r.meta?.changes||0)!==1)) throw new Error('Version conflict; reload before retrying');
 return {...data,id:recordId,version,provenanceNotice:'Worker identities and reviews are attested by the authenticated orchestrator; roles are not autonomous processors.'};
}
export async function handleBrainAction(env, action, args, trustedContext) {
 const principal=trust(trustedContext), projectId=args?.projectId;
 if (!Number.isSafeInteger(projectId)||projectId<1) throw new Error('Valid projectId required');
 if (!(await env.DB.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first())) throw new Error('Project not found');
 if (action==='setup') {
  await env.DB.batch(DEFAULT_ROLES.map(([id,name])=>env.DB.prepare('INSERT OR IGNORE INTO brain_roles(project_id,role_id,name,state,created_at) VALUES(?,?,?,\'CONFIGURED\',?)').bind(projectId,id,name,new Date().toISOString())));
  return {projectId,roles:DEFAULT_ROLES.map(([id,name])=>({id,name,status:'CONFIGURED',processorRunning:false})),notice:'Role configuration only; no autonomous workers started.'};
 }
 if (action==='list') { const [records,roles,assignments]=await Promise.all(['brain_records','brain_roles','brain_assignments'].map(table=>env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=?`).bind(projectId).all())); const recordValues=(records.results||[]).map(r=>({...decode(r),id:r.id})); const assignmentValues=(assignments.results||[]).map(r=>({...decode(r),id:r.id})); return {projectId, notice:'Roles are configured for supervised execution; this module starts no autonomous processors. COMPLETED assignments mean outputs stored, not full takeoff completion. Entered is an attested external receipt, not an estimator write.', actionContract:ACTION_CONTRACT,recordContract:RECORD_CONTRACT,counts:{records:recordValues.length,takeoff:recordValues.filter(r=>r.recordKind==='TAKEOFF').length,systemTest:recordValues.filter(r=>r.recordKind==='SYSTEM_TEST').length,memory:recordValues.filter(r=>r.recordKind==='MEMORY').length,takeoffStatuses:recordValues.filter(r=>r.recordKind==='TAKEOFF').reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),approvedTakeoff:recordValues.filter(r=>r.recordKind==='TAKEOFF'&&r.masonApproval).length,statuses:recordValues.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),approved:recordValues.filter(r=>r.masonApproval).length}, records:recordValues.map(r=>({id:r.id,version:r.version,recordKind:r.recordKind,memoryType:r.memoryType||null,status:r.status,scope:r.scope,division:r.division,quantity:r.quantity,unit:r.unit,masonApproved:Boolean(r.masonApproval)})),roles:(roles.results||[]).map(r=>({...r,processorRunning:false,supervisedRunningAssignments:assignmentValues.filter(a=>a.workerId===r.role_id&&a.status==='RUNNING').length})),assignments:assignmentValues}; }
 const recordId=required(args.id,'id');
 const assignment=['get_assignment','assign','start_assignment','block_assignment','complete_assignment'].includes(action);
 const row=await env.DB.prepare(`SELECT * FROM ${assignment?'brain_assignments':'brain_records'} WHERE project_id=? AND id=?`).bind(projectId,recordId).first(), previous=decode(row);
 if (action==='get_assignment') { const history=await env.DB.prepare('SELECT * FROM brain_assignment_events WHERE project_id=? AND assignment_id=? ORDER BY version').bind(projectId,recordId).all(); return {assignment:previous?{...previous,id:recordId}:null,history:history.results||[]}; }
 if (action==='get') { const history=await env.DB.prepare('SELECT * FROM brain_revisions WHERE project_id=? AND record_id=? ORDER BY version').bind(projectId,recordId).all(); return {record:previous?{id:recordId,...previous}:null,history:history.results||[]}; }
 if (!Number.isSafeInteger(args.expectedVersion)||args.expectedVersion<0||args.expectedVersion!==(previous?.version||0)) throw new Error('Version conflict; expectedVersion must match current version');
 let next;
 if (assignment) {
  if (action==='assign') { if(previous) throw new Error('Assignment already exists'); await roleExists(env,projectId,args.workerId); next={workerId:args.workerId,title:required(args.title,'title'),status:'QUEUED',sourceRefs:args.sourceRefs}; refs(next.sourceRefs,'sourceRefs'); }
  else { if(!previous) throw new Error('Assignment not found'); next={...previous}; delete next.version;
   if(action==='start_assignment') {if(!['QUEUED','BLOCKED'].includes(previous.status))throw new Error('Assignment cannot start');next.status='RUNNING';next.runId=required(args.runId,'runId');}
   if(action==='block_assignment') {if(!['QUEUED','RUNNING'].includes(previous.status))throw new Error('Assignment cannot block');next.status='BLOCKED';next.blocker=required(args.blocker,'blocker');}
   if(action==='complete_assignment') {if(previous.status!=='RUNNING')throw new Error('Assignment must be running');refs(args.outputRecordIds,'outputRecordIds'); const outputRecords=[]; for(const id of args.outputRecordIds){const output=decode(await env.DB.prepare('SELECT * FROM brain_records WHERE project_id=? AND id=?').bind(projectId,id).first());if(!output)throw new Error('Output record not found'); if(![output.producer,output.verifier,output.masonApproval].some(a=>a?.workerId===previous.workerId && a?.runId===previous.runId))throw new Error('Output must link assignment worker and run');outputRecords.push({id,version:output.version});}next.outputRecords=outputRecords;next.status='COMPLETED';next.outputRecordIds=args.outputRecordIds;next.completionMeaning='Deliverables stored; takeoff approval and estimate entry remain separate.';}
  }
 } else {
  if(action==='save'){ next={...args.record}; if(next.masonApproval || next.daleApproval || next.verifier || next.entryEvidence) throw new Error('Save cannot supply review or entry assertions'); next.masonApproval=null; next.daleApproval=null; next.verifier=null; next.entryEvidence=null; }
  else {if(!previous)throw new Error('Record not found'); next={...previous}; delete next.version;
   if(action==='verify'){next.status='Verified';next.verifier=args.verifier;}
   if(action==='approve'){attestation(args.approval,'approval');if(args.approval.workerId!=='mason')throw new Error('Mason approval role required');next.masonApproval={...args.approval,principalId:principal,approvedVersion:previous.version};}
   if(action==='approve_allowance'){attestation(args.approval,'approval');if(args.approval.workerId!=='mason')throw new Error('Mason approval role required');refs(args.daleApproval?.evidenceRefs,'daleApproval.evidenceRefs'); next.masonApproval={...args.approval,principalId:principal,approvedVersion:previous.version};next.daleApproval={evidenceRefs:args.daleApproval.evidenceRefs,attestation:'Orchestrator attests that these references contain Dale approval; Dale has not independently authenticated to this endpoint.'};}
   if(action==='mark_entered'){refs(args.entryEvidence,'entryEvidence');next.basisStatus=previous.status;next.status='Entered';next.entryEvidence=args.entryEvidence;next.entryMeaning='Orchestrator-attested external entry receipt only; this action does not write to the live estimator.';}
  }
  validateTransition(previous,next,action); await roleExists(env,projectId,next.producer.workerId);if(next.verifier)await roleExists(env,projectId,next.verifier.workerId);
 }
 next.attestedBy=principal;next.attestationType='TRUSTED_ORCHESTRATOR_ASSERTION';
 return commit(env,projectId,recordId,args.expectedVersion,next,action,principal,assignment);
}
