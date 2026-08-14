const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const ITEM_TYPES = new Set([
  "FDR", "DIV", "SEC", "ACT", "EST", "ASM", "CAL", "HOL", "WTH", "HAZ",
  "INS", "TST", "SAF", "TRN", "DLV", "LAB", "EQP", "MAT", "MUN", "HRS",
  "DOC", "TMP", "WRK"
]);

function itemType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!ITEM_TYPES.has(normalized)) {
    throw new Error(`itemType must be one of: ${[...ITEM_TYPES].join(", ")}.`);
  }
  return normalized;
}

function text(value, maxLength, field, required = false) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required.`);
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`${field} is invalid.`);
  return normalized;
}

async function projectExists(env, projectId) {
  return Boolean(await env.DB.prepare("SELECT id FROM projects WHERE id=?").bind(projectId).first());
}

async function audit(env, action, entityId, beforeValue, afterValue) {
  await env.DB.prepare(`INSERT INTO audit_log
    (id, actor, action, entity_type, entity_id, before_json, after_json, created_at)
    VALUES (?, 'SSX CLOUD CONNECTOR', ?, 'fulfillment_inventory', ?, ?, ?, ?)`)
    .bind(uid("audit"), action, entityId, beforeValue ? JSON.stringify(beforeValue) : null,
      afterValue ? JSON.stringify(afterValue) : null, now()).run();
}

async function inventoryRow(env, inventoryNumber) {
  return env.DB.prepare("SELECT * FROM fulfillment_inventory WHERE inventory_number=?")
    .bind(inventoryNumber).first();
}

function metadataObject(row) {
  if (!row?.metadata_json) return {};
  try {
    const parsed = JSON.parse(row.metadata_json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function metadataJson(value) {
  const serialized = JSON.stringify(value);
  if (serialized.length > 20000) throw new Error("metadata is too large.");
  return serialized;
}

function inventoryNumber(value) {
  const normalized = text(value, 32, "inventoryNumber", true).toUpperCase();
  if (!/^SFC-[A-Z]{3}-[0-9]{6}$/.test(normalized)) throw new Error("inventoryNumber is invalid.");
  return normalized;
}

async function activeParent(env, projectId, parentNumber, currentNumber = null) {
  if (!parentNumber) return null;
  const normalized = parentNumber.toUpperCase();
  if (normalized === currentNumber) throw new Error("An inventory item cannot be its own parent.");
  const parent = await inventoryRow(env, normalized);
  if (!parent || Number(parent.project_id) !== projectId || parent.status !== "ACTIVE" || parent.archived_at) {
    throw new Error("Active parent inventory item not found in this project.");
  }
  return normalized;
}

async function activeDuplicate(env, values, excludeInventoryNumber = null) {
  const clauses = [`project_id=?`, `item_type=?`, `lower(item_name)=lower(?)`,
    `coalesce(parent_inventory_number,'')=coalesce(?,'')`,
    `coalesce(folder_path,'')=coalesce(?,'')`, `archived_at IS NULL`];
  const bindings = [values.projectId, values.itemType, values.itemName,
    values.parentInventoryNumber, values.folderPath];
  if (excludeInventoryNumber) {
    clauses.push("inventory_number<>?");
    bindings.push(excludeInventoryNumber);
  }
  return env.DB.prepare(`SELECT * FROM fulfillment_inventory WHERE ${clauses.join(" AND ")}`)
    .bind(...bindings).first();
}

function lifecycleStatements(env, action, before, after, timestamp) {
  const historyId = uid("fih");
  const auditId = uid("audit");
  return [
    env.DB.prepare(`INSERT INTO fulfillment_inventory_history
      (id, inventory_number, project_id, action, before_json, after_json, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'SSX CLOUD CONNECTOR', ?)`)
      .bind(historyId, before.inventory_number, Number(before.project_id), action,
        JSON.stringify(before), JSON.stringify(after), timestamp),
    env.DB.prepare(`INSERT INTO audit_log
      (id, actor, action, entity_type, entity_id, before_json, after_json, created_at)
      VALUES (?, 'SSX CLOUD CONNECTOR', ?, 'fulfillment_inventory', ?, ?, ?, ?)`)
      .bind(auditId, action, before.inventory_number, JSON.stringify(before), JSON.stringify(after), timestamp),
  ];
}

function present(row) {
  if (!row) return null;
  let metadata = null;
  try { metadata = row.metadata_json ? JSON.parse(row.metadata_json) : null; } catch {}
  return {
    inventoryNumber: row.inventory_number,
    itemType: row.item_type,
    itemName: row.item_name,
    projectId: Number(row.project_id),
    parentInventoryNumber: row.parent_inventory_number || null,
    csiCode: row.csi_code || null,
    folderPath: row.folder_path || null,
    sourceFileId: row.source_file_id === null ? null : Number(row.source_file_id),
    description: row.description || null,
    metadata,
    status: row.status,
    archivedAt: row.archived_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function manageFulfillmentInventory(name, args, env) {
  const projectId = Number(args.projectId);
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !(await projectExists(env, projectId))) {
    throw new Error("Project not found.");
  }

  if (name === "get_fulfillment_item") {
    const number = inventoryNumber(args.inventoryNumber);
    const row = await inventoryRow(env, number);
    if (!row || Number(row.project_id) !== projectId) throw new Error("Fulfillment inventory item not found.");
    return { item: present(row) };
  }

  if (name === "list_fulfillment_inventory") {
    const type = args.itemType ? itemType(args.itemType) : null;
    const status = String(args.status || "ACTIVE").trim().toUpperCase();
    if (!["ACTIVE", "ARCHIVED", "ALL"].includes(status)) throw new Error("status must be ACTIVE, ARCHIVED, or ALL.");
    const clauses = ["project_id=?"];
    const bindings = [projectId];
    if (type) { clauses.push("item_type=?"); bindings.push(type); }
    if (status !== "ALL") { clauses.push("status=?"); bindings.push(status); }
    const rows = await env.DB.prepare(`SELECT * FROM fulfillment_inventory WHERE ${clauses.join(" AND ")}
      ORDER BY item_type, id`).bind(...bindings).all();
    return { projectId, status, itemType: type, count: (rows.results || []).length, items: (rows.results || []).map(present) };
  }

  if (name === "register_fulfillment_item") {
    const type = itemType(args.itemType);
    const itemName = text(args.itemName, 240, "itemName", true);
    const parentInventoryNumber = text(args.parentInventoryNumber, 32, "parentInventoryNumber");
    const csiCode = text(args.csiCode, 40, "csiCode");
    const folderPath = text(args.folderPath, 500, "folderPath");
    const description = text(args.description, 4000, "description");
    const sourceFileId = args.sourceFileId === undefined || args.sourceFileId === null ? null : Number(args.sourceFileId);
    if (sourceFileId !== null) {
      if (!Number.isSafeInteger(sourceFileId) || sourceFileId < 1) throw new Error("sourceFileId must be a positive integer.");
      const file = await env.DB.prepare("SELECT id FROM project_files WHERE id=? AND project_id=?")
        .bind(sourceFileId, projectId).first();
      if (!file) throw new Error("Source file not found in this project.");
    }
    if (parentInventoryNumber) {
      const parent = await inventoryRow(env, parentInventoryNumber.toUpperCase());
      if (!parent || Number(parent.project_id) !== projectId) throw new Error("Parent inventory item not found in this project.");
    }
    const duplicate = await env.DB.prepare(`SELECT * FROM fulfillment_inventory
      WHERE project_id=? AND item_type=? AND lower(item_name)=lower(?)
        AND coalesce(parent_inventory_number,'')=coalesce(?,'')
        AND coalesce(folder_path,'')=coalesce(?,'')
        AND coalesce(source_file_id,0)=coalesce(?,0) AND archived_at IS NULL`)
      .bind(projectId, type, itemName, parentInventoryNumber?.toUpperCase() || null, folderPath, sourceFileId).first();
    if (duplicate) return { registered: true, duplicate: true, item: present(duplicate) };

    let metadataJson = null;
    if (args.metadata !== undefined && args.metadata !== null) {
      metadataJson = JSON.stringify(args.metadata);
      if (metadataJson.length > 20000) throw new Error("metadata is too large.");
    }
    const timestamp = now();
    const pendingNumber = `PENDING-${crypto.randomUUID()}`;
    const inserted = await env.DB.prepare(`INSERT INTO fulfillment_inventory
      (inventory_number, project_id, item_type, item_name, parent_inventory_number, csi_code,
       folder_path, source_file_id, description, metadata_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
      .bind(pendingNumber, projectId, type, itemName, parentInventoryNumber?.toUpperCase() || null,
        csiCode, folderPath, sourceFileId, description, metadataJson, timestamp, timestamp).run();
    const id = Number(inserted.meta?.last_row_id || 0);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("Inventory number allocation failed.");
    const inventoryNumber = `SFC-${type}-${String(id).padStart(6, "0")}`;
    await env.DB.prepare("UPDATE fulfillment_inventory SET inventory_number=?, updated_at=? WHERE id=?")
      .bind(inventoryNumber, timestamp, id).run();
    const after = await inventoryRow(env, inventoryNumber);
    await audit(env, "REGISTER", inventoryNumber, null, after);
    return { registered: true, duplicate: false, item: present(after) };
  }

  if (name === "reclassify_fulfillment_item") {
    const number = inventoryNumber(args.inventoryNumber);
    const before = await inventoryRow(env, number);
    if (!before || Number(before.project_id) !== projectId) throw new Error("Fulfillment inventory item not found.");
    if (before.status !== "ACTIVE" || before.archived_at) throw new Error("Archived inventory items must be restored before reclassification.");

    const type = itemType(args.itemType);
    const parentInventoryNumber = await activeParent(env, projectId,
      text(args.parentInventoryNumber, 32, "parentInventoryNumber", true), number);
    const folderPath = text(args.folderPath, 500, "folderPath", true);
    const csiCode = args.clearCsiCode ? null
      : (args.csiCode === undefined ? before.csi_code : text(args.csiCode, 40, "csiCode"));
    const patch = args.metadataPatch === undefined || args.metadataPatch === null ? {} : args.metadataPatch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("metadataPatch must be an object.");
    const oldMetadata = metadataObject(before);
    const patchAlreadyApplied = Object.entries(patch)
      .every(([key, value]) => JSON.stringify(oldMetadata[key]) === JSON.stringify(value));
    if (before.item_type === type && before.parent_inventory_number === parentInventoryNumber
      && before.folder_path === folderPath && (before.csi_code || null) === csiCode
      && oldMetadata.current_classification === type && patchAlreadyApplied) {
      return { reclassified: true, changed: false, permanentNumberPreserved: true, item: present(before) };
    }
    const timestamp = now();
    const metadata = {
      ...oldMetadata,
      ...patch,
      original_item_type: oldMetadata.original_item_type || before.item_type,
      current_classification: type,
      reclassified_at: timestamp,
    };
    const metadataSerialized = metadataJson(metadata);
    const duplicate = await activeDuplicate(env, {
      projectId, itemType: type, itemName: before.item_name,
      parentInventoryNumber, folderPath,
    }, number);
    if (duplicate) throw new Error(`Reclassification would duplicate ${duplicate.inventory_number}.`);

    const afterSnapshot = { ...before, item_type: type, parent_inventory_number: parentInventoryNumber,
      csi_code: csiCode, folder_path: folderPath, metadata_json: metadataSerialized, updated_at: timestamp };
    await env.DB.batch([
      env.DB.prepare(`UPDATE fulfillment_inventory SET item_type=?, parent_inventory_number=?, csi_code=?,
        folder_path=?, metadata_json=?, updated_at=? WHERE inventory_number=? AND project_id=? AND archived_at IS NULL`)
        .bind(type, parentInventoryNumber, csiCode, folderPath, metadataSerialized, timestamp, number, projectId),
      ...lifecycleStatements(env, "RECLASSIFY", before, afterSnapshot, timestamp),
    ]);
    const after = await inventoryRow(env, number);
    return { reclassified: true, changed: true, permanentNumberPreserved: true, item: present(after) };
  }

  if (name === "archive_fulfillment_item") {
    const number = inventoryNumber(args.inventoryNumber);
    const before = await inventoryRow(env, number);
    if (!before || Number(before.project_id) !== projectId) throw new Error("Fulfillment inventory item not found.");
    if (before.status === "ARCHIVED" || before.archived_at) {
      return { archived: true, changed: false, item: present(before) };
    }
    const child = await env.DB.prepare(`SELECT inventory_number FROM fulfillment_inventory
      WHERE project_id=? AND parent_inventory_number=? AND archived_at IS NULL LIMIT 1`)
      .bind(projectId, number).first();
    if (child) throw new Error(`Archive blocked: active child ${child.inventory_number} depends on this item.`);
    const timestamp = now();
    const afterSnapshot = { ...before, status: "ARCHIVED", archived_at: timestamp, updated_at: timestamp };
    await env.DB.batch([
      env.DB.prepare(`UPDATE fulfillment_inventory SET status='ARCHIVED', archived_at=?, updated_at=?
        WHERE inventory_number=? AND project_id=? AND archived_at IS NULL`)
        .bind(timestamp, timestamp, number, projectId),
      ...lifecycleStatements(env, "ARCHIVE", before, afterSnapshot, timestamp),
    ]);
    return { archived: true, changed: true, item: present(await inventoryRow(env, number)) };
  }

  if (name === "restore_fulfillment_item") {
    const number = inventoryNumber(args.inventoryNumber);
    const before = await inventoryRow(env, number);
    if (!before || Number(before.project_id) !== projectId) throw new Error("Fulfillment inventory item not found.");
    if (before.status === "ACTIVE" && !before.archived_at) {
      return { restored: true, changed: false, item: present(before) };
    }
    await activeParent(env, projectId, before.parent_inventory_number, number);
    const duplicate = await activeDuplicate(env, {
      projectId, itemType: before.item_type, itemName: before.item_name,
      parentInventoryNumber: before.parent_inventory_number, folderPath: before.folder_path,
    }, number);
    if (duplicate) throw new Error(`Restore would duplicate ${duplicate.inventory_number}.`);
    const timestamp = now();
    const afterSnapshot = { ...before, status: "ACTIVE", archived_at: null, updated_at: timestamp };
    await env.DB.batch([
      env.DB.prepare(`UPDATE fulfillment_inventory SET status='ACTIVE', archived_at=NULL, updated_at=?
        WHERE inventory_number=? AND project_id=? AND archived_at IS NOT NULL`)
        .bind(timestamp, number, projectId),
      ...lifecycleStatements(env, "RESTORE", before, afterSnapshot, timestamp),
    ]);
    return { restored: true, changed: true, item: present(await inventoryRow(env, number)) };
  }

  throw new Error("Unsupported fulfillment inventory operation.");
}
