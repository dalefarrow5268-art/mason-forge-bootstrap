import foundation from "./index.js";
import { failDepartmentTask, processDepartmentTask } from "./department-processor.js";

const now = () => new Date().toISOString();

async function recoverLegacyBlockedTasks(env) {
  const blocked = await env.DB.prepare(`
    SELECT id, project_id, employee_id, department
    FROM department_tasks
    WHERE status = 'BLOCKED'
      AND blocked_reason = 'SPECIALIZED PROCESSOR NOT YET DEPLOYED'
    ORDER BY priority DESC, created_at
    LIMIT 100
  `).all();

  for (const task of blocked.results || []) {
    const timestamp = now();
    await env.DB.prepare(`
      UPDATE department_tasks
      SET status = 'QUEUED', blocked_reason = NULL, updated_at = ?
      WHERE id = ?
    `).bind(timestamp, task.id).run();
    await env.DEPARTMENT_QUEUE.send({
      taskId: task.id,
      projectId: task.project_id,
      employeeId: task.employee_id,
      department: task.department,
    });
  }
  return blocked.results?.length || 0;
}

export default {
  fetch: foundation.fetch,

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processDepartmentTask(message.body, env);
        message.ack();
      } catch (error) {
        const result = await failDepartmentTask(message.body, env, error);
        if (result.retry) message.retry({ delaySeconds: 60 });
        else message.ack();
      }
    }
  },

  async scheduled(event, env, ctx) {
    await foundation.scheduled(event, env, ctx);
    await recoverLegacyBlockedTasks(env);
  },
};
