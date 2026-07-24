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

function departmentInstructions(task, employee) {
  const common = [
    "You are an AI employee inside Mason Forge, a construction project intelligence system.",
    "Work only from the evidence supplied. Never invent plan details, quantities, legal facts, or project conclusions.",
    "This phase has file-register metadata but not extracted document text. Produce a substantive intake-stage deliverable that identifies what can be established now, what cannot yet be established, and the exact next processing steps.",
    "Do not claim a takeoff, RFI, legal conclusion, schedule forecast, or due-diligence finding is complete without source evidence.",
    "Return valid JSON with keys: summary, verifiedFacts, limitations, findings, recommendedNextActions, evidenceRegister, confidence.",
  ];

  const specialized = {
    "Project File Department": "Create a file-register assessment: document counts, file-type/path patterns, likely document groups, duplicate/revision risks, indexing priorities, and a document-extraction work plan.",
    "Project Investigation Department": "Create a preliminary investigation plan: likely risk workstreams, missing evidence, project-party verification needs, permit/municipality research tasks, plan/spec conflict review sequence, and evidence standards.",
    "Project Takeoff Department": "Create a takeoff-readiness report: drawing/spec discovery needs, trade breakdown, measurement prerequisites, likely sheet classification workflow, quality controls, and explicit blockers to measured quantities.",
    "Project Contact Department": "Create a project-relationship intake report: likely stakeholder/contact categories, missing contact evidence, bidder-status data needs, municipality/design-team outreach sequence, and human-review gates.",
    "Project Communications Department": "Create a communications-readiness report: draft communication categories, missing recipients/context, approval requirements, RFI/bidder follow-up workflow, and no-send safeguards.",
  };

  return [...common, specialized[task.department] || "Create an honest preliminary department work product.", `Employee job description: ${employee?.job_description_json || task.instructions}`].join("\n");
}

async function callOpenAI(env, task, project, employee, files) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5-mini",
      input: [
        { role: "system", content: departmentInstructions(task, employee) },
        {
          role: "user",
          content: JSON.stringify({
            task: {
              id: task.id,
              department: task.department,
              workstream: task.workstream,
              title: task.title,
              instructions: task.instructions,
            },
            project,
            fileRegister: files,
          }),
        },
      ],
      text: { format: { type: "json_object" } },
      max_output_tokens: 5000,
      metadata: { task_id: task.id, project_id: String(task.project_id), department: task.department },
    }),
  });

  const payload = await response.json();
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
  await env.DB.prepare(`
    UPDATE department_tasks
    SET status = 'RUNNING', attempt_count = attempt_count + 1, progress_percent = 10,
        blocked_reason = NULL, started_at = COALESCE(started_at, ?), heartbeat_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(startedAt, startedAt, startedAt, task.id).run();
  await event(env, task, task.status, "RUNNING", "Cloud worker claimed assignment.");

  const [project, employee, filesResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(task.project_id).first(),
    env.DB.prepare("SELECT * FROM ai_employees WHERE id = ?").bind(task.employee_id).first(),
    env.DB.prepare(`
      SELECT id, file_name, relative_path, file_type, size_bytes, sha256, revision,
             document_date, review_status, extracted_text_key, source_class, uploaded_at
      FROM project_files WHERE project_id = ? ORDER BY relative_path LIMIT 1000
    `).bind(task.project_id).all(),
  ]);
  if (!project) throw new Error(`Project ${task.project_id} was not found.`);

  await env.DB.prepare("UPDATE department_tasks SET progress_percent = 35, heartbeat_at = ?, updated_at = ? WHERE id = ?")
    .bind(now(), now(), task.id).run();

  const files = filesResult.results || [];
  const { payload, content } = await callOpenAI(env, task, project, employee, files);
  const completedAt = now();
  const outputId = id("output");
  const outputType = `${task.department.toUpperCase()} INTAKE ANALYSIS`;

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO department_outputs
        (id, task_id, project_id, employee_id, output_type, title, content_json,
         evidence_register_json, confidence, human_review_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REQUIRED', ?, ?)
    `).bind(
      outputId,
      task.id,
      task.project_id,
      task.employee_id,
      outputType,
      `${task.department} — preliminary project intake analysis`,
      JSON.stringify(content),
      JSON.stringify(content.evidenceRegister || files.map((file) => ({ fileId: file.id, relativePath: file.relative_path }))),
      content.confidence || "PRELIMINARY",
      completedAt,
      completedAt,
    ),
    env.DB.prepare(`
      UPDATE department_tasks
      SET status = 'COMPLETED', progress_percent = 100, heartbeat_at = ?, completed_at = ?,
          blocked_reason = NULL, updated_at = ?
      WHERE id = ?
    `).bind(completedAt, completedAt, completedAt, task.id),
  ]);

  await event(env, task, "RUNNING", "COMPLETED", "Department output created and stored for human review.", {
    outputId,
    openaiResponseId: payload.id || null,
    model: payload.model || env.OPENAI_MODEL || "gpt-5-mini",
    fileCount: files.length,
  });
  return { taskId: task.id, outputId };
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
    WHERE id = ?
  `).bind(status, String(error?.message || error).slice(0, 2000), timestamp, timestamp, task.id).run();
  await event(env, task, task.status, status, retry ? "Task failed and will retry." : "Task exhausted retries and failed.", {
    error: String(error?.stack || error).slice(0, 4000),
    attemptCount: attempts,
    maxAttempts,
  });
  return { retry };
}
