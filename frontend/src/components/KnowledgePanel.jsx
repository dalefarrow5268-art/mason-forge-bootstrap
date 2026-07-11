import { masonCore } from "../core";

export default function KnowledgePanel() {
  const knowledge = masonCore.knowledgeHealth();
  const metrics = knowledge.metrics ?? {};

  return (
    <section>
      <p className="section-label">
        Mason Forge Intelligence
      </p>

      <h2>Knowledge Dashboard</h2>

      <div className="status-grid">
        <div className="status-card">
          <h3>Status</h3>
          <p>🟢 {knowledge.status}</p>
        </div>

        <div className="status-card">
          <h3>Knowledge Records</h3>
          <p>{knowledge.records}</p>
        </div>

        <div className="status-card">
          <h3>Engineering Searches</h3>
          <p>{metrics.searches ?? 0}</p>
        </div>

        <div className="status-card">
          <h3>Reusable Assets</h3>
          <p>{metrics.assets ?? 0}</p>
        </div>

        <div className="status-card">
          <h3>Engineering Plans</h3>
          <p>{metrics.plans ?? 0}</p>
        </div>

        <div className="status-card">
          <h3>Prompt Templates</h3>
          <p>{metrics.prompts ?? 0}</p>
        </div>

        <div className="status-card">
          <h3>AI Workforce</h3>
          <p>7 Online</p>
        </div>

        <div className="status-card">
          <h3>Last Updated</h3>
          <p>{metrics.lastUpdated ?? "Never"}</p>
        </div>
      </div>

      <div className="pipeline-card">
        <div className="pipeline-header">
          <strong>Engineering Knowledge Engine</strong>
          <span>Operational</span>
        </div>

        <p>
          The Knowledge Engine is the central intelligence layer of Mason
          Forge. It stores engineering knowledge, reusable prompts, planning
          history, AI decisions, verification results, deployment history,
          reusable code, and organizational memory so every engineering system
          can continuously improve over time.
        </p>
      </div>
    </section>
  );
}