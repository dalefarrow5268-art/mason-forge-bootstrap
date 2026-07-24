const now = () => new Date().toISOString();

export async function recoverQueuedDepartmentTasks(env) {
  const queued = await env.DB.prepare(`
    SELECT id, project_id, employee_id, department, updated_at
    FROM department_tasks
    WHERE status = 'QUEUED'
      AND datetime(updated_at) < datetime('now', '-3 minutes')
    ORDER BY priority DESC, created_at
    LIMIT 50
  `).all();

  let resent = 0;
  for (const task of queued.results || []) {
    const timestamp = now();
    const claim = await env.DB.prepare(`
      UPDATE department_tasks
      SET blocked_reason = 'QUEUED MESSAGE RECOVERY', updated_at = ?
      WHERE id = ? AND status = 'QUEUED' AND updated_at = ?
    `).bind(timestamp, task.id, task.updated_at).run();

    if (Number(claim.meta?.changes || 0) === 0) continue;

    await env.DEPARTMENT_QUEUE.send({
      kind: 'DEPARTMENT_TASK',
      taskId: task.id,
      projectId: task.project_id,
      employeeId: task.employee_id,
      department: task.department,
      recovery: 'STRANDED_QUEUED_TASK',
    });
    resent += 1;
  }

  return { resent };
}
