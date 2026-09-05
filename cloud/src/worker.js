import {processSheetRouting,processSheetRoutingFallback} from './plan-layer-handoff.js';
import {queueTakeoffCrew,processTakeoffWorker} from './takeoff-crew.js';
import { routePendingBrainFiles } from "./brain-lobe-router.js";
import {queueHoldingScan,processHoldingScan,releaseCompletedPlanPages,trialNativePageScan,benchmarkA21NativePage} from './holding-brain-scan.js';
import {intakeProgress} from './intake-progress.js';
import {queuePhaseIntake,processPhaseIntake} from './phase-intake.js';
import { queuePhaseSeven, processPhaseSeven } from './phase-seven-reports.js';
import { queueCompletionPhases, processCompletionPhase } from './project-phase-pipeline.js';
import { queuePhaseSix, processPhaseSix } from './phase-six-brain.js';
import { queuePhaseFive, processPhaseFive } from './phase-five-review.js';
import { queuePhaseFour, processPhaseFour } from './phase-four-review.js';
import { queuePhaseThree, processPhaseThree } from './phase-three-review.js';
import { queuePhaseTwo, processPhaseTwo } from './phase-two-review.js';
import { queuePhaseOne, processPhaseOne } from './phase-one-review.js';
import foundation from "./index.js";
import { failDepartmentTask, processDepartmentTask } from "./department-processor.js";
import {
  extractProjectFile,
  isPermanentExtractionError,
  markExtractionFailure,
} from "./document-extractor.js";
import { routeReadyEvidenceBatches } from "./evidence-task-router.js";
import { listContinuityScopes, readContinuity, writeContinuity } from "./continuity-ledger.js";
import { connectorResponse } from "./connector.js";
import { operationsRoute } from "./operations.js";
import { ensureRuntimeSchema } from "./ensure-schema.js";

const now = () => new Date().toISOString();

function authorized(request, env) {
  if (!env.MASON_API_TOKEN) return false;
  return (request.headers.get("authorization") || "") === `Bearer ${env.MASON_API_TOKEN}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function continuityRoute(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/continuity")) return null;
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
  if (url.pathname === "/api/continuity" && request.method === "GET") return listContinuityScopes(env);
  const match = url.pathname.match(/^\/api\/continuity\/([^/]+)\/([^/]+)$/);
  if (!match) return json({ error: "Not found." }, 404);
  const scopeType = decodeURIComponent(match[1]);
  const scopeId = decodeURIComponent(match[2]);
  if (request.method === "GET") return readContinuity(scopeType, scopeId, env);
  if (request.method === "POST" || request.method === "PUT") return writeContinuity(request, scopeType, scopeId, env);
  return json({ error: "Method not allowed." }, 405);
}

async function recoverLegacyBlockedTasks(env) {
  const blocked = await env.DB.prepare(`
    SELECT id, project_id, employee_id, department
    FROM department_tasks
    WHERE status = 'BLOCKED'
      AND (
        blocked_reason IS NULL
        OR upper(blocked_reason) LIKE '%PROCESSOR%NOT%DEPLOYED%'
        OR upper(blocked_reason) LIKE '%SPECIALIZED PROCESSOR%'
      )
    ORDER BY priority DESC, created_at
    LIMIT 100
  `).all();

  let recovered = 0;
  for (const task of blocked.results || []) {
    const update = await env.DB.prepare(`
      UPDATE department_tasks
      SET status='QUEUED', blocked_reason=NULL, updated_at=?
      WHERE id=? AND status='BLOCKED'
    `).bind(now(), task.id).run();
    if (Number(update.meta?.changes || 0) > 0) {
      recovered += 1;
      await env.DEPARTMENT_QUEUE.send({
        kind: "DEPARTMENT_TASK",
        taskId: task.id,
        projectId: task.project_id,
        employeeId: task.employee_id,
        department: task.department,
      });
    }
  }
  return recovered;
}

async function recoverStaleDepartmentTasks(env) {
  const stale = await env.DB.prepare(`
    SELECT id, project_id, employee_id, department
    FROM department_tasks
    WHERE status = 'RUNNING'
      AND datetime(COALESCE(heartbeat_at, updated_at)) < datetime('now', '-20 minutes')
    ORDER BY priority DESC, updated_at
    LIMIT 100
  `).all();

  let recovered = 0;
  for (const task of stale.results || []) {
    const update = await env.DB.prepare(`
      UPDATE department_tasks
      SET status='QUEUED', blocked_reason='STALE HEARTBEAT RECOVERY', progress_percent=0, updated_at=?
      WHERE id=? AND status='RUNNING'
        AND datetime(COALESCE(heartbeat_at, updated_at)) < datetime('now', '-20 minutes')
    `).bind(now(), task.id).run();
    if (Number(update.meta?.changes || 0) > 0) {
      recovered += 1;
      await env.DEPARTMENT_QUEUE.send({
        kind: "DEPARTMENT_TASK",
        taskId: task.id,
        projectId: task.project_id,
        employeeId: task.employee_id,
        department: task.department,
      });
    }
  }
  return recovered;
}

async function queuePendingDocumentExtractions(env) {
  const files = await env.DB.prepare(`
    SELECT id, project_id, review_status, updated_at
    FROM project_files
    WHERE extracted_text_key IS NULL
      AND relative_path NOT LIKE 'SSX Project Holding Folder/Phase One Project Review/%'
      AND review_status NOT LIKE 'EXTRACTION FAILED:%'
      AND review_status NOT LIKE '%REVIEW REQUIRED:%'
      AND (
        review_status NOT IN ('EXTRACTION QUEUED','EXTRACTION RETRYING','EXTRACTING')
        OR (
          review_status IN ('EXTRACTION QUEUED','EXTRACTION RETRYING','EXTRACTING')
          AND datetime(updated_at) < datetime('now', '-20 minutes')
        )
      )
      AND lower(file_name) GLOB '*.*'
    ORDER BY project_id, uploaded_at, id
    LIMIT 25
  `).all();

  let queued = 0;
  for (const file of files.results || []) {
    const update = await env.DB.prepare(`
      UPDATE project_files
      SET review_status='EXTRACTION QUEUED', updated_at=?
      WHERE id=?
        AND extracted_text_key IS NULL
        AND review_status=?
        AND updated_at=?
    `).bind(now(), file.id, file.review_status, file.updated_at).run();
    if (Number(update.meta?.changes || 0) > 0) {
      queued += 1;
      await env.DEPARTMENT_QUEUE.send({
        kind: "EXTRACT_PROJECT_FILE",
        fileId: file.id,
        projectId: file.project_id,
      });
    }
  }
  return queued;
}

async function routeReadyProjects(env) {
  const projects = await env.DB.prepare(`
    SELECT DISTINCT f.project_id
    FROM project_files f
    LEFT JOIN evidence_batch_files routed ON routed.file_id = f.id
    WHERE f.extracted_text_key IS NOT NULL
      AND routed.file_id IS NULL
    ORDER BY f.project_id
    LIMIT 10
  `).all();

  let batchesCreated = 0;
  let tasksQueued = 0;
  for (const row of projects.results || []) {
    const result = await routeReadyEvidenceBatches(Number(row.project_id), env);
    batchesCreated += Number(result.batchesCreated || 0);
    tasksQueued += Number(result.tasksQueued || 0);
  }
  return { batchesCreated, tasksQueued };
}

async function kickOperations(env) {
  const [legacyRecovered, staleRecovered, queuedExtractions] = await Promise.all([
    recoverLegacyBlockedTasks(env),
    recoverStaleDepartmentTasks(env),
    queuePendingDocumentExtractions(env),
  ]);
  const routedEvidence = await routeReadyProjects(env);
  return { legacyRecovered, staleRecovered, queuedExtractions, routedEvidence };
}

async function readOperationalState(env) {
  const [projectCount, fileRows, outputs, taskRows, staleTasks, staleFiles, latestActivity] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) count FROM projects").first(),
    env.DB.prepare(`
      SELECT
        COUNT(*) total,
        SUM(CASE WHEN extracted_text_key IS NOT NULL THEN 1 ELSE 0 END) extracted,
        SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION QUEUED' THEN 1 ELSE 0 END) queued,
        SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTING' THEN 1 ELSE 0 END) extracting,
        SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION RETRYING' THEN 1 ELSE 0 END) retrying,
        SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE 'EXTRACTION FAILED:%' THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE '%REVIEW REQUIRED:%' THEN 1 ELSE 0 END) routed_review,
        SUM(CASE WHEN extracted_text_key IS NULL
          AND review_status NOT LIKE 'EXTRACTION FAILED:%'
          AND review_status NOT LIKE '%REVIEW REQUIRED:%'
          AND review_status NOT IN ('EXTRACTION QUEUED','EXTRACTING','EXTRACTION RETRYING') THEN 1 ELSE 0 END) pending
      FROM project_files
    `).first(),
    env.DB.prepare("SELECT COUNT(*) count, MAX(created_at) latest_at FROM department_outputs").first(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks GROUP BY status ORDER BY status").all(),
    env.DB.prepare(`
      SELECT COUNT(*) count FROM department_tasks
      WHERE status='RUNNING'
        AND datetime(COALESCE(heartbeat_at, updated_at)) < datetime('now', '-20 minutes')
    `).first(),
    env.DB.prepare(`
      SELECT COUNT(*) count FROM project_files
      WHERE extracted_text_key IS NULL
        AND review_status IN ('EXTRACTION QUEUED','EXTRACTING','EXTRACTION RETRYING')
        AND datetime(updated_at) < datetime('now', '-20 minutes')
    `).first(),
    env.DB.prepare(`
      SELECT MAX(activity_at) latest_at FROM (
        SELECT MAX(updated_at) activity_at FROM department_tasks
        UNION ALL SELECT MAX(updated_at) FROM project_files
        UNION ALL SELECT MAX(created_at) FROM department_outputs
      )
    `).first(),
  ]);

  const taskTotals = Object.fromEntries((taskRows.results || []).map((row) => [row.status, Number(row.count || 0)]));
  const extraction = {
    total: Number(fileRows?.total || 0),
    extracted: Number(fileRows?.extracted || 0),
    queued: Number(fileRows?.queued || 0),
    extracting: Number(fileRows?.extracting || 0),
    retrying: Number(fileRows?.retrying || 0),
    failed: Number(fileRows?.failed || 0),
    routedReview: Number(fileRows?.routed_review || 0),
    pending: Number(fileRows?.pending || 0),
  };
  extraction.accounted = extraction.extracted + extraction.queued + extraction.extracting + extraction.retrying
    + extraction.failed + extraction.routedReview + extraction.pending;

  return {
    system: "Mason Forge Cloud",
    deployment: "LIVE",
    releaseId: env.RELEASE_ID || "unknown",
    projects: Number(projectCount?.count || 0),
    files: extraction.total,
    extraction,
    taskTotals,
    outputCount: Number(outputs?.count || 0),
    latestOutputAt: outputs?.latest_at || null,
    latestActivityAt: latestActivity?.latest_at || null,
    staleRunningTasks: Number(staleTasks?.count || 0),
    staleExtractionJobs: Number(staleFiles?.count || 0),
    evidenceRule: "Active work requires RUNNING task evidence or completed department outputs.",
  };
}

async function ensureSystemContinuity(env) {
  const [existing, state] = await Promise.all([
    env.DB.prepare("SELECT state_json FROM continuity_heads WHERE scope_type='system' AND scope_id='mason-forge'").first(),
    readOperationalState(env),
  ]);
  if (existing?.state_json === JSON.stringify(state)) return false;

  const taskTotals = state.taskTotals;
  const request = new Request("https://mason-forge.local/api/continuity/system/mason-forge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      summary: `Mason Forge live state: ${state.projects} projects, ${state.files} files, ${taskTotals.RUNNING || 0} running, ${taskTotals.QUEUED || 0} queued, ${taskTotals.COMPLETED || 0} completed, ${state.outputCount} outputs, ${state.extraction.extracted} files extracted.`,
      state,
      actor: "MASON FORGE CLOUD",
      source: "LIVE D1 VERIFIED STATE",
      verificationStatus: "VERIFIED",
      facts: [
        { key: "deployment", value: state.deployment, confidence: "VERIFIED" },
        { key: "release_id", value: state.releaseId, confidence: "VERIFIED" },
        { key: "project_count", value: state.projects, confidence: "VERIFIED" },
        { key: "file_count", value: state.files, confidence: "VERIFIED" },
        { key: "extraction", value: state.extraction, confidence: "VERIFIED" },
        { key: "task_totals", value: state.taskTotals, confidence: "VERIFIED" },
        { key: "output_count", value: state.outputCount, confidence: "VERIFIED" },
      ],
    }),
  });
  try {
    await writeContinuity(request, "system", "mason-forge", env);
    return true;
  } catch (error) {
    if (String(error?.message || error).includes("UNIQUE constraint failed")) return false;
    throw error;
  }
}

export default {
  async fetch(request, env, ctx) {
    await ensureRuntimeSchema(env);
    const operations = await operationsRoute(request, env, () => kickOperations(env));
    if (operations) return operations;

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      await queuePhaseIntake(env);
    await queueHoldingScan(env);
    await releaseCompletedPlanPages(env);
    await queuePhaseOne(env);
    await queuePhaseTwo(env);
    await queuePhaseThree(env);
    await queuePhaseFour(env);
    await queuePhaseFive(env);
    await queuePhaseSix(env);
    await queuePhaseSeven(env);
    await queueCompletionPhases(env);
    await kickOperations(env);
      await ensureSystemContinuity(env);
    await intakeProgress(env);
    }
    if (url.pathname === "/api/connector/bootstrap" && request.method === "GET" && authorized(request, env)) {
      await queuePhaseIntake(env);
    await queueHoldingScan(env);
    await releaseCompletedPlanPages(env);
    await queuePhaseOne(env);
    await queuePhaseTwo(env);
    await queuePhaseThree(env);
    await queuePhaseFour(env);
    await queuePhaseFive(env);
    await queuePhaseSix(env);
    await queuePhaseSeven(env);
    await queueCompletionPhases(env);
    await kickOperations(env);
      await ensureSystemContinuity(env);
    await intakeProgress(env);
    }

    const connector = await connectorResponse(request, env);
    if (connector) return connector;
    const continuity = await continuityRoute(request, env);
    if (continuity) return continuity;
    return foundation.fetch(request, env, ctx);
  },

  async queue(batch, env) {
    await ensureRuntimeSchema(env);
    for (const message of batch.messages) {
      const body = message.body || {};
      if(body.kind==='PLAN_SHEET_ROUTE'){try{await processSheetRouting(body,env);message.ack();}catch(e){message.retry({delaySeconds:120});}continue;}
      if(body.kind==='TAKEOFF_WORKER'){try{await processTakeoffWorker(body,env);message.ack();}catch(e){console.error('Takeoff worker retry',body.id,String(e));message.retry({delaySeconds:120});}continue;}
      if(body.kind === 'HOLDING_SCAN') {
        try {await processHoldingScan(body,env);message.ack();}catch(error){console.error('Holding scan retry',body.id,String(error));message.retry({delaySeconds:120});}continue;
      }
      if(body.kind === 'PHASE_INTAKE') {
        try { await processPhaseIntake(body,env); message.ack(); }
        catch(error) { console.error('Phase intake retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PROJECT_PHASE') {
        try { await processCompletionPhase(body,env); message.ack(); }
        catch(error) { console.error('Project phase retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PHASE_SEVEN') {
        try { await processPhaseSeven(body,env); message.ack(); }
        catch(error) { console.error('Phase Seven retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PHASE_SIX') {
        try { await processPhaseSix(body,env); message.ack(); }
        catch(error) { console.error('Phase Six retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PHASE_FIVE') {
        try { await processPhaseFive(body,env); message.ack(); }
        catch(error) { console.error('Phase Five retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PHASE_FOUR') {
        try { await processPhaseFour(body,env); message.ack(); }
        catch(error) { console.error('Phase Four retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PHASE_THREE') {
        try { await processPhaseThree(body,env); message.ack(); }
        catch(error) { console.error('Phase Three retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PHASE_TWO') {
        try { await processPhaseTwo(body,env); message.ack(); }
        catch(error) { console.error('Phase Two retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if(body.kind === 'PHASE_ONE') {
        try { await processPhaseOne(body,env,Number(message.attempts||1)); message.ack(); }
        catch(error) { console.error('Phase One retry',body.id,String(error)); message.retry({delaySeconds:120}); }
        continue;
      }
      if (body.kind === "EXTRACT_PROJECT_FILE") {
        try {
          const result = await extractProjectFile(body, env);
          if (result?.busy) message.retry({ delaySeconds: 120 });
          else message.ack();
        } catch (error) {
          const terminal = isPermanentExtractionError(error) || Number(message.attempts || 1) >= 5;
          await markExtractionFailure(body, env, error, terminal);
          if (terminal) message.ack();
          else message.retry({ delaySeconds: 120 });
        }
        continue;
      }

      try {
        await processDepartmentTask(body, env);
        message.ack();
      } catch (error) {
        const result = await failDepartmentTask(body, env, error);
        if (result.retry) message.retry({ delaySeconds: 90 });
        else message.ack();
      }
    }

    await queuePhaseIntake(env);
    await queueHoldingScan(env);
    await releaseCompletedPlanPages(env);
    await queuePhaseOne(env);
    await queuePhaseTwo(env);
    await queuePhaseThree(env);
    await queuePhaseFour(env);
    await queuePhaseFive(env);
    await queuePhaseSix(env);
    await queuePhaseSeven(env);
    await queueCompletionPhases(env);
    await queueTakeoffCrew(env);
    await kickOperations(env);
    await ensureSystemContinuity(env);
    await intakeProgress(env);
  },

  async scheduled(_event, env, ctx) {
    await ensureRuntimeSchema(env);
    const brainRouting = routePendingBrainFiles(env).catch(error => console.error("Brain routing deferred", String(error?.message || error)));
    if (ctx?.waitUntil) ctx.waitUntil(brainRouting); else await brainRouting;
    await queuePhaseIntake(env);
    await queueHoldingScan(env);
    await releaseCompletedPlanPages(env);
    if(_event.cron==='*/2 * * * *')await processSheetRoutingFallback(env);
    // HTTP health self-heal has a short background lifetime; only the real cron
    // may run this bounded API benchmark.
    if(_event.cron==='*/2 * * * *')await benchmarkA21NativePage(env);
    await trialNativePageScan(env);
    await queuePhaseOne(env);
    await queuePhaseTwo(env);
    await queuePhaseThree(env);
    await queuePhaseFour(env);
    await queuePhaseFive(env);
    await queuePhaseSix(env);
    await queuePhaseSeven(env);
    await queueCompletionPhases(env);
    await queueTakeoffCrew(env);
    await kickOperations(env);
    await ensureSystemContinuity(env);
    await intakeProgress(env);
    try { await routePendingBrainFiles(env); } catch(error) { console.error("Brain routing deferred", String(error?.message || error)); }
  },
};
