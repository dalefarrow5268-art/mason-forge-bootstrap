const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const now = () => new Date().toISOString();

function base64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeName(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 240);
}

function safeRelativePath(value, fileName) {
  const normalized = String(value || fileName).trim().replaceAll("\\", "/")
    .replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!normalized || normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("relativePath must be a safe project-relative path.");
  }
  return normalized.split("/").map(safeName).filter(Boolean).join("/");
}

function validSha(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ""));
}

export async function createProjectUploadGrant(env, origin, args) {
  const projectId = Number(args?.projectId);
  const sizeBytes = Number(args?.sizeBytes);
  const expectedSha256 = String(args?.sha256 || "").trim().toLowerCase();
  const fileName = safeName(args?.fileName);
  const contentType = String(args?.contentType || "application/octet-stream").trim().slice(0, 160);
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error("projectId must be a positive integer.");
  if (!fileName) throw new Error("fileName is required.");
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error(`sizeBytes must be between 1 and ${MAX_UPLOAD_BYTES}.`);
  }
  if (!validSha(expectedSha256)) throw new Error("sha256 must be a 64-character hexadecimal digest.");
  const relativePath = safeRelativePath(args?.relativePath, fileName);
  const project = await env.DB.prepare("SELECT id, name FROM projects WHERE id=?").bind(projectId).first();
  if (!project) throw new Error("Project not found.");

  const duplicate = await env.DB.prepare(`
    SELECT id, file_name, relative_path, size_bytes, sha256, review_status
    FROM project_files
    WHERE project_id=? AND (
      lower(replace(relative_path, '\\', '/'))=lower(?)
      OR (sha256 IS NOT NULL AND lower(sha256)=lower(?))
    )
    ORDER BY id DESC LIMIT 1
  `).bind(projectId, relativePath, expectedSha256).first();
  if (duplicate) {
    return {
      duplicate: true,
      project: { id: Number(project.id), name: project.name },
      existingFile: { ...duplicate, id: Number(duplicate.id), size_bytes: Number(duplicate.size_bytes || 0) },
      message: "Upload rejected because the path or SHA-256 already exists in this project.",
    };
  }

  const timestamp = now();
  const inserted = await env.DB.prepare(`
    INSERT INTO project_files
      (project_id, r2_key, file_name, relative_path, file_type, size_bytes, sha256,
       review_status, source_class, uploaded_at, updated_at)
    VALUES (?, '', ?, ?, ?, ?, ?, 'UPLOAD PENDING', 'PROJECT REPORT', ?, ?)
  `).bind(projectId, fileName, relativePath, contentType, sizeBytes, expectedSha256, timestamp, timestamp).run();
  const fileId = Number(inserted.meta.last_row_id);
  const r2Key = `projects/${projectId}/source/${fileId}/${fileName}`;
  await env.DB.prepare("UPDATE project_files SET r2_key=? WHERE id=?").bind(r2Key, fileId).run();

  const token = `mful_${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO mcp_upload_grants
      (token_hash, project_id, file_id, expected_size, expected_sha256, content_type,
       status, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, ?)
  `).bind(tokenHash, projectId, fileId, sizeBytes, expectedSha256, contentType, expiresAt, timestamp).run();

  return {
    duplicate: false,
    project: { id: Number(project.id), name: project.name },
    fileId,
    fileName,
    relativePath,
    sizeBytes,
    sha256: expectedSha256,
    method: "PUT",
    uploadUrl: `${origin}/api/uploads/${token}`,
    requiredHeaders: { "content-type": contentType },
    expiresAt,
    message: "PUT the exact file bytes to uploadUrl before expiresAt. The server verifies size and SHA-256 before finalizing R2 and D1.",
  };
}

export async function uploadGrantResponse(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/uploads\/(mful_[A-Za-z0-9_-]+)$/);
  if (!match) return null;
  if (request.method !== "PUT") return json({ error: "Use PUT with the exact file bytes." }, 405);
  const tokenHash = await sha256(match[1]);
  const grant = await env.DB.prepare(`
    SELECT g.*, f.r2_key, f.file_name, f.relative_path
    FROM mcp_upload_grants g JOIN project_files f ON f.id=g.file_id
    WHERE g.token_hash=?
  `).bind(tokenHash).first();
  if (!grant || grant.status !== "READY" || grant.expires_at <= now()) {
    return json({ error: "Upload grant is invalid, expired, or already used." }, 410);
  }
  const declaredLength = Number(request.headers.get("content-length") || grant.expected_size);
  if (declaredLength !== Number(grant.expected_size) || declaredLength > MAX_UPLOAD_BYTES) {
    return json({ error: "Content length does not match the upload grant." }, 400);
  }
  const claimed = await env.DB.prepare(`
    UPDATE mcp_upload_grants SET status='UPLOADING'
    WHERE token_hash=? AND status='READY' AND expires_at>?
  `).bind(tokenHash, now()).run();
  if (Number(claimed.meta?.changes || 0) !== 1) return json({ error: "Upload grant is already in use." }, 409);

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength !== Number(grant.expected_size)) throw new Error("Uploaded byte length does not match the grant.");
    const actualSha256 = await sha256(bytes);
    if (actualSha256 !== grant.expected_sha256) throw new Error("Uploaded SHA-256 does not match the grant.");
    await env.PROJECT_FILES.put(grant.r2_key, bytes, {
      httpMetadata: { contentType: grant.content_type },
      customMetadata: { projectId: String(grant.project_id), fileId: String(grant.file_id), sha256: actualSha256 },
    });
    const timestamp = now();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE project_files SET review_status='EXTRACTION QUEUED', updated_at=?
        WHERE id=? AND project_id=?
      `).bind(timestamp, grant.file_id, grant.project_id),
      env.DB.prepare(`
        UPDATE mcp_upload_grants SET status='COMPLETED', completed_at=?
        WHERE token_hash=?
      `).bind(timestamp, tokenHash),
    ]);
    await env.DEPARTMENT_QUEUE.send({
      kind: "EXTRACT_PROJECT_FILE",
      fileId: Number(grant.file_id),
      projectId: Number(grant.project_id),
    });
    return json({
      uploaded: true,
      projectId: Number(grant.project_id),
      fileId: Number(grant.file_id),
      fileName: grant.file_name,
      relativePath: grant.relative_path,
      sizeBytes: bytes.byteLength,
      sha256: actualSha256,
      r2Key: grant.r2_key,
      reviewStatus: "EXTRACTION QUEUED",
    }, 201);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    await env.DB.batch([
      env.DB.prepare("UPDATE mcp_upload_grants SET status='FAILED' WHERE token_hash=?").bind(tokenHash),
      env.DB.prepare("UPDATE project_files SET review_status=?, updated_at=? WHERE id=?")
        .bind(`UPLOAD FAILED: ${message}`, now(), grant.file_id),
    ]);
    return json({ error: message }, 400);
  }
}
