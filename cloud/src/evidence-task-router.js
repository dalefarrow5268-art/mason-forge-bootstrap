const now = () => new Date().toISOString();

const departmentWork = [
  {
    employeeId: "peter-files",
    department: "Project File Department",
    workstream: "DOCUMENT CONTROL",
    title: "Classify and reconcile extracted project evidence",
    instructions: "Build an evidence-cited document register. Identify document types, revisions and superseded versions, exact or likely duplicates, missing expected documents, and unreadable source material. Cite source file IDs and distinguish verified relationships from candidates requiring review.",
    priority: 95,
  },
  {
    employeeId: "mason-holmes",
    department: "Project Investigation Department",
    workstream: "EVIDENCE INVESTIGATION",
    title: "Investigate risks, conflicts, and missing project information",
    instructions: "Build an evidence-cited investigation record covering chronology, parties, risks, conflicts, missing information, public-record research needs, permit/legal verification needs, and candidate RFIs. Separate verified facts, source-supported inferences, and external research requests.",
    priority: 94,
  },
  {
    employeeId: "tommy-takeoff",
    department: "Project Takeoff Department",
    workstream: "TAKEOFF EVIDENCE REVIEW",
    title: "Prepare evidence-backed takeoff work plan",
    instructions: "Identify remaining scope, evidence-supported quantities, quantity gaps, plan/detail/spec references, measurement prerequisites, blockers, exclusions, and trade interfaces. Do not create quantities unless the source provides enough measurable information.",
    priority: 93,
  },
  {
    employeeId: "carol-contacts",
    department: "Project Contact Department",
    workstream: "PROJECT RELATIONSHIPS",
    title: "Reconcile project parties and contact evidence",
    instructions: "Build an evidence-cited party and contact register covering owner, developer, GC, municipality, inspectors, subcontractors, designers, vendors, and other project contacts. Separate verified contacts from inferred roles and flag every missing contact field.",
    priority: 92,
  },
  {
    employeeId: "eddie-email",
    department: "Project Communications Department",
    workstream: "COMMUNICATIONS PREPARATION",
    title: "Prepare evidence-backed communication drafts",
    instructions: "Build the evidence-cited communication history, identify commitments, unanswered questions, response gaps, and responsible parties, then prepare draft outreach, RFIs, clarification requests, or internal summaries. Never send communications; all drafts require human approval.",
    priority: 91,
  },
];

const finalDepartmentWork = departmentWork.map((work) => ({
  ...work,
  workstream: "FINAL EVIDENCE SYNTHESIS",
  title: `Final project-wide ${work.title.toLowerCase()}`,
  instructions: `${work.instructions} Reconcile all prior department outputs into one project-wide deliverable, remove repeated findings, preserve conflicts, and explicitly state completeness and limitations.`,
  priority: work.priority + 5,
}));

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

async function queueFinalDepartmentRuns(projectId, env) {
  const [files, routed] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN extracted_text_key IS NOT NULL THEN 1 ELSE 0 END) extracted,
      SUM(CASE WHEN extracted_text_key IS NULL AND review_status LIKE '%REVIEW REQUIRED:%' THEN 1 ELSE 0 END) review_required
      FROM project_files WHERE project_id=?`).bind(projectId).first(),
    env.DB.prepare("SELECT COUNT(*) count FROM evidence_batch_files WHERE project_id=?").bind(projectId).first(),
  ]);
  const total = Number(files?.total || 0);
  const terminal = Number(files?.extracted || 0) + Number(files?.review_required || 0);
  if (!total || terminal !== total || Number(routed?.count || 0) !== Number(files?.extracted || 0)) {
    return { finalTasksQueued: 0 };
  }

  const timestamp = now();
  const queued = [];
  for (const work of finalDepartmentWork) {
    const taskId = `task_project_${projectId}_final_${work.employeeId}`;
    const insert = await env.DB.prepare(`
      INSERT OR IGNORE INTO department_tasks
        (id, project_id, employee_id, department, workstream, title, instructions,
         priority, status, source_file_ids_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', '[]', ?, ?)
    `).bind(
      taskId, projectId, work.employeeId, work.department, work.workstream,
      work.title, work.instructions, work.priority, timestamp, timestamp,
    ).run();
    if (Number(insert.meta?.changes || 0) > 0) {
      queued.push({
        kind: "DEPARTMENT_TASK",
        taskId,
        projectId,
        employeeId: work.employeeId,
        department: work.department,
        finalSynthesis: true,
      });
    }
  }
  if (queued.length) await env.DEPARTMENT_QUEUE.sendBatch(queued.map((body) => ({ body })));
  return { finalTasksQueued: queued.length };
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
          AND review_status NOT LIKE '%REVIEW REQUIRED:%'
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

  const final = await queueFinalDepartmentRuns(projectId, env);
  return { batchesCreated, tasksQueued, filesRouted, ...final };
}

export async function routeExtractedEvidence(file, _extractionKey, env) {
  return routeReadyEvidenceBatches(Number(file.project_id), env);
}
