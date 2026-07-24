import { writeContinuity } from "./continuity-ledger.js";

function number(value) {
  return Number(value || 0);
}

function taskTotals(rows = []) {
  return Object.fromEntries(rows.map((row) => [String(row.status), number(row.count)]));
}

export async function ensureProjectContinuity(projectId, env) {
  const [project, existing, files, tasks, outputs, findings, rfis, batches, routed] = await Promise.all([
    env.DB.prepare("SELECT id, name, project_number, location, client, status, review_status, source, updated_at FROM projects WHERE id=?").bind(projectId).first(),
    env.DB.prepare("SELECT state_json FROM continuity_heads WHERE scope_type='project' AND scope_id=?").bind(String(projectId)).first(),
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN extracted_text_key IS NOT NULL THEN 1 ELSE 0 END) extracted,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION QUEUED' THEN 1 ELSE 0 END) queued,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTING' THEN 1 ELSE 0 END) extracting,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION RETRYING' THEN 1 ELSE 0 END) retrying,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE 'EXTRACTION FAILED:%' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE '%REVIEW REQUIRED:%' THEN 1 ELSE 0 END) routed_review,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status NOT LIKE 'EXTRACTION FAILED:%'
        AND review_status NOT LIKE '%REVIEW REQUIRED:%'
        AND review_status NOT IN ('EXTRACTION QUEUED','EXTRACTING','EXTRACTION RETRYING') THEN 1 ELSE 0 END) pending
      FROM project_files WHERE project_id=?`).bind(projectId).first(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks WHERE project_id=? GROUP BY status ORDER BY status").bind(projectId).all(),
    env.DB.prepare("SELECT COUNT(*) count, MAX(created_at) latest_at FROM department_outputs WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM findings WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM rfi_register WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM evidence_batches WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM evidence_batch_files WHERE project_id=?").bind(projectId).first(),
  ]);

  if (!project) return false;
  const extraction = {
    total: number(files?.total),
    extracted: number(files?.extracted),
    queued: number(files?.queued),
    extracting: number(files?.extracting),
    retrying: number(files?.retrying),
    failed: number(files?.failed),
    routedReview: number(files?.routed_review),
    pending: number(files?.pending),
  };
  extraction.accounted = extraction.extracted + extraction.queued + extraction.extracting + extraction.retrying
    + extraction.failed + extraction.routedReview + extraction.pending;

  const state = {
    project,
    extraction,
    taskTotals: taskTotals(tasks.results || []),
    outputCount: number(outputs?.count),
    latestOutputAt: outputs?.latest_at || null,
    findingCount: number(findings?.count),
    rfiCount: number(rfis?.count),
    evidenceBatchCount: number(batches?.count),
    routedFileCount: number(routed?.count),
    evidenceRule: "Project claims require source-file evidence or completed department outputs.",
  };
  const stateJson = JSON.stringify(state);
  if (existing?.state_json === stateJson) return false;

  const tasksState = state.taskTotals;
  const request = new Request(`https://mason-forge.local/api/continuity/project/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      summary: `${project.name}: ${extraction.total} files, ${extraction.extracted} extracted, ${tasksState.RUNNING || 0} running, ${tasksState.QUEUED || 0} queued, ${tasksState.COMPLETED || 0} completed tasks, ${state.outputCount} outputs, ${state.findingCount} findings, ${state.rfiCount} RFIs.`,
      state,
      actor: "MASON FORGE CLOUD",
      source: "LIVE PROJECT D1 VERIFIED STATE",
      verificationStatus: "VERIFIED",
      facts: [
        { key: "project_identity", value: project, confidence: "VERIFIED" },
        { key: "file_extraction", value: extraction, confidence: "VERIFIED" },
        { key: "task_totals", value: state.taskTotals, confidence: "VERIFIED" },
        { key: "output_count", value: state.outputCount, confidence: "VERIFIED" },
        { key: "evidence_batches", value: { batches: state.evidenceBatchCount, routedFiles: state.routedFileCount }, confidence: "VERIFIED" },
      ],
    }),
  });

  try {
    await writeContinuity(request, "project", String(projectId), env);
    return true;
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE constraint failed")) return false;
    throw error;
  }
}

export async function ensureAllProjectContinuity(env) {
  const rows = await env.DB.prepare("SELECT id FROM projects ORDER BY id").all();
  let updated = 0;
  for (const row of rows.results || []) {
    if (await ensureProjectContinuity(Number(row.id), env)) updated += 1;
  }
  return { updated };
}
