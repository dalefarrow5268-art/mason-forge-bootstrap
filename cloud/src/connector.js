import { handleBrainAction } from "./brain-records.js";
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function authorized(request, env) {
  const header = request.headers.get("authorization") || "";
  return Boolean(env.MASON_API_TOKEN) && header === `Bearer ${env.MASON_API_TOKEN}`;
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function decodeRows(rows, fields) {
  return (rows || []).map((row) => {
    const result = { ...row };
    for (const field of fields) result[field] = parseJson(result[field], field.endsWith("_json") ? [] : null);
    return result;
  });
}

const projectParameters = [{ name: "projectId", in: "path", required: true, schema: { type: "integer" } }];
const fileParameters = [
  ...projectParameters,
  { name: "fileId", in: "path", required: true, schema: { type: "integer" } },
];

export function connectorManifest(origin) {
  return {
    schema_version: "v1",
    name_for_human: "Mason Forge",
    name_for_model: "mason_forge",
    description_for_human: "Retrieve verified Mason Forge project files, extracted evidence, department work, findings, RFIs, contacts, and continuity.",
    description_for_model: "Use this connector before answering questions about Mason Forge projects. Retrieve continuity and evidence first. Never claim work is active without task events or completed outputs.",
    auth: { type: "service_http", authorization_type: "bearer" },
    api: { type: "openapi", url: `${origin}/openapi.json` },
    logo_url: `${origin}/favicon.ico`,
    contact_email: "support@subsourceexchange.com",
    legal_info_url: "https://subsourceexchange.com",
  };
}

export function connectorOpenApi(origin) {
  const responses = { "200": { description: "Successful response" }, "404": { description: "Not found" } };
  const get = (operationId, summary, parameters = projectParameters) => ({ get: { operationId, summary, parameters, responses } });
  return {
    openapi: "3.1.0",
    info: { title: "Mason Forge Connector API", version: "1.1.0" },
    servers: [{ url: origin }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/connector/bootstrap": get("getMasonForgeBootstrap", "Retrieve current system and project summaries", []),
      "/api/continuity/{scopeType}/{scopeId}": get("getContinuityScope", "Retrieve a Continuity Ledger scope", [
        { name: "scopeType", in: "path", required: true, schema: { type: "string" } },
        { name: "scopeId", in: "path", required: true, schema: { type: "string" } },
      ]),
      "/api/projects/{projectId}/status": get("getProjectStatus", "Retrieve complete project status"),
      "/api/projects/{projectId}/files": get("listProjectFiles", "List every registered file in a project"),
      "/api/projects/{projectId}/file-reconciliation": get("reconcileProjectFiles", "Verify database file records against R2 storage"),
      "/api/projects/{projectId}/files/{fileId}": get("getProjectFile", "Retrieve file metadata and extracted content", fileParameters),
      "/api/projects/{projectId}/files/{fileId}/source": get("downloadProjectFile", "Retrieve the original project file", fileParameters),
      "/api/projects/{projectId}/tasks": get("listProjectTasks", "Retrieve department tasks and task events"),
      "/api/projects/{projectId}/outputs": get("listProjectOutputs", "Retrieve completed department outputs"),
      "/api/projects/{projectId}/findings": get("listProjectFindings", "Retrieve project findings"),
      "/api/projects/{projectId}/evidence": get("listProjectEvidence", "Retrieve extracted evidence and evidence batches"),
      "/api/projects/{projectId}/rfis": get("listProjectRfis", "Retrieve the project RFI register"),
      "/api/projects/{projectId}/contacts": get("listProjectContacts", "Retrieve project parties and available contact records"),
      "/api/projects/{projectId}/continuity": get("getProjectContinuity", "Retrieve project continuity"),
    },
  };
}

async function requireProject(projectId, env) {
  return env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(projectId).first();
}

async function listFiles(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const result = await env.DB.prepare(`SELECT id, project_id, file_name, relative_path, file_type, size_bytes,
    sha256, revision, document_date, review_status, extracted_text_key, source_class, uploaded_at, updated_at
    FROM project_files WHERE project_id = ? ORDER BY relative_path, id`).bind(projectId).all();
  return json({ project, count: result.results?.length || 0, files: result.results || [] });
}

function normalizedFileValue(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/\/+/g, "/").toLowerCase();
}

function duplicateGroups(files, valueFor) {
  const groups = new Map();
  for (const file of files) {
    const value = valueFor(file);
    if (!value) continue;
    const rows = groups.get(value) || [];
    rows.push(file);
    groups.set(value, rows);
  }
  return [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([value, rows]) => ({ value, fileIds: rows.map((row) => Number(row.id)) }));
}

async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function reconcileFiles(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const result = await env.DB.prepare(`SELECT id, project_id, r2_key, file_name, relative_path, file_type,
    size_bytes, sha256, revision, document_date, review_status, extracted_text_key, source_class,
    uploaded_at, updated_at
    FROM project_files WHERE project_id = ? ORDER BY id`).bind(projectId).all();
  const files = result.results || [];
  const inspected = await mapConcurrent(files, 20, async (file) => {
    const [source, extraction] = await Promise.all([
      file.r2_key ? env.PROJECT_FILES.head(file.r2_key) : null,
      file.extracted_text_key ? env.PROJECT_FILES.head(file.extracted_text_key) : null,
    ]);
    return {
      ...file,
      sourcePresent: Boolean(source),
      sourceSize: source ? Number(source.size || 0) : null,
      sourceEtag: source?.etag || source?.httpEtag || null,
      extractionPresent: file.extracted_text_key ? Boolean(extraction) : null,
    };
  });

  const missingSource = inspected.filter((file) => !file.sourcePresent);
  const missingExtraction = inspected.filter((file) => file.extracted_text_key && !file.extractionPresent);
  const placeholders = inspected.filter((file) =>
    !String(file.r2_key || "").trim()
    || !String(file.file_name || "").trim()
    || !String(file.relative_path || "").trim()
    || Number(file.size_bytes || 0) <= 0
  );
  const failedUploads = inspected.filter((file) => /UPLOAD FAILED|FAILED UPLOAD/i.test(String(file.review_status || "")));
  const staleUploadPending = inspected.filter((file) =>
    /UPLOAD PENDING/i.test(String(file.review_status || ""))
    && Date.parse(file.updated_at || file.uploaded_at || "") < Date.now() - 24 * 60 * 60 * 1000
  );
  const sizeMismatches = inspected.filter((file) =>
    file.sourcePresent && Number(file.size_bytes || 0) !== Number(file.sourceSize || 0)
  );
  const duplicateR2Keys = duplicateGroups(inspected, (file) => String(file.r2_key || "").trim());
  const duplicatePaths = duplicateGroups(inspected, (file) => normalizedFileValue(file.relative_path));
  const duplicateNames = duplicateGroups(inspected, (file) => normalizedFileValue(file.file_name));
  const duplicateHashes = duplicateGroups(inspected, (file) => String(file.sha256 || "").trim().toLowerCase());
  const duplicateEtags = duplicateGroups(
    inspected.filter((file) => file.sourcePresent && file.sourceEtag),
    (file) => `${String(file.sourceEtag).replaceAll('"', "")}:${Number(file.sourceSize || 0)}`,
  );
  const invalidIds = new Set([
    ...missingSource,
    ...placeholders,
    ...failedUploads,
    ...staleUploadPending,
  ].map((file) => Number(file.id)));
  const issueRows = (rows) => rows.map((file) => ({
    fileId: Number(file.id),
    fileName: file.file_name,
    relativePath: file.relative_path,
    reviewStatus: file.review_status,
    r2Key: file.r2_key,
  }));

  return json({
    project: { id: Number(project.id), name: project.name },
    checkedAt: new Date().toISOString(),
    definitiveDatabaseCount: files.length,
    sourceObjectsPresent: inspected.length - missingSource.length,
    proposedRetainedCount: files.length - invalidIds.size,
    reconciled: missingSource.length === 0 && missingExtraction.length === 0
      && placeholders.length === 0 && failedUploads.length === 0
      && staleUploadPending.length === 0 && sizeMismatches.length === 0
      && duplicateR2Keys.length === 0 && duplicatePaths.length === 0,
    issues: {
      missingSource: issueRows(missingSource),
      missingExtraction: issueRows(missingExtraction),
      placeholders: issueRows(placeholders),
      failedUploads: issueRows(failedUploads),
      staleUploadPending: issueRows(staleUploadPending),
      sizeMismatches: sizeMismatches.map((file) => ({
        ...issueRows([file])[0],
        databaseSize: Number(file.size_bytes || 0),
        r2Size: Number(file.sourceSize || 0),
      })),
      duplicateR2Keys,
      duplicatePaths,
      duplicateNames,
      duplicateHashes,
      duplicateEtags,
    },
    cleanupCandidateFileIds: [...invalidIds].sort((a, b) => a - b),
    notes: [
      "cleanupCandidateFileIds contains only missing source objects, structural placeholders, explicit failed uploads, and upload-pending records older than 24 hours.",
      "Duplicate name and ETag groups are review candidates only and are never automatic deletion targets.",
      "An extracted-text key is verified separately from its source object.",
    ],
  });
}

async function getFile(projectId, fileId, env, source = false) {
  const file = await env.DB.prepare("SELECT * FROM project_files WHERE id = ? AND project_id = ?").bind(fileId, projectId).first();
  if (!file) return json({ error: "Project file not found." }, 404);
  if (source) {
    const object = await env.PROJECT_FILES.get(file.r2_key);
    if (!object) return json({ error: "Source object is missing from R2.", file }, 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    headers.set("cache-control", "private, no-store");
    headers.set("etag", object.httpEtag || "");
    return new Response(object.body, { headers });
  }
  let extraction = null;
  if (file.extracted_text_key) {
    const object = await env.PROJECT_FILES.get(file.extracted_text_key);
    if (object) {
      const text = await object.text();
      extraction = parseJson(text, { text });
    }
  }
  return json({ file, extraction, sourceAvailable: true, extractionAvailable: Boolean(extraction) });
}

async function listTasks(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const [tasks, events] = await Promise.all([
    env.DB.prepare("SELECT * FROM department_tasks WHERE project_id = ? ORDER BY priority DESC, created_at").bind(projectId).all(),
    env.DB.prepare("SELECT * FROM task_events WHERE project_id = ? ORDER BY created_at").bind(projectId).all(),
  ]);
  return json({ project, tasks: decodeRows(tasks.results, ["source_file_ids_json"]), events: decodeRows(events.results, ["metadata_json"]) });
}

async function listOutputs(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const outputs = await env.DB.prepare("SELECT * FROM department_outputs WHERE project_id = ? ORDER BY created_at DESC").bind(projectId).all();
  return json({ project, outputs: decodeRows(outputs.results, ["content_json", "evidence_register_json"]) });
}

async function listFindings(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const findings = await env.DB.prepare("SELECT * FROM findings WHERE project_id = ? ORDER BY severity DESC, updated_at DESC").bind(projectId).all();
  return json({ project, findings: decodeRows(findings.results, ["evidence_json"]) });
}

async function listEvidence(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const [batches, files, reviews, totals] = await Promise.all([
    env.DB.prepare("SELECT * FROM evidence_batches WHERE project_id = ? ORDER BY created_at").bind(projectId).all(),
    env.DB.prepare(`SELECT f.id, f.file_name, f.relative_path, f.file_type, f.review_status, f.extracted_text_key,
      ebf.batch_id FROM project_files f LEFT JOIN evidence_batch_files ebf ON ebf.file_id=f.id
      WHERE f.project_id=? ORDER BY f.relative_path`).bind(projectId).all(),
    env.DB.prepare(`SELECT q.*, f.file_name, f.relative_path, f.file_type
      FROM extraction_review_queue q JOIN project_files f ON f.id=q.file_id
      WHERE q.project_id=? ORDER BY q.status, q.review_type, f.relative_path`).bind(projectId).all(),
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN extracted_text_key IS NOT NULL THEN 1 ELSE 0 END) extracted,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status IN ('EXTRACTION QUEUED','EXTRACTING','EXTRACTION RETRYING') THEN 1 ELSE 0 END) processing,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE '%REVIEW REQUIRED:%' THEN 1 ELSE 0 END) routed_unreadable
      FROM project_files WHERE project_id=?`).bind(projectId).first(),
  ]);
  return json({
    project,
    extraction: {
      total: Number(totals?.total || 0),
      extracted: Number(totals?.extracted || 0),
      processing: Number(totals?.processing || 0),
      routedUnreadable: Number(totals?.routed_unreadable || 0),
      accounted: Number(totals?.extracted || 0) + Number(totals?.processing || 0) + Number(totals?.routed_unreadable || 0),
    },
    batches: batches.results || [],
    files: files.results || [],
    reviewQueue: reviews.results || [],
  });
}

async function listRfis(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const rfis = await env.DB.prepare("SELECT * FROM rfi_register WHERE project_id = ? ORDER BY created_at").bind(projectId).all();
  return json({ project, rfis: decodeRows(rfis.results, ["plan_references_json", "spec_references_json"]) });
}

async function listContacts(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const [identity, parties, contacts] = await Promise.all([
    env.DB.prepare("SELECT * FROM project_identity_cards WHERE project_id = ?").bind(projectId).first(),
    env.DB.prepare("SELECT * FROM project_risk_parties WHERE project_id = ? ORDER BY role, name").bind(projectId).all(),
    env.DB.prepare(`SELECT c.*, co.name company_name, co.domain company_domain, co.website company_website
      FROM contacts c LEFT JOIN companies co ON co.id=c.company_id ORDER BY c.name`).all(),
  ]);
  return json({
    project,
    identity: identity ? { ...identity, aliases_json: parseJson(identity.aliases_json, []), permit_numbers_json: parseJson(identity.permit_numbers_json, []), source_register_json: parseJson(identity.source_register_json, []), conflicts_json: parseJson(identity.conflicts_json, []) } : null,
    projectParties: decodeRows(parties.results, ["risk_notes_json", "evidence_json", "controls_json"]),
    contactDirectory: contacts.results || [],
    note: "The current schema does not yet include a project_contact join table; projectParties are project-specific and contactDirectory is the available master directory.",
  });
}

async function projectContinuity(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const head = await env.DB.prepare("SELECT * FROM continuity_heads WHERE scope_type='project' AND scope_id=?").bind(String(projectId)).first();
  const history = await env.DB.prepare(`SELECT id, version, summary, verification_status, source, actor,
    previous_checkpoint_id, created_at FROM continuity_checkpoints WHERE scope_type='project' AND scope_id=?
    ORDER BY version DESC LIMIT 25`).bind(String(projectId)).all();
  return json({ project, continuity: head ? { ...head, state: parseJson(head.state_json, {}) } : null, history: history.results || [] });
}

async function completeStatus(projectId, env) {
  const project = await requireProject(projectId, env);
  if (!project) return json({ error: "Project not found." }, 404);
  const [identity, risk, fileCount, tasks, outputs, findings, rfis, takeoff, parties, continuity] = await Promise.all([
    env.DB.prepare("SELECT * FROM project_identity_cards WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT * FROM project_risk_profiles WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM project_files WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks WHERE project_id=? GROUP BY status").bind(projectId).all(),
    env.DB.prepare("SELECT COUNT(*) count FROM department_outputs WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM findings WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM rfi_register WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT trade, COUNT(*) item_count FROM takeoff_items WHERE project_id=? GROUP BY trade").bind(projectId).all(),
    env.DB.prepare("SELECT COUNT(*) count FROM project_risk_parties WHERE project_id=?").bind(projectId).first(),
    env.DB.prepare("SELECT * FROM continuity_heads WHERE scope_type='project' AND scope_id=?").bind(String(projectId)).first(),
  ]);
  return json({
    project,
    identity,
    risk,
    fileCount: Number(fileCount?.count || 0),
    taskTotals: tasks.results || [],
    outputCount: Number(outputs?.count || 0),
    findingCount: Number(findings?.count || 0),
    rfiCount: Number(rfis?.count || 0),
    takeoffSummary: takeoff.results || [],
    projectBrain: await handleBrainAction(env, "list", { projectId }, {
      principalId: "authenticated-mason-connector", role: "orchestrator", authenticated: true,
    }),
    partyCount: Number(parties?.count || 0),
    continuity: continuity ? { ...continuity, state: parseJson(continuity.state_json, {}) } : null,
  });
}

async function bootstrap(env) {
  const [head, projects, tasks, outputs] = await Promise.all([
    env.DB.prepare("SELECT * FROM continuity_heads WHERE scope_type='system' AND scope_id='mason-forge'").first(),
    env.DB.prepare(`SELECT p.id, p.name, p.location, p.client, p.status, p.review_status,
      (SELECT COUNT(*) FROM project_files f WHERE f.project_id=p.id) file_count,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='RUNNING') running_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='QUEUED') queued_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='COMPLETED') completed_tasks,
      (SELECT COUNT(*) FROM department_tasks t WHERE t.project_id=p.id AND t.status='FAILED') failed_tasks
      FROM projects p ORDER BY p.updated_at DESC`).all(),
    env.DB.prepare("SELECT status, COUNT(*) count FROM department_tasks GROUP BY status").all(),
    env.DB.prepare("SELECT COUNT(*) count FROM department_outputs").first(),
  ]);
  return json({ retrievedAt: new Date().toISOString(), continuity: head ? { ...head, state: parseJson(head.state_json, {}) } : null,
    projects: projects.results || [], taskTotals: tasks.results || [], outputCount: Number(outputs?.count || 0),
    evidenceRule: "Do not claim active work without RUNNING task events or completed department outputs." });
}

export async function connectorResponse(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/ai-plugin.json" && request.method === "GET") return json(connectorManifest(url.origin));
  if (url.pathname === "/openapi.json" && request.method === "GET") return json(connectorOpenApi(url.origin));
  if (request.method !== "GET") return null;
  if (!url.pathname.startsWith("/api/connector/") && !url.pathname.startsWith("/api/projects/")) return null;
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
  if (url.pathname === "/api/connector/bootstrap") return bootstrap(env);

  const sourceMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/files\/(\d+)\/source$/);
  if (sourceMatch) return getFile(Number(sourceMatch[1]), Number(sourceMatch[2]), env, true);
  const fileMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/files\/(\d+)$/);
  if (fileMatch) return getFile(Number(fileMatch[1]), Number(fileMatch[2]), env);
  const routeMatch = url.pathname.match(/^\/api\/projects\/(\d+)\/(status|files|file-reconciliation|tasks|outputs|findings|evidence|rfis|contacts|continuity)$/);
  if (!routeMatch) return null;
  const projectId = Number(routeMatch[1]);
  const route = routeMatch[2];
  if (route === "status") return completeStatus(projectId, env);
  if (route === "files") return listFiles(projectId, env);
  if (route === "file-reconciliation") return reconcileFiles(projectId, env);
  if (route === "tasks") return listTasks(projectId, env);
  if (route === "outputs") return listOutputs(projectId, env);
  if (route === "findings") return listFindings(projectId, env);
  if (route === "evidence") return listEvidence(projectId, env);
  if (route === "rfis") return listRfis(projectId, env);
  if (route === "contacts") return listContacts(projectId, env);
  if (route === "continuity") return projectContinuity(projectId, env);
  return null;
}
