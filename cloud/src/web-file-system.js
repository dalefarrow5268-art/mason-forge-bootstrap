const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function authorized(request, env) {
  return Boolean(env.MASON_API_TOKEN) && request.headers.get("authorization") === `Bearer ${env.MASON_API_TOKEN}`;
}

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();

async function seedRoots(env) {
  const roots = [
    ["SSX", "SSX"], ["Mason Forge", "MASON FORGE"], ["Bask Development", "BASK"], ["Dale Personal Workspace", "DALE"],
  ];
  for (const [name, workstream] of roots) {
    const existing = await env.DB.prepare("SELECT id FROM ssx_folders WHERE parent_id IS NULL AND name=? AND deleted_at IS NULL").bind(name).first();
    if (!existing) await env.DB.prepare(`INSERT INTO ssx_folders (id,parent_id,name,workstream,created_by,created_at,updated_at)
      VALUES (?,NULL,?,?, 'DALE FARROW',?,?)`).bind(id("folder"), name, workstream, now(), now()).run();
  }
}

async function overview(env) {
  await seedRoots(env);
  const [roots, projects, usage, transfers, email] = await Promise.all([
    env.DB.prepare(`SELECT id,name,workstream,created_at FROM ssx_folders WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY name`).all(),
    env.DB.prepare(`SELECT p.id,p.name,p.location,p.client,COUNT(f.id) file_count,COALESCE(SUM(f.size_bytes),0) size_bytes
      FROM projects p LEFT JOIN project_files f ON f.project_id=p.id GROUP BY p.id ORDER BY p.name`).all(),
    env.DB.prepare("SELECT COUNT(*) file_count, COALESCE(SUM(size_bytes),0) size_bytes FROM project_files").first(),
    env.DB.prepare("SELECT status, direction, COUNT(*) count FROM ssx_transfers GROUP BY status,direction ORDER BY status").all(),
    env.DB.prepare("SELECT disposition, COUNT(*) count FROM ssx_email_attachments GROUP BY disposition ORDER BY disposition").all(),
  ]);
  return json({
    system: "SSX Web File System", status: "FOUNDATION ACTIVE", storageBudget: { annualTargetUsd: 120, planningCapacityGb: 500 },
    roots: roots.results || [], projects: projects.results || [],
    usage: { files: Number(usage?.file_count || 0), bytes: Number(usage?.size_bytes || 0) },
    transfers: transfers.results || [], emailAttachments: email.results || [],
    protections: ["Private R2 objects", "Verified upload grants", "Existing project files preserved", "Transfer and email records additive"],
  });
}

async function createTransfer(request, env) {
  const body = await request.json();
  const direction = body.direction === "INBOUND" ? "INBOUND" : "OUTBOUND";
  const transferId = id("transfer");
  const timestamp = now();
  await env.DB.prepare(`INSERT INTO ssx_transfers
    (id,direction,status,folder_id,project_id,company_id,contact_id,recipient_email,expires_at,max_downloads,created_by,created_at,updated_at)
    VALUES (?,?, 'DRAFT',?,?,?,?,?,?,?,?,?,?)`).bind(
    transferId, direction, body.folderId || null, body.projectId || null, body.companyId || null, body.contactId || null,
    body.recipientEmail || null, body.expiresAt || null, body.maxDownloads || null, "DALE FARROW", timestamp, timestamp,
  ).run();
  return json({ id: transferId, direction, status: "DRAFT", message: "Transfer record created. Public links remain disabled until external upload scanning and recipient verification are enabled." }, 201);
}

async function connectedSources(request, env) {
  if (request.method === "GET") {
    const result = await env.DB.prepare(`SELECT id,provider,account_label,status,granted_scopes_json,connected_at,last_checked_at,revoked_at
      FROM ssx_connected_sources WHERE revoked_at IS NULL ORDER BY provider, created_at DESC`).all();
    return json({ sources: result.results || [], providers: [
      { provider: "GOOGLE_DRIVE", label: "Google Drive", state: "OAUTH SETUP REQUIRED" },
      { provider: "ONEDRIVE", label: "OneDrive", state: "OAUTH SETUP REQUIRED" },
    ] });
  }
  const body = await request.json();
  const provider = body.provider === "GOOGLE_DRIVE" || body.provider === "ONEDRIVE" ? body.provider : null;
  if (!provider) return json({ error: "provider must be GOOGLE_DRIVE or ONEDRIVE." }, 400);
  const timestamp = now();
  const sourceId = id("source");
  await env.DB.prepare(`INSERT INTO ssx_connected_sources
    (id,provider,status,created_by,created_at,updated_at) VALUES (?,?, 'OAUTH SETUP REQUIRED','DALE FARROW',?,?)`)
    .bind(sourceId, provider, timestamp, timestamp).run();
  return json({ id: sourceId, provider, status: "OAUTH SETUP REQUIRED",
    message: "Connection record created. Enable the provider OAuth client and encrypted token storage before redirecting an account to sign in." }, 201);
}

export async function webFileSystemRoute(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/filesystem")) return null;
  if (!authorized(request, env)) return json({ error: "Unauthorized." }, 401);
  if (url.pathname === "/api/filesystem/overview" && request.method === "GET") return overview(env);
  if (url.pathname === "/api/filesystem/transfers" && request.method === "POST") return createTransfer(request, env);
  if (url.pathname === "/api/filesystem/sources" && (request.method === "GET" || request.method === "POST")) return connectedSources(request, env);
  return json({ error: "Not found." }, 404);
}
