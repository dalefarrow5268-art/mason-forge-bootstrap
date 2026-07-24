const now = () => new Date().toISOString();

const departmentWork = [
  {
    employeeId: "peter-files",
    department: "Project File Department",
    workstream: "DOCUMENT CONTROL",
    title: "Classify and reconcile extracted project evidence",
    instructions: "Review the routed evidence batch, classify document types, identify revisions and duplicates, update the document register, and identify missing or unreadable source material. Cite source file IDs and do not invent document relationships.",
    priority: 95,
  },
  {
    employeeId: "mason-holmes",
    department: "Project Investigation Department",
    workstream: "EVIDENCE INVESTIGATION",
    title: "Investigate risks, conflicts, and missing project information",
    instructions: "Use the routed evidence batch to identify plan/spec conflicts, missing information, project-party verification needs, permit or legal research needs, and candidate RFIs. Create findings only when supported by source evidence.",
    priority: 94,
  },
  {
    employeeId: "tommy-takeoff",
    department: "Project Takeoff Department",
    workstream: "TAKEOFF EVIDENCE REVIEW",
    title: "Prepare evidence-backed takeoff work plan",
    instructions: "Use the routed evidence batch to identify measurable scopes, plan and detail references, specification sections, measurement prerequisites, and blockers. Do not create quantities unless the source provides enough measurable information.",
    priority: 93,
  },
  {
    employeeId: "carol-contacts",
    department: "Project Contact Department",
    workstream: "PROJECT RELATIONSHIPS",
    title: "Reconcile project parties and contact evidence",
    instructions: "Use the routed evidence batch to identify owners, developers, architects, engineers, contractors, municipalities, vendors, and other project contacts. Separate verified contacts from inferred roles and flag missing contact fields.",
    priority: 92,
  },
  {
    employeeId: "eddie-email",
    department: "Project Communications Department",
    workstream: "COMMUNICATIONS PREPARATION",
    title: "Prepare evidence-backed communication drafts",
    instructions: "Use the routed evidence batch and approved findings to prepare draft RFIs, clarification requests, bidder communications, or internal summaries. Never send communications; all outputs require human approval.",
    priority: 91,
  },
];

async function digestIds(ids) {
  const bytes = new TextEncoder().encode(ids.join(","));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 10), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function createEvidenceBatch(projectId, files, env) {
  const fileIds = files.map((file) => Number(file.id));
  const digest = await digestIds(fileIds);
  const batchId = `evidence_${projectId}_${digest}`;
  const batchKey = `${projectId}:${digest}`;
  const timestamp = now();

  const batchInsert = await env.DB.prepare(`
    INSERT OR IGNORE INTO evidence_batches
      (id, project_id, batch_key, file_count, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ROUTED', ?, ?)
  `).bind(batchId, projectId, batchKey, fileIds.length, timestamp, timestamp).run();

  if (Number(batchInsert.meta?.changes || 0) === 0) {
    return { batchCreated: false, tasksQueued: 0, batchId };
  }

  const statements = fileIds.map((fileId) => env.DB.prepare(`
    INSERT OR IGNORE INTO evidence_batch_files
      (batch_id, project_id, file_id, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(batchId, projectId, fileId, timestamp));

  const tasks = departmentWork.map((work) => {
    const taskId = `task_${batchId}_${work.employeeId}`;
    return {
      taskId,
      message: {
        kind: "DEPARTMENT_TASK",
        taskId,
        projectId,
        employeeId: work.employeeId,
        department: work.department,
        evidenceBatchId: batchId,
      },
      statement: env.DB.prepare(`
        INSERT OR IGNORE INTO department_tasks
          (id, project_id, employee_id, department, workstream, title, instructions,
           priority, status, source_file_ids_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
      `).bind(
        taskId,
        projectId,
        work.employeeId,
        work.department,
        work.workstream,
        `${work.title} — batch ${digest}`,
        work.instructions,
        work.priority,
        JSON.stringify(fileIds),
        timestamp,
        timestamp,
      ),
    };
  });

  await env.DB.batch([...statements, ...tasks.map((task) => task.statement)]);
  await env.DEPARTMENT_QUEUE.sendBatch(tasks.map((task) => ({ body: task.message })));

  return { batchCreated: true, tasksQueued: tasks.length, batchId, fileCount: fileIds.length };
}

export async function routeReadyEvidenceBatches(projectId, env) {
  const batchSize = Math.max(1, Math.min(50, Number(env.EVIDENCE_BATCH_SIZE || 20)));
  const maxBatchesPerPass = 20;
  let batchesCreated = 0;
  let tasksQueued = 0;
  let filesRouted = 0;

  for (let pass = 0; pass < maxBatchesPerPass; pass += 1) {
    const [pending, unassigned] = await Promise.all([
      env.DB.prepare(`
        SELECT COUNT(*) count FROM project_files
        WHERE project_id = ?
          AND extracted_text_key IS NULL
          AND review_status NOT LIKE 'EXTRACTION FAILED:%'
      `).bind(projectId).first(),
      env.DB.prepare(`
        SELECT f.id
        FROM project_files f
        LEFT JOIN evidence_batch_files routed ON routed.file_id = f.id
        WHERE f.project_id = ?
          AND f.extracted_text_key IS NOT NULL
          AND routed.file_id IS NULL
        ORDER BY f.id
        LIMIT ?
      `).bind(projectId, batchSize).all(),
    ]);

    const files = unassigned.results || [];
    if (!files.length) break;
    if (files.length < batchSize && Number(pending?.count || 0) > 0) break;

    const result = await createEvidenceBatch(projectId, files, env);
    if (!result.batchCreated) break;
    batchesCreated += 1;
    tasksQueued += Number(result.tasksQueued || 0);
    filesRouted += Number(result.fileCount || 0);
  }

  return { batchesCreated, tasksQueued, filesRouted };
}

export async function routeExtractedEvidence(file, _extractionKey, env) {
  return routeReadyEvidenceBatches(Number(file.project_id), env);
}
