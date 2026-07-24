import foundation from "./index.js";
import { failDepartmentTask, processDepartmentTask } from "./department-processor.js";
import { extractProjectFile, markExtractionFailure } from "./document-extractor.js";
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
  const blocked = await env.DB.prepare(`SELECT id, project_id, employee_id, department FROM department_tasks
    WHERE status = 'BLOCKED'
      AND (blocked_reason IS NULL OR blocked_reason = 'SPECIALIZED PROCESSOR NOT YET DEPLOYED'
        OR blocked_reason = 'STALE HEARTBEAT RECOVERY')
    ORDER BY priority DESC, created_at LIMIT 100`).all();
  let recovered = 0;
  for (const task of blocked.results || []) {
    const update = await env.DB.prepare(
      `UPDATE department_tasks SET status='QUEUED', blocked_reason=NULL, updated_at=?
       WHERE id=? AND status='BLOCKED'
         AND (blocked_reason IS NULL OR blocked_reason = 'SPECIALIZED PROCESSOR NOT YET DEPLOYED'
           OR blocked_reason = 'STALE HEARTBEAT RECOVERY')`
    ).bind(now(), task.id).run();
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

async function recoverStaleRunningTasks(env) {
  const stale = await env.DB.prepare(`SELECT id, project_id, employee_id, department FROM department_tasks
    WHERE status = 'RUNNING'
      AND heartbeat_at IS NOT NULL
      AND datetime(heartbeat_at) < datetime('now', '-45 minutes')
    ORDER BY priority DESC, updated_at LIMIT 100`).all();
  let recovered = 0;
  for (const task of stale.results || []) {
    const update = await env.DB.prepare(`
      UPDATE department_tasks
      SET status='QUEUED', blocked_reason='STALE HEARTBEAT RECOVERY', progress_percent=0, updated_at=?
      WHERE id=? AND status='RUNNING' AND datetime(heartbeat_at) < datetime('now', '-45 minutes')
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
  const files = await env.DB.prepare(`SELECT id, project_id FROM project_files
    WHERE extracted_text_key IS NULL
      AND review_status NOT LIKE 'EXTRACTION FAILED:%'
      AND review_status NOT IN ('EXTRACTION QUEUED','EXTRACTION RETRYING')
      AND lower(file_name) GLOB '*.*'
    ORDER BY project_id, uploaded_at, id LIMIT 25`).all();
  let queued = 0;
  for (const file of files.results || []) {
    const update = await env.DB.prepare(`
      UPDATE project_files SET review_status='EXTRACTION QUEUED', updated_at=?
      WHERE id=? AND extracted_text_key IS NULL
        AND review_status NOT LIKE 'EXTRACTION FAILED:%'
        AND review_status NOT IN ('EXTRACTION QUEUED','EXTRACTION RETRYING')
    `).bind(now(), file.id).run();
    if (Number(update.meta?.changes || 0) > 0) {
      queued += 1;
      await env.DEPARTMENT_QUEUE.send({ kind: "EXTRACT_PROJECT_FILE", fileId: file.id, projectId: file.project_id });
    }
  }
  return queued;
}

async function kickOperations(env) {
  const [recoveredBlockedTasks, recoveredStaleTasks, queuedExtractions] = await Promise.all([
    recoverLegacyBlockedTasks(env),
    recoverStaleRunningTasks(env),
    queuePendingDocumentExtractions(env),
  ]);
  return { recoveredBlockedTasks, recoveredStaleTasks, queuedExtractions };
}

async function ensureSystemContinuity(env) {
  const [existing, projectCount, fileCount, outputs, taskRows, extraction] = await Promise.all([
    env.DB.prepare("SELECT state_json FROM continuity_heads WHERE scope_type='system' AND scope_id='mason-forge'").first(),
    env.DB.prepare("SELECT COUNT(*) count FROM projects").first(),
    env.DB.prepare("SELECT COUNT(*) count FROM project_files").first(),
    env.DB.prepare("SELECT COUNT(*) count FROM department_outputs").first(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks GROUP BY status ORDER BY status").all(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN extracted_text_key IS NOT NULL THEN 1 ELSE 0 END) extracted,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION QUEUED' THEN 1 ELSE 0 END) queued,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION RETRYING' THEN 1 ELSE 0 END) retrying,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE 'EXTRACTION FAILED:%' THEN 1 ELSE 0 END) failed
      FROM project_files`).first(),
  ]);
  const taskTotals = Object.fromEntries((taskRows.results || []).map((row) => [row.status, Number(row.count || 0)]));
  const state = {
    system: "Mason Forge Cloud",
    deployment: "LIVE",
    projects: Number(projectCount?.count || 0),
    files: Number(fileCount?.count || 0),
    taskTotals,
    outputCount: Number(outputs?.count || 0),
    extraction: {
      extracted: Number(extraction?.extracted || 0),
      queued: Number(extraction?.queued || 0),
      retrying: Number(extraction?.retrying || 0),
      failed: Number(extraction?.failed || 0),
    },
    evidenceRule: "Active work requires RUNNING task evidence or completed department outputs.",
  };
  if (existing?.state_json === JSON.stringify(state)) return false;
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
        { key: "project_count", value: state.projects, confidence: "VERIFIED" },
        { key: "file_count", value: state.files, confidence: "VERIFIED" },
        { key: "task_totals", value: state.taskTotals, confidence: "VERIFIED" },
        { key: "output_count", value: state.outputCount, confidence: "VERIFIED" },
        { key: "extraction", value: state.extraction, confidence: "VERIFIED" },
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
      await ensureSystemContinuity(env);
    }
    if (url.pathname === "/api/connector/bootstrap" && request.method === "GET" && authorized(request, env)) {
      await kickOperations(env);
      await ensureSystemContinuity(env);
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
      if (body.kind === "EXTRACT_PROJECT_FILE") {
        try {
          await extractProjectFile(body, env);
          message.ack();
        } catch (error) {
          const terminal = Number(message.attempts || 1) >= 5;
          await markExtractionFailure(body, env, error, terminal);
          if (terminal) message.ack(); else message.retry({ delaySeconds: 120 });
        }
        continue;
      }
      try {
        await processDepartmentTask(body, env);
        message.ack();
      } catch (error) {
        const result = await failDepartmentTask(body, env, error);
        if (result.retry) message.retry({ delaySeconds: 60 }); else message.ack();
      }
    }
    await ensureSystemContinuity(env);
  },
  async scheduled(_event, env) {
    await ensureRuntimeSchema(env);
    await kickOperations(env);
    await ensureSystemContinuity(env);
  },
};
