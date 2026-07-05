export default function ProjectStatus() {
  const title = "Platform Status";

  const project = {
    platform: "SubSource Exchange™",
    status: "🟢 Foundation Online",
    milestone: "Milestone 1 — Mason Forge Bootstrap",
    phase: "Engineering Operating System",
  };

  return (
    <section>
      <h2>{title}</h2>

      <div className="status-grid">
        <div className="status-card">
          <h3>Platform</h3>
          <p>{project.platform}</p>
        </div>

        <div className="status-card">
          <h3>Status</h3>
          <p>{project.status}</p>
        </div>

        <div className="status-card">
          <h3>Current Milestone</h3>
          <p>{project.milestone}</p>
        </div>

        <div className="status-card">
          <h3>Current Phase</h3>
          <p>{project.phase}</p>
        </div>
      </div>
    </section>
  );
}