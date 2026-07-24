const now = () => new Date().toISOString();

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function authorized(request, env) {
  return Boolean(env.MASON_API_TOKEN) &&
    (request.headers.get("authorization") || "") === `Bearer ${env.MASON_API_TOKEN}`;
}

export async function operationalHealth(env) {
  const continuityQuery = env.DB.prepare("SELECT COUNT(*) AS count FROM continuity_heads").first();
  const [projects, files, extracted, outputs, tasks, continuity] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM projects").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_files").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM project_files WHERE extracted_text_key IS NOT NULL").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM department_outputs").first(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN status='QUEUED' THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) AS running,
      SUM(CASE WHEN status='BLOCKED' THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed
      FROM department_tasks`).first(),
    continuityQuery.catch(() => ({ count: 0 })),
  ]);

  return json({
    status: "online",
    service: env.SYSTEM_NAME || "Mason Forge Cloud",
    environment: env.ENVIRONMENT || "unknown",
    release: env.RELEASE_ID || "unversioned",
    capabilities: {
      database: "D1",
      projectFileStorage: "R2",
      departmentQueue: "Cloudflare Queues",
      openai: env.OPENAI_API_KEY ? "CONFIGURED" : "NOT CONFIGURED",
      documentExtraction: "ENABLED",
      departmentProcessing: "ENABLED",
      continuityLedger: "ENABLED",
    },
    counts: {
      projects: Number(projects?.count || 0),
      projectFiles: Number(files?.count || 0),
      extractedFiles: Number(extracted?.count || 0),
      departmentOutputs: Number(outputs?.count || 0),
      continuityScopes: Number(continuity?.count || 0),
      tasks: {
        queued: Number(tasks?.queued || 0),
        running: Number(tasks?.running || 0),
        blocked: Number(tasks?.blocked || 0),
        completed: Number(tasks?.completed || 0),
        failed: Number(tasks?.failed || 0),
      },
    },
    executionProven: Number(outputs?.count || 0) > 0 && Number(tasks?.completed || 0) > 0,
    checkedAt: now(),
  });
}

export async function operationsRoute(request, env, kick) {
  const url = new URL(request.url);
  if (url.pathname === "/health" && request.method === "GET") {
    return operationalHealth(env);
  }
  if (url.pathname !== "/api/admin/operations/kick") return null;
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const result = await kick();
  return json({
    status: "accepted",
    message: "Recovery and extraction work was queued.",
    ...result,
    acceptedAt: now(),
  }, 202);
}
