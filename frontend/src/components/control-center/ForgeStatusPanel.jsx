import { ForgeInfo } from "../../core";

export default function ForgeStatusPanel() {
  const systems = [
    {
      name: "Mission Control",
      responsibility: "Engineering coordination",
      status: "Online",
    },
    {
      name: "Brand Assets",
      responsibility: "Mason Forge identity system",
      status: "Loaded",
    },
    {
      name: "Knowledge Engine",
      responsibility: "Permanent engineering memory",
      status: "Ready",
    },
    {
      name: "Engineering Planner",
      responsibility: "Structured build planning",
      status: "Ready",
    },
    {
      name: "AI Workforce",
      responsibility: "Engineering job execution",
      status: "Online",
    },
    {
      name: "Git Bridge",
      responsibility: "Repository version control",
      status: "Ready",
    },
    {
      name: "VS Code Bridge",
      responsibility: "Local workspace connection",
      status: "Ready",
    },
    {
      name: "Verification Engine",
      responsibility: "Testing and quality assurance",
      status: "Ready",
    },
    {
      name: "Deployment Bridge",
      responsibility: "Release operations",
      status: "Ready",
    },
    {
      name: "Local AI Integration",
      responsibility: "Local engineering models",
      status: "Ready for Connection",
    },
    {
      name: "Shared Event Bus",
      responsibility: "System communications",
      status: "Online",
    },
    {
      name: "Shared State Manager",
      responsibility: "Platform state control",
      status: "Online",
    },
    {
      name: "Workflow Coordinator",
      responsibility: "Cross-system workflows",
      status: "Online",
    },
    {
      name: "Human Approval Gate",
      responsibility: "Executive oversight",
      status: "Required",
    },
  ];

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <p className="section-label">Forge Control Center</p>
          <h2>Mason Forge™ System Status</h2>

          <p className="engineering-planner-subtitle">
            Monitor every engineering system supporting SubSource Exchange™.
          </p>
        </div>

        <div className="engineering-planner-status">
          {ForgeInfo.platformHealth}
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Engineering Systems
          </span>

          <strong className="engineering-planner-card-value">
            {systems.length}
          </strong>

          <p>Shared Mason Forge systems active.</p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Current Milestone
          </span>

          <strong className="engineering-planner-card-value">4</strong>

          <p>Shared Systems Integration.</p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Core Version
          </span>

          <strong className="engineering-planner-card-value">
            {ForgeInfo.version}
          </strong>

          <p>Mason Forge development release.</p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Engineering Systems</h3>

            <p>
              Current operating condition and responsibility of every shared
              Mason Forge system.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>System</th>
              <th>Responsibility</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {systems.map((system) => (
              <tr key={system.name}>
                <td>
                  <strong>{system.name}</strong>
                </td>

                <td>{system.responsibility}</td>
                <td>{system.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Operating Standard</h3>
            <p>{ForgeInfo.mission}</p>
          </div>
        </div>

        <div className="engineering-planner-empty-state">
          <strong>{ForgeInfo.slogan}</strong>
          <p>{ForgeInfo.motto}</p>
        </div>
      </div>
    </section>
  );
}