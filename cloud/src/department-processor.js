const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { summary: text, findings: [], recommendedNextActions: [] };
  }
}

function take(value, limit = 30) {
  return Array.isArray(value) ? value.slice(0, limit) : value ?? null;
}

function compactEvidenceRecord(record) {
  const extraction = record?.extraction || {};
  return {
    sourceFile: record?.sourceFile || null,
    extractedAt: record?.extractedAt || null,
    extraction: {
      documentType: extraction.documentType || null,
      title: extraction.title || null,
      revision: extraction.revision || null,
      documentDate: extraction.documentDate || null,
      projectName: extraction.projectName || null,
      projectAddress: extraction.projectAddress || null,
      summary: typeof extraction.summary === "string" ? extraction.summary.slice(0, 12000) : extraction.summary || null,
      parties: take(extraction.parties),
      sheetOrSectionReferences: take(extraction.sheetOrSectionReferences, 50),
      keyReferences: take(extraction.keyReferences, 50),
      verifiedFacts: take(extraction.verifiedFacts, 50),
      scopeItems: take(extraction.scopeItems, 50),
      scheduleFacts: take(extraction.scheduleFacts, 40),
      costFacts: take(extraction.costFacts, 40),
      contactFacts: take(extraction.contactFacts, 40),
      permitOrLegalFacts: take(extraction.permitOrLegalFacts, 40),
      risksOrConflicts: take(extraction.risksOrConflicts, 50),
      missingInformation: take(extraction.missingInformation, 50),
      extractionLimitations: take(extraction.extractionLimitations, 30),
      confidence: extraction.confidence || null,
    },
  };
}

function departmentInstructions(task, employee, hasExtractedEvidence) {
  const common = [
    "You are an AI employee inside Mason Forge, a construction project intelligence system.",
    "Work only from the supplied evidence. Never invent plan details, quantities, dates, parties, legal facts, or project conclusions.",
    hasExtractedEvidence
      ? "Structured source-document evidence is supplied. Cite source file IDs, file names, sheet references, specification sections, and exact values whenever available."
      : "Only file-register metadata is available. Produce an intake-stage deliverable and state every evidence limitation explicitly.",
    "Do not claim a takeoff, RFI, legal conclusion, schedule forecast, or due-diligence finding is complete without sufficient source evidence.",
    "Return valid JSON with keys: summary, verifiedFacts, limitations, findings, recommendedNextActions, evidenceRegister, confidence.",
    "Every finding must include its evidence source. All consequential actions require human review.",
  ];
  const specialized = {
    "Project File Department": "Classify documents, identify likely revisions and duplicates, reconcile the document register, and flag unreadable or missing source material.",
    "Project Investigation Department": "Identify evidence-backed risks, conflicts, missing information, project-party verification needs, permit or legal research needs, and candidate RFIs.",
    "Project Takeoff Department": "Identify measurable scopes, plan/detail/spec references, measurement prerequisites, and blockers. Create quantities only when the supplied evidence supports them.",
    "Project Contact Department": "Identify and reconcile owners, developers, architects, engineers, contractors, municipalities, vendors, and other contacts. Separate verified contact facts from inferences.",
    "Project Communications Department": "Prepare draft RFIs, clarification requests, bidder communications, and internal summaries from approved evidence. Never send communications.",
  };
  return [...common, specialized[task.department] || "Create an honest evidence-backed department work product.", `Employee job description: ${employee?.job_description_json || task.instructions}`].join("\n");
}

async function readExtractionRecords(env, files, limit = 25) {
  const records = [];
  for (const file of files) {
    if (records.length >= limit) break;
    if (!file.extracted_text_key) continue;
    const object = await env.PROJECT_FILES.get(file.extracted_text_key);
    if (!object) {
      records.push({ sourceFile: { id: file.id, fileName: file.file_name }, error: "Extraction record missing from R2." });
      continue;
    }
    try {
      records.push(compactEvidenceRecord(JSON.parse(await object.text())));
    } catch (error) {
      records.push({
        sourceFile: { id: file.id, fileName: file.file_name },
        error: `Extraction record could not be parsed: ${error.message}`,
      });
    }
  }
  return records;
}

async function callOpenAI(env, task, project, employee, files, evidenceRecords) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(Number(env.OPENAI_REQUEST_TIMEOUT_MS || 600000)),
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
      "x-client-request-id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5-mini",
      input: [
        { role: "system", content: departmentInstructions(task, employee, evidenceRecords.length > 0) },
        {
          role: "user",
          content: JSON.stringify({
            task: {
              id: task.id,
              department: task.department,
              workstream: task.workstream,
              title: task.title,
              instructions: task.instructions,
              sourceFileIds: JSON.parse(task.source_file_ids_json || "[]"),
            },
            project,
            fileRegister: files.map((file) => ({
              id: file.id,
              fileName: file.file_name,
              relativePath: file.relative_path,
              fileType: file.file_type,
              sizeBytes: file.size_bytes,
              revision: file.revision,
              documentDate: file.document_date,
              reviewStatus: file.review_status,
              extractionKey: file.extracted_text_key,
            })),
            extractedEvidence: evidenceRecords,
          }),
        },
      ],
      text: { format: { type: "json_object" } },
      max_output_tokens: 6000,
      metadata: { task_id: task.id, project_id: String(task.project_id), department: task.department },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${payload?.error?.message || JSON.stringify(payload)}`);
  }
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error("OpenAI returned no output text.");
  return { payload, content: safeJson(outputText) };
}

async function event(env, task, previousStatus, newStatus, message, metadata = {}) {
  await env.DB.prepare(`
    INSERT INTO task_events
      (id, task_id, project_id, event_type, previous_status, new_status, message, metadata_json, created_at)
    VALUES (?, ?, ?, 'STATUS', ?, ?, ?, ?, ?)
  `).bind(id("event"), task.id, task.project_id, previousStatus, newStatus, message, JSON.stringify(metadata), now()).run();
}

export async function processDepartmentTask(message, env) {
  const task = await env.DB.prepare("SELECT * FROM department_tasks WHERE id = ?").bind(message.taskId).first();
  if (!task || ["COMPLETED", "CANCELED"].includes(task.status)) return { skipped: true };
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

  const startedAt = now();
  const claim = await env.DB.prepare(`
    UPDATE department_tasks
    SET status = 'RUNNING', attempt_count = attempt_count + 1, progress_percent = 10,
        blocked_reason = NULL, started_at = COALESCE(started_at, ?), heartbeat_at = ?, updated_at = ?
    WHERE id = ? AND status = 'QUEUED'
  `).bind(startedAt, startedAt, startedAt, task.id).run();
  if (Number(claim.meta?.changes || 0) === 0) return { skipped: true, reason: "Task was already claimed." };
  await event(env, task, "QUEUED", "RUNNING", "Cloud worker claimed assignment.");

  let sourceFileIds = [];
  try {
    sourceFileIds = JSON.parse(task.source_file_ids_json || "[]");
  } catch {
    sourceFileIds = [];
  }
  sourceFileIds = sourceFileIds.slice(0, 50);

  const fileQuery = sourceFileIds.length
    ? `SELECT id, file_name, relative_path, file_type, size_bytes, sha256, revision, document_date, review_status, extracted_text_key, source_class, uploaded_at FROM project_files WHERE project_id = ? AND id IN (${sourceFileIds.map(() => "?").join(",")}) ORDER BY relative_path`
    : "SELECT id, file_name, relative_path, file_type, size_bytes, sha256, revision, document_date, review_status, extracted_text_key, source_class, uploaded_at FROM project_files WHERE project_id = ? ORDER BY CASE WHEN extracted_text_key IS NOT NULL THEN 0 ELSE 1 END, relative_path LIMIT 250";

  const [project, employee, filesResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(task.project_id).first(),
    env.DB.prepare("SELECT * FROM ai_employees WHERE id = ?").bind(task.employee_id).first(),
    env.DB.prepare(fileQuery).bind(task.project_id, ...sourceFileIds).all(),
  ]);
  if (!project) throw new Error(`Project ${task.project_id} was not found.`);

  await env.DB.prepare("UPDATE department_tasks SET progress_percent = 35, heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'RUNNING'")
    .bind(now(), now(), task.id).run();

  const files = filesResult.results || [];
  const evidenceRecords = await readExtractionRecords(env, files, 25);

  await env.DB.prepare("UPDATE department_tasks SET progress_percent = 60, heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'RUNNING'")
    .bind(now(), now(), task.id).run();

  const { payload, content } = await callOpenAI(env, task, project, employee, files, evidenceRecords);
  const completedAt = now();
  const outputId = id("output");
  const outputType = `${task.department.toUpperCase()} ${evidenceRecords.length ? "EVIDENCE ANALYSIS" : "INTAKE ANALYSIS"}`;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT OR IGNORE INTO department_outputs
        (id, task_id, project_id, employee_id, output_type, title, content_json,
         evidence_register_json, confidence, human_review_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUIRED', ?, ?)
    `).bind(
      outputId,
      task.id,
      task.project_id,
      task.employee_id,
      outputType,
      `${task.department} — ${evidenceRecords.length ? "evidence-backed analysis" : "preliminary project intake analysis"}`,
      JSON.stringify(content),
      JSON.stringify(content.evidenceRegister || files.map((file) => ({ fileId: file.id, relativePath: file.relative_path, extractionKey: file.extracted_text_key || null }))),
      content.confidence || (evidenceRecords.length ? "EVIDENCE REVIEW REQUIRED" : "PRELIMINARY"),
      completedAt,
      completedAt,
    ),
    env.DB.prepare(`
      UPDATE department_tasks
      SET status = 'COMPLETED', progress_percent = 100, heartbeat_at = ?, completed_at = ?,
          blocked_reason = NULL, updated_at = ?
      WHERE id = ? AND status = 'RUNNING'
    `).bind(completedAt, completedAt, completedAt, task.id),
  ]);

  await event(env, task, "RUNNING", "COMPLETED", "Department output created and stored for human review.", {
    outputId,
    openaiResponseId: payload.id || null,
    model: payload.model || env.OPENAI_MODEL || "gpt-5-mini",
    fileCount: files.length,
    evidenceRecordCount: evidenceRecords.length,
  });
  return { taskId: task.id, outputId, evidenceRecordCount: evidenceRecords.length };
}

export async function failDepartmentTask(message, env, error) {
  const task = await env.DB.prepare("SELECT * FROM department_tasks WHERE id = ?").bind(message.taskId).first();
  if (!task || ["COMPLETED", "CANCELED"].includes(task.status)) return { retry: false };
  const attempts = Number(task.attempt_count || 0);
  const maxAttempts = Number(task.max_attempts || 5);
  const retry = attempts < maxAttempts;
  const status = retry ? "QUEUED" : "FAILED";
  const timestamp = now();
  await env.DB.prepare(`
    UPDATE department_tasks
    SET status = ?, blocked_reason = ?, heartbeat_at = ?, updated_at = ?
    WHERE id = ? AND status = 'RUNNING'
  `).bind(status, String(error?.message || error).slice(0, 2000), timestamp, timestamp, task.id).run();
  await event(env, task, task.status, status, retry ? "Task failed and will retry." : "Task exhausted retries and failed.", {
    error: String(error?.stack || error).slice(0, 4000),
    attemptCount: attempts,
    maxAttempts,
  });
  return { retry };
}
