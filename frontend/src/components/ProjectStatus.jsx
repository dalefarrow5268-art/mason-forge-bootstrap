export default function ProjectStatus() {
  const platform = {
    name: "SubSource Exchange™",
    status: "Operational",
    milestone: "Milestone 2",
    phase: "Engineering Operating System",
    environment: "Local Development",
    repository: "mason-forge-bootstrap",
    branch: "main",
    deployment: "Ready",
    engineeringSystems: "12",
    aiWorkforce: "7 Engineers",
    approvalGate: "Enabled",
    localAI: "Waiting for Connection",
  };

  return (
    <section>
      <h2>Platform Status</h2>

      <div className="status-grid">
        <div className="status-card">
          <h3>Platform</h3>
          <p>{platform.name}</p>
        </div>

        <div className="status-card">
          <h3>Status</h3>
          <p>🟢 {platform.status}</p>
        </div>

        <div className="status-card">
          <h3>Milestone</h3>
          <p>{platform.milestone}</p>
        </div>

        <div className="status-card">
          <h3>Phase</h3>
          <p>{platform.phase}</p>
        </div>

        <div className="status-card">
          <h3>Environment</h3>
          <p>{platform.environment}</p>
        </div>

        <div className="status-card">
          <h3>Repository</h3>
          <p>{platform.repository}</p>
        </div>

        <div className="status-card">
          <h3>Branch</h3>
          <p>{platform.branch}</p>
        </div>

        <div className="status-card">
          <h3>Deployment</h3>
          <p>{platform.deployment}</p>
        </div>

        <div className="status-card">
          <h3>Engineering Systems</h3>
          <p>{platform.engineeringSystems}</p>
        </div>

        <div className="status-card">
          <h3>AI Workforce</h3>
          <p>{platform.aiWorkforce}</p>
        </div>

        <div className="status-card">
          <h3>Approval Gate</h3>
          <p>{platform.approvalGate}</p>
        </div>

        <div className="status-card">
          <h3>Local AI</h3>
          <p>{platform.localAI}</p>
        </div>
      </div>
    </section>
  );
}