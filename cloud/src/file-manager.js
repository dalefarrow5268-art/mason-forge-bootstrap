const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function safePath(value) {
  const normalized = String(value || "").trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  if (!normalized || normalized.length > 500 || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Path must be a safe project-relative path.");
  }
  return normalized;
}

async function projectExists(env, projectId) {
  return Boolean(await env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(projectId).first());
}

async function audit(env, action, entityType, entityId, beforeValue, afterValue) {
  await env.DB.prepare(`INSERT INTO audit_log
    (id, actor, action, entity_type, entity_id, before_json, after_json, created_at)
    VALUES (?, 'SSX CLOUD CONNECTOR', ?, ?, ?, ?, ?, ?)`)
    .bind(uid("audit"), action, entityType, String(entityId), beforeValue ? JSON.stringify(beforeValue) : null,
      afterValue ? JSON.stringify(afterValue) : null, now()).run();
}

async function fileRow(env, projectId, fileId) {
  const row = await env.DB.prepare(`SELECT id, project_id, r2_key, file_name, relative_path, review_status,
    archived_at, archived_from_status FROM project_files WHERE id=? AND project_id=?`).bind(fileId, projectId).first();
  if (!row) throw new Error("Project file not found.");
  return row;
}

async function listFolders(env, projectId) {
  const explicit = await env.DB.prepare("SELECT * FROM project_folders WHERE project_id=? ORDER BY folder_path").bind(projectId).all();
  const files = await env.DB.prepare("SELECT relative_path, archived_at FROM project_files WHERE project_id=?").bind(projectId).all();
  const map = new Map((explicit.results || []).map((row) => [row.folder_path, {
    folderPath: row.folder_path, explicit: true, archivedAt: row.archived_at || null, fileCount: 0,
  }]));
  for (const file of files.results || []) {
    const parts = String(file.relative_path || "").replaceAll("\\", "/").split("/");
    parts.pop();
    let path = "";
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!map.has(path)) map.set(path, { folderPath: path, explicit: false, archivedAt: null, fileCount: 0 });
      if (!file.archived_at) map.get(path).fileCount += 1;
    }
  }
  return { projectId, folders: [...map.values()].sort((a, b) => a.folderPath.localeCompare(b.folderPath)) };
}

export async function manageProjectFiles(name, args, env) {
  const projectId = Number(args.projectId);
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !(await projectExists(env, projectId))) throw new Error("Project not found.");
  if (name === "list_project_folders") return listFolders(env, projectId);

  if (name === "create_project_folder") {
    const folderPath = safePath(args.folderPath);
    const timestamp = now();
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO project_folders
      (id, project_id, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(uid("folder"), projectId, folderPath, timestamp, timestamp).run();
    if (!Number(result.meta?.changes || 0)) throw new Error("That folder already exists.");
    await audit(env, "CREATE", "project_folder", `${projectId}:${folderPath}`, null, { projectId, folderPath });
    return { created: true, projectId, folderPath };
  }

  if (name === "rename_project_file") {
    const fileId = Number(args.fileId);
    const before = await fileRow(env, projectId, fileId);
    if (before.archived_at) throw new Error("Restore the file before renaming it.");
    const relativePath = safePath(args.relativePath);
    const conflict = await env.DB.prepare("SELECT id FROM project_files WHERE project_id=? AND lower(relative_path)=lower(?) AND id<>? AND archived_at IS NULL")
      .bind(projectId, relativePath, fileId).first();
    if (conflict) throw new Error("An active file already uses that path.");
    const fileName = relativePath.split("/").pop();
    await env.DB.prepare("UPDATE project_files SET file_name=?, relative_path=?, updated_at=? WHERE id=? AND project_id=?")
      .bind(fileName, relativePath, now(), fileId, projectId).run();
    const after = await fileRow(env, projectId, fileId);
    await audit(env, "RENAME_OR_MOVE", "project_file", fileId, before, after);
    return { changed: true, projectId, fileId, relativePath, r2ObjectPreserved: true };
  }

  if (name === "archive_project_file" || name === "restore_project_file") {
    const fileId = Number(args.fileId);
    const before = await fileRow(env, projectId, fileId);
    if (name === "archive_project_file") {
      if (before.archived_at) return { archived: true, alreadyArchived: true, projectId, fileId };
      await env.DB.prepare("UPDATE project_files SET archived_at=?, archived_from_status=review_status, review_status='ARCHIVED', updated_at=? WHERE id=? AND project_id=?")
        .bind(now(), now(), fileId, projectId).run();
    } else {
      if (!before.archived_at) return { restored: true, alreadyActive: true, projectId, fileId };
      await env.DB.prepare("UPDATE project_files SET archived_at=NULL, review_status=coalesce(archived_from_status,'NEEDS REVIEW'), archived_from_status=NULL, updated_at=? WHERE id=? AND project_id=?")
        .bind(now(), fileId, projectId).run();
    }
    const after = await fileRow(env, projectId, fileId);
    await audit(env, name === "archive_project_file" ? "ARCHIVE" : "RESTORE", "project_file", fileId, before, after);
    return { [name === "archive_project_file" ? "archived" : "restored"]: true, projectId, fileId, r2ObjectPreserved: true };
  }

  const folderPath = safePath(args.folderPath);
  if (name === "rename_project_folder") {
    const newFolderPath = safePath(args.newFolderPath);
    const rows = await env.DB.prepare("SELECT id, relative_path FROM project_files WHERE project_id=? AND (relative_path=? OR relative_path LIKE ?)")
      .bind(projectId, folderPath, `${folderPath}/%`).all();
    const timestamp = now();
    for (const row of rows.results || []) {
      const suffix = row.relative_path.slice(folderPath.length);
      await env.DB.prepare("UPDATE project_files SET relative_path=?, updated_at=? WHERE id=?")
        .bind(`${newFolderPath}${suffix}`, timestamp, row.id).run();
    }
    await env.DB.prepare("UPDATE project_folders SET folder_path=?, updated_at=? WHERE project_id=? AND folder_path=?")
      .bind(newFolderPath, timestamp, projectId, folderPath).run();
    await audit(env, "RENAME_OR_MOVE", "project_folder", `${projectId}:${folderPath}`, { folderPath }, { newFolderPath, affectedFiles: (rows.results || []).length });
    return { changed: true, projectId, folderPath, newFolderPath, affectedFiles: (rows.results || []).length, r2ObjectsPreserved: true };
  }

  if (name === "archive_project_folder" || name === "restore_project_folder") {
    const archive = name === "archive_project_folder";
    const rows = await env.DB.prepare("SELECT id FROM project_files WHERE project_id=? AND (relative_path=? OR relative_path LIKE ?)")
      .bind(projectId, folderPath, `${folderPath}/%`).all();
    const timestamp = now();
    if (archive) {
      await env.DB.prepare("UPDATE project_folders SET archived_at=?, updated_at=? WHERE project_id=? AND folder_path=?").bind(timestamp, timestamp, projectId, folderPath).run();
      for (const row of rows.results || []) await env.DB.prepare("UPDATE project_files SET archived_at=?, archived_from_status=review_status, review_status='ARCHIVED', updated_at=? WHERE id=? AND archived_at IS NULL").bind(timestamp, timestamp, row.id).run();
    } else {
      await env.DB.prepare("UPDATE project_folders SET archived_at=NULL, updated_at=? WHERE project_id=? AND folder_path=?").bind(timestamp, projectId, folderPath).run();
      for (const row of rows.results || []) await env.DB.prepare("UPDATE project_files SET archived_at=NULL, review_status=coalesce(archived_from_status,'NEEDS REVIEW'), archived_from_status=NULL, updated_at=? WHERE id=?").bind(timestamp, row.id).run();
    }
    await audit(env, archive ? "ARCHIVE" : "RESTORE", "project_folder", `${projectId}:${folderPath}`, null, { affectedFiles: (rows.results || []).length });
    return { [archive ? "archived" : "restored"]: true, projectId, folderPath, affectedFiles: (rows.results || []).length, r2ObjectsPreserved: true };
  }
  throw new Error("Unsupported file-management operation.");
}
