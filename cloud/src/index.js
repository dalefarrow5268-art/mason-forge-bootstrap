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
      VALUES (?, ?, 'AWAITING INTAKE', ?, ?, ?)`).bind(projectId, body.name.trim(), JSON.stringify(body), timestamp, timestamp),
    env.DB.prepare(`INSERT INTO project_risk_profiles
      (project_id, overall_score, created_at, updated_at) VALUES (?, 100, ?, ?)`).bind(projectId, timestamp, timestamp),
    env.DB.prepare(`INSERT INTO project_outcome_ledgers
      (project_id, created_at, updated_at) VALUES (?, ?, ?)`).bind(projectId, timestamp, timestamp),
  ]);

  const employeeRows = await env.DB.prepare("SELECT id, department, job_description_json FROM ai_employees").all();
  const tasks = (employeeRows.results || []).map((employee, sequence) => {
    const taskId = id("task");
    return {
      taskId,
      message: { kind: "DEPARTMENT_TASK", taskId, projectId, employeeId: employee.id, department: employee.department },
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
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'BLOCKED') AS blocked_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'COMPLETED') AS completed_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'FAILED') AS failed_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id = p.id AND t.status = 'CANCELED') AS canceled_tasks
    FROM projects p
    ORDER BY p.updated_at DESC
  `).all();
  return json({ projects: result.results || [] });
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
  return json({ project, identity, risk, tasks: tasks.results || [], findings: findings.results || [], rfis: rfis.results || [], takeoffSummary: takeoff.results || [] });
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
  const upload = await env.PROJECT_FILES.createMultipartUpload(r2Key, {
    httpMetadata: { contentType: body.fileType || "application/octet-stream" },
    customMetadata: { projectId: String(projectId), fileId },
  });
  return json({ fileId, r2Key, uploadId: upload.uploadId, multipart: true }, 201);
}

async function health(env) {
  const [projects, files, outputs, continuity, taskRows, projectRows, extraction, stale, completedWithoutOutput, duplicateOutputTasks, sampleFiles] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM projects").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_files").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM department_outputs").first(),
    env.DB.prepare("SELECT checkpoint_id, version, verification_status, updated_at FROM continuity_heads WHERE scope_type='system' AND scope_id='mason-forge'").first(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks GROUP BY status ORDER BY status").all(),
    env.DB.prepare(`SELECT p.id, p.name,
      (SELECT COUNT(*) FROM project_files f WHERE f.project_id=p.id) file_count,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='QUEUED') queued_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='RUNNING') running_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='BLOCKED') blocked_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='COMPLETED') completed_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='FAILED') failed_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='CANCELED') canceled_tasks
      FROM projects p ORDER BY p.id`).all(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN extracted_text_key IS NOT NULL THEN 1 ELSE 0 END) extracted,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION QUEUED' THEN 1 ELSE 0 END) queued,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status='EXTRACTION RETRYING' THEN 1 ELSE 0 END) retrying,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE 'EXTRACTION FAILED:%' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status NOT IN ('EXTRACTION QUEUED','EXTRACTION RETRYING') AND review_status NOT LIKE 'EXTRACTION FAILED:%' THEN 1 ELSE 0 END) pending
      FROM project_files`).first(),
    env.DB.prepare(`SELECT COUNT(*) count FROM department_tasks WHERE status='RUNNING'
      AND heartbeat_at IS NOT NULL AND datetime(heartbeat_at) < datetime('now','-45 minutes')`).first(),
    env.DB.prepare(`SELECT COUNT(*) count FROM department_tasks t
      WHERE t.status='COMPLETED' AND NOT EXISTS (SELECT 1 FROM department_outputs o WHERE o.task_id=t.id)`).first(),
    env.DB.prepare(`SELECT COUNT(*) count FROM (SELECT task_id FROM department_outputs GROUP BY task_id HAVING COUNT(*) > 1)`).first(),
    env.DB.prepare("SELECT id, project_id, r2_key FROM project_files ORDER BY project_id, id LIMIT 3").all(),
  ]);

  const taskTotals = Object.fromEntries((taskRows.results || []).map((row) => [row.status, Number(row.count || 0)]));
  const totalTasks = Object.values(taskTotals).reduce((sum, value) => sum + Number(value || 0), 0);
  const projectSummary = (projectRows.results || []).map((row) => ({
    ...row,
    file_count: Number(row.file_count || 0),
    queued_tasks: Number(row.queued_tasks || 0),
    running_tasks: Number(row.running_tasks || 0),
    blocked_tasks: Number(row.blocked_tasks || 0),
    completed_tasks: Number(row.completed_tasks || 0),
    failed_tasks: Number(row.failed_tasks || 0),
    canceled_tasks: Number(row.canceled_tasks || 0),
  }));
  const projectFileTotal = projectSummary.reduce((sum, row) => sum + row.file_count, 0);
  const projectTaskTotal = projectSummary.reduce((sum, row) => sum + row.queued_tasks + row.running_tasks + row.blocked_tasks + row.completed_tasks + row.failed_tasks + row.canceled_tasks, 0);
  const extractionSummary = {
    extracted: Number(extraction?.extracted || 0),
    queued: Number(extraction?.queued || 0),
    retrying: Number(extraction?.retrying || 0),
    failed: Number(extraction?.failed || 0),
    pending: Number(extraction?.pending || 0),
  };
  const extractionTotal = Object.values(extractionSummary).reduce((sum, value) => sum + value, 0);

  const r2Samples = [];
  for (const file of sampleFiles.results || []) {
    const object = await env.PROJECT_FILES.head(file.r2_key);
    r2Samples.push({ fileId: file.id, projectId: file.project_id, present: Boolean(object) });
  }
  const r2Ready = r2Samples.length === 0 || r2Samples.every((sample) => sample.present);
  const countsReconcile = totalTasks === projectTaskTotal && Number(files?.count || 0) === projectFileTotal && Number(files?.count || 0) === extractionTotal;
  const extractionOperating = Number(files?.count || 0) === 0 || extractionSummary.extracted > 0 || extractionSummary.queued > 0 || extractionSummary.retrying > 0;
  const operationalReady = Boolean(
    env.OPENAI_API_KEY && continuity?.verification_status === "VERIFIED" &&
    totalTasks > 0 && Number(outputs?.count || 0) > 0 &&
    Number(taskTotals.BLOCKED || 0) === 0 && Number(taskTotals.FAILED || 0) === 0 &&
    Number(stale?.count || 0) === 0 && Number(completedWithoutOutput?.count || 0) === 0 &&
    Number(duplicateOutputTasks?.count || 0) === 0 && countsReconcile && r2Ready && extractionOperating
  );

  return json({
    status: operationalReady ? "online" : "degraded",
    operationalReady,
    service: env.SYSTEM_NAME || "Mason Forge Cloud",
    environment: env.ENVIRONMENT || "unknown",
    releaseId: env.RELEASE_ID || "unknown",
    database: "D1 VERIFIED",
    projectFileStorage: r2Ready ? "R2 VERIFIED" : "R2 DEGRADED",
    departmentQueue: Number(outputs?.count || 0) > 0 ? "QUEUE VERIFIED BY COMPLETED OUTPUTS" : "QUEUE UNVERIFIED",
    openai: env.OPENAI_API_KEY ? "CONFIGURED" : "NOT CONFIGURED",
    projects: Number(projects?.count || 0),
    files: Number(files?.count || 0),
    taskTotals,
    totalTasks,
    outputCount: Number(outputs?.count || 0),
    continuity: continuity || null,
    extraction: extractionSummary,
    staleRunningTasks: Number(stale?.count || 0),
    completedTasksWithoutOutput: Number(completedWithoutOutput?.count || 0),
    duplicateOutputTasks: Number(duplicateOutputTasks?.count || 0),
    countsReconcile,
    projectFileTotal,
    projectTaskTotal,
    r2Samples,
    projectsDetail: projectSummary,
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
