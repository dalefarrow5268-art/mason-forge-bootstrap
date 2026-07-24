const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function authorized(request, env) {
  const header = request.headers.get("authorization") || "";
  return Boolean(env.MASON_API_TOKEN) && header === `Bearer ${env.MASON_API_TOKEN}`;
}

export function connectorManifest(origin) {
  return {
    schema_version: "v1",
    name_for_human: "Mason Forge",
    name_for_model: "mason_forge",
    description_for_human: "Retrieve verified Mason Forge project and continuity state.",
    description_for_model: "Use this connector before answering questions about Mason Forge or its projects. Retrieve the latest Continuity Ledger checkpoint first. Never claim work is active without task or output evidence.",
    auth: { type: "service_http", authorization_type: "bearer" },
    api: { type: "openapi", url: `${origin}/openapi.json` },
    logo_url: `${origin}/favicon.ico`,
    contact_email: "support@subsourceexchange.com",
    legal_info_url: "https://subsourceexchange.com",
  };
}

export function connectorOpenApi(origin) {
  return {
    openapi: "3.1.0",
    info: { title: "Mason Forge Connector API", version: "1.0.0" },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/connector/bootstrap": {
        get: {
          operationId: "getMasonForgeBootstrap",
          summary: "Retrieve the latest verified Mason Forge system state and project summaries",
          responses: { "200": { description: "Verified current state" } },
        },
      },
      "/api/continuity/{scopeType}/{scopeId}": {
        get: {
          operationId: "getContinuityScope",
          summary: "Retrieve the latest Continuity Ledger checkpoint for a scope",
          parameters: [
            { name: "scopeType", in: "path", required: true, schema: { type: "string" } },
            { name: "scopeId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Continuity state and checkpoint history" } },
        },
      },
      "/api/projects/{projectId}/status": {
        get: {
          operationId: "getProjectStatus",
          summary: "Retrieve project tasks, findings, RFIs, risk, and takeoff summary",
          parameters: [{ name: "projectId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Project status" } },
        },
      },
    },
  };
}

export async function connectorResponse(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/ai-plugin.json" && request.method === "GET") {
    return json(connectorManifest(url.origin));
  }
  if (url.pathname === "/openapi.json" && request.method === "GET") {
    return json(connectorOpenApi(url.origin));
  }
  if (url.pathname !== "/api/connector/bootstrap" || request.method !== "GET") return null;
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);

  const [head, projects, tasks, outputs] = await Promise.all([
    env.DB.prepare("SELECT * FROM continuity_heads WHERE scope_type = 'system' AND scope_id = 'mason-forge'").first(),
    env.DB.prepare(`SELECT p.id, p.name, p.location, p.client, p.status, p.review_status,
      COUNT(DISTINCT f.id) file_count,
      SUM(CASE WHEN t.status='RUNNING' THEN 1 ELSE 0 END) running_tasks,
      SUM(CASE WHEN t.status='QUEUED' THEN 1 ELSE 0 END) queued_tasks,
      SUM(CASE WHEN t.status='COMPLETED' THEN 1 ELSE 0 END) completed_tasks,
      SUM(CASE WHEN t.status='FAILED' THEN 1 ELSE 0 END) failed_tasks
      FROM projects p LEFT JOIN project_files f ON f.project_id=p.id
      LEFT JOIN department_tasks t ON t.project_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC`).all(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks GROUP BY status").all(),
    env.DB.prepare("SELECT COUNT(*) count FROM department_outputs").first(),
  ]);

  return json({
    retrievedAt: new Date().toISOString(),
    continuity: head ? { ...head, state: JSON.parse(head.state_json || "{}") } : null,
    projects: projects.results || [],
    taskTotals: tasks.results || [],
    outputCount: Number(outputs?.count || 0),
    evidenceRule: "Do not claim active work without RUNNING task events or completed department outputs.",
  });
}
