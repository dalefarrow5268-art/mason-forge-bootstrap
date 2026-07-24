import { useEffect, useState } from "react";
import { getMasonCloudBootstrap } from "../services/masonCloud";

export default function CloudOperationsPanel() {
  const [state, setState] = useState({ loading: true, data: null, error: "" });

  useEffect(() => {
    let active = true;
    getMasonCloudBootstrap()
      .then((data) => active && setState({ loading: false, data, error: "" }))
      .catch((error) => active && setState({ loading: false, data: null, error: error.message }));
    return () => { active = false; };
  }, []);

  if (state.loading) return <section className="engineering-planner"><h2>Cloud Operations</h2><p>Loading verified Mason Forge state…</p></section>;
  if (state.error) return <section className="engineering-planner"><p className="section-label">Cloud Operations</p><h2>Connection Required</h2><p>{state.error}</p><p>Configure the protected dashboard API environment before deployment.</p></section>;

  const projects = state.data?.projects || [];
  const totals = Object.fromEntries((state.data?.taskTotals || []).map((row) => [row.status, Number(row.count)]));

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div><p className="section-label">Verified Cloud State</p><h2>Mason Forge Operations</h2><p className="engineering-planner-subtitle">Live D1 task, output, and Continuity Ledger evidence.</p></div>
        <div className="engineering-planner-status">{state.data?.continuity?.verification_status || "UNVERIFIED"}</div>
      </div>
      <div className="engineering-planner-grid">
        <article className="engineering-planner-card"><span className="engineering-planner-card-label">Running</span><strong className="engineering-planner-card-value">{totals.RUNNING || 0}</strong><p>Assignments with execution evidence.</p></article>
        <article className="engineering-planner-card"><span className="engineering-planner-card-label">Completed Outputs</span><strong className="engineering-planner-card-value">{state.data?.outputCount || 0}</strong><p>Durable department deliverables stored.</p></article>
        <article className="engineering-planner-card"><span className="engineering-planner-card-label">Queued</span><strong className="engineering-planner-card-value">{totals.QUEUED || 0}</strong><p>Waiting for worker execution.</p></article>
      </div>
      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header"><div><h3>Project Processing Status</h3><p>Only RUNNING tasks and stored outputs count as active work.</p></div></div>
        <table className="planner-table"><thead><tr><th>Project</th><th>Files</th><th>Running</th><th>Queued</th><th>Completed</th><th>Failed</th></tr></thead>
          <tbody>{projects.map((project) => <tr key={project.id}><td><strong>{project.name}</strong></td><td>{project.file_count || 0}</td><td>{project.running_tasks || 0}</td><td>{project.queued_tasks || 0}</td><td>{project.completed_tasks || 0}</td><td>{project.failed_tasks || 0}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
