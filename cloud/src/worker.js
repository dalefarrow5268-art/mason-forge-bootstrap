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
    WHERE status = 'BLOCKED' AND blocked_reason = 'SPECIALIZED PROCESSOR NOT YET DEPLOYED'
    ORDER BY priority DESC, created_at LIMIT 100`).all();
  for (const task of blocked.results || []) {
    const timestamp = now();
    await env.DB.prepare("UPDATE department_tasks SET status='QUEUED', blocked_reason=NULL, updated_at=? WHERE id=?")
      .bind(timestamp, task.id).run();
    await env.DEPARTMENT_QUEUE.send({ kind: "DEPARTMENT_TASK", taskId: task.id, projectId: task.project_id,
      employeeId: task.employee_id, department: task.department });
  }
  return blocked.results?.length || 0;
}

async function queuePendingDocumentExtractions(env) {
  const files = await env.DB.prepare(`SELECT id, project_id FROM project_files
    WHERE extracted_text_key IS NULL AND review_status NOT LIKE 'EXTRACTION FAILED:%'
      AND review_status NOT IN ('EXTRACTION QUEUED','EXTRACTION RETRYING')
      AND lower(file_name) GLOB '*.*' ORDER BY project_id, uploaded_at, id LIMIT 10`).all();
  for (const file of files.results || []) {
    await env.DB.prepare("UPDATE project_files SET review_status='EXTRACTION QUEUED', updated_at=? WHERE id=? AND extracted_text_key IS NULL")
      .bind(now(), file.id).run();
    await env.DEPARTMENT_QUEUE.send({ kind: "EXTRACT_PROJECT_FILE", fileId: file.id, projectId: file.project_id });
  }
  return files.results?.length || 0;
}

async function kickOperations(env) {
  const [recoveredTasks, queuedExtractions] = await Promise.all([
    recoverLegacyBlockedTasks(env),
    queuePendingDocumentExtractions(env),
  ]);
  return { recoveredTasks, queuedExtractions };
}

export default {
  async fetch(request, env, ctx) {
    await ensureRuntimeSchema(env);
    const operations = await operationsRoute(request, env, () => kickOperations(env));
    if (operations) return operations;
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
        try { await extractProjectFile(body, env); message.ack(); }
        catch (error) {
          const terminal = Number(message.attempts || 1) >= 5;
          await markExtractionFailure(body, env, error, terminal);
          if (terminal) message.ack(); else message.retry({ delaySeconds: 120 });
        }
        continue;
      }
      try { await processDepartmentTask(body, env); message.ack(); }
      catch (error) {
        const result = await failDepartmentTask(body, env, error);
        if (result.retry) message.retry({ delaySeconds: 60 }); else message.ack();
      }
    }
  },
  async scheduled(event, env, ctx) {
    await ensureRuntimeSchema(env);
    await foundation.scheduled(event, env, ctx);
    await kickOperations(env);
  },
};