const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const departmentWork = [
  {
    employeeId: "peter-files",
    department: "Project File Department",
    workstream: "DOCUMENT CONTROL",
    title: "Classify and reconcile extracted project evidence",
    instructions: "Review extracted evidence, classify document type, identify revisions and duplicates, update the document register, and identify missing or unreadable source material. Cite source file IDs and do not invent document relationships.",
    priority: 95,
  },
  {
    employeeId: "mason-holmes",
    department: "Project Investigation Department",
    workstream: "EVIDENCE INVESTIGATION",
    title: "Investigate risks, conflicts, and missing project information",
    instructions: "Use extracted evidence to identify plan/spec conflicts, missing information, project-party verification needs, permit or legal research needs, and candidate RFIs. Create findings only when supported by source evidence.",
    priority: 94,
  },
  {
    employeeId: "tommy-takeoff",
    department: "Project Takeoff Department",
    workstream: "TAKEOFF EVIDENCE REVIEW",
    title: "Prepare evidence-backed takeoff work plan",
    instructions: "Use extracted evidence to identify measurable scopes, plan and detail references, specification sections, measurement prerequisites, and blockers. Do not create quantities unless the source provides enough measurable information.",
    priority: 93,
  },
  {
    employeeId: "carol-contacts",
    department: "Project Contact Department",
    workstream: "PROJECT RELATIONSHIPS",
    title: "Reconcile project parties and contact evidence",
    instructions: "Use extracted evidence to identify owners, developers, architects, engineers, contractors, municipalities, vendors, and other project contacts. Separate verified contacts from inferred roles and flag missing contact fields.",
    priority: 92,
  },
  {
    employeeId: "eddie-email",
    department: "Project Communications Department",
    workstream: "COMMUNICATIONS PREPARATION",
    title: "Prepare evidence-backed communication drafts",
    instructions: "Use extracted evidence and approved findings to prepare draft RFIs, clarification requests, bidder communications, or internal summaries. Never send communications; all outputs require human approval.",
    priority: 91,
  },
];

export async function routeExtractedEvidence(file, extractionKey, env) {
  const timestamp = now();
  const existing = await env.DB.prepare(`
    SELECT department FROM department_tasks
    WHERE project_id = ?
      AND workstream IN ('DOCUMENT CONTROL','EVIDENCE INVESTIGATION','TAKEOFF EVIDENCE REVIEW','PROJECT RELATIONSHIPS','COMMUNICATIONS PREPARATION')
      AND source_file_ids_json = ?
      AND status IN ('QUEUED','RUNNING','COMPLETED','BLOCKED')
  `).bind(file.project_id, JSON.stringify([file.id])).all();
  const existingDepartments = new Set((existing.results || []).map((row) => row.department));

  const tasks = departmentWork
    .filter((work) => !existingDepartments.has(work.department))
    .map((work) => {
      const taskId = id("task");
      return {
        taskId,
        message: {
          kind: "DEPARTMENT_TASK",
          taskId,
          projectId: file.project_id,
          employeeId: work.employeeId,
          department: work.department,
          extractionKeys: [extractionKey],
        },
        statement: env.DB.prepare(`
          INSERT INTO department_tasks
            (id, project_id, employee_id, department, workstream, title, instructions,
             priority, status, source_file_ids_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
        `).bind(
          taskId,
          file.project_id,
          work.employeeId,
          work.department,
          work.workstream,
          work.title,
          work.instructions,
          work.priority,
          JSON.stringify([file.id]),
          timestamp,
          timestamp,
        ),
      };
    });

  if (!tasks.length) return { tasksQueued: 0 };
  await env.DB.batch(tasks.map((task) => task.statement));
  await env.DEPARTMENT_QUEUE.sendBatch(tasks.map((task) => ({ body: task.message })));
  return { tasksQueued: tasks.length, taskIds: tasks.map((task) => task.taskId) };
}
