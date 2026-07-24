const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function authorized(request, env) {
  if (!env.MASON_API_TOKEN) return false;
  const header = request.headers.get("authorization") || "";
  return header === `Bearer ${env.MASON_API_TOKEN}`;
}

async function audit(env, actor, action, entityType, entityId, beforeValue, afterValue) {
  await env.DB.prepare(`
    INSERT INTO audit_log
      (id, actor, action, entity_type, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id("audit"), actor, action, entityType,
    entityId == null ? null : String(entityId),
    beforeValue == null ? null : JSON.stringify(beforeValue),
    afterValue == null ? null : JSON.stringify(afterValue),
    now(),
  ).run();
}

async function createProject(request, env) {
  const body = await request.json();
  if (!body.name?.trim()) return json({ error: "Project name is required." }, 400);
  const timestamp = now();
  const result = await env.DB.prepare(`
    INSERT INTO projects
      (name, project_number, location, client, status, review_status, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'INTAKE', 'NEEDS REVIEW', 'CLOUD INTAKE', ?, ?)
  `).bind(body.name.trim(), body.projectNumber || null, body.location || null, body.client || null, timestamp, timestamp).run();
  const projectId = result.meta.last_row_id;

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO project_identity_cards
      (project_id, official_name, verification_status, intake_json, created_at, updated_at)
      VALUES (?, ?, 'AWAITING INTAKE', ?, ?, ?)`)
      .bind(projectId, body.name.trim(), JSON.stringify(body), timestamp, timestamp),
    env.DB.prepare(`INSERT INTO project_risk_profiles
      (project_id, overall_score, created_at, updated_at) VALUES (?, 100, ?, ?)`)
      .bind(projectId, timestamp, timestamp),
    env.DB.prepare(`INSERT INTO project_outcome_ledgers
      (project_id, created_at, updated_at) VALUES (?, ?, ?)`)
      .bind(projectId, timestamp, timestamp),
  ]);

  const employeeRows = await env.DB.prepare("SELECT id, department, job_description_json FROM ai_employees").all();
  const tasks = employeeRows.results.map((employee, sequence) => {
    const taskId = id("task");
    return {
      taskId,
      message: { taskId, projectId, employeeId: employee.id, department: employee.department },
      statement: env.DB.prepare(`
        INSERT INTO department_tasks
          (id, project_id, employee_id, department, workstream, title, instructions,
           priority, status, source_file_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'PROJECT INTAKE', ?, ?, ?, 'QUEUED', '[]', ?, ?)
      `).bind(taskId, projectId, employee.id, employee.department,
        `${employee.department} initial project assignment`, employee.job_description_json,
        100 - sequence, timestamp, timestamp),
    };
  });

  if (tasks.length) {
    await env.DB.batch(tasks.map((task) => task.statement));
    await env.DEPARTMENT_QUEUE.sendBatch(tasks.map((task) => ({ body: task.message })));
  }

  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
  await audit(env, "MASON FORGE CLOUD", "CREATE", "project", projectId, null, project);
  return json({ project, departmentTasksQueued: tasks.length }, 201);
}

async function listProjects(env) {
  const result = await env.DB.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS file_count,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'RUNNING') AS running_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'QUEUED') AS queued_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'COMPLETED') AS completed_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'FAILED') AS failed_tasks
    FROM projects p
    ORDER BY p.updated_at DESC
  `).all();
  return json({ projects: result.results });
}

async function projectStatus(projectId, env) {
  const project = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
  if (!project) return json({ error: "Project not found." }, 404);
  const [identity, risk, tasks, findings, rfis, takeoff] = await Promise.all([
    env.DB.prepare("SELECT * FROM project_identity_cards WHERE project_id = ?").bind(projectId).first(),
    env.DB.prepare("SELECT * FROM project_risk_profiles WHERE project_id = ?").bind(projectId).first(),
    env.DB.prepare("SELECT * FROM department_tasks WHERE project_id = ? ORDER BY priority DESC, created_at").bind(projectId).all(),
    env.DB.prepare("SELECT * FROM findings WHERE project_id = ? ORDER BY severity DESC, updated_at DESC").bind(projectId).all(),
    env.DB.prepare("SELECT * FROM rfi_register WHERE project_id = ? ORDER BY created_at").bind(projectId).all(),
    env.DB.prepare("SELECT trade, COUNT(*) AS item_count, SUM(CASE WHEN quantity IS NOT NULL THEN 1 ELSE 0 END) AS measured_count FROM takeoff_items WHERE project_id = ? GROUP BY trade").bind(projectId).all(),
  ]);
  return json({ project, identity, risk, tasks: tasks.results, findings: findings.results, rfis: rfis.results, takeoffSummary: takeoff.results });
}

async function createUpload(request, projectId, env) {
  const body = await request.json();
  if (!body.fileName || !Number.isFinite(Number(body.sizeBytes))) {
    return json({ error: "fileName and sizeBytes are required." }, 400);
  }
  const fileId = id("file");
  const safeName = body.fileName.replace(/[^a-zA-Z0-9._ -]/g, "_");
  const r2Key = `projects/${projectId}/source/${fileId}/${safeName}`;
  const timestamp = now();
  await env.DB.prepare(`
    INSERT INTO project_files
      (project_id, r2_key, file_name, relative_path, file_type, size_bytes, sha256,
       revision, document_date, review_status, uploaded_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOAD PENDING', ?, ?)
  `).bind(projectId, r2Key, safeName, body.relativePath || safeName, body.fileType || null,
    Number(body.sizeBytes), body.sha256 || null, body.revision || null, body.documentDate || null,
    timestamp, timestamp).run();
  const url = await env.PROJECT_FILES.createMultipartUpload(r2Key, {
    httpMetadata: { contentType: body.fileType || "application/octet-stream" },
    customMetadata: { projectId: String(projectId), fileId },
  });
  return json({ fileId, r2Key, uploadId: url.uploadId, multipart: true }, 201);
}

async function health(env) {
  const [projects, files, outputs, continuity, taskRows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM projects").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_files").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM department_outputs").first(),
    env.DB.prepare("SELECT checkpoint_id, version, verification_status, updated_at FROM continuity_heads WHERE scope_type='system' AND scope_id='mason-forge'").first(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks GROUP BY status").all(),
  ]);
  const taskTotals = Object.fromEntries((taskRows.results || []).map((row) => [row.status, Number(row.count || 0)]));
  const totalTasks = Object.values(taskTotals).reduce((sum, value) => sum + Number(value || 0), 0);
  const operationalReady = Boolean(
    env.OPENAI_API_KEY && continuity && continuity.verification_status === "VERIFIED" &&
    totalTasks > 0 && Number(outputs?.count || 0) > 0
  );
  return json({
    status: operationalReady ? "online" : "degraded",
    operationalReady,
    service: env.SYSTEM_NAME || "Mason Forge Cloud",
    environment: env.ENVIRONMENT || "unknown",
    database: "D1",
    projectFileStorage: "R2",
    departmentQueue: "Cloudflare Queues",
    openai: env.OPENAI_API_KEY ? "CONFIGURED" : "NOT CONFIGURED",
    projects: Number(projects?.count || 0),
    files: Number(files?.count || 0),
    taskTotals,
    totalTasks,
    outputCount: Number(outputs?.count || 0),
    continuity: continuity || null,
    checkedAt: now(),
  }, operationalReady ? 200 : 503);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return health(env);
    if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
    if (url.pathname === "/api/projects" && request.method === "GET") return listProjects(env);
    if (url.pathname === "/api/projects" && request.method === "POST") return createProject(request, env);
    const statusMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/status$/);
    if (statusMatch && request.method === "GET") return projectStatus(Number(statusMatch[1]), env);
    const uploadMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/files\/multipart$/);
    if (uploadMatch && request.method === "POST") return createUpload(request, Number(uploadMatch[1]), env);
    return json({ error: "Not found." }, 404);
  },
  async queue() {},
  async scheduled() {},
};