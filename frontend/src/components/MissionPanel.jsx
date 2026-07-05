export default function MissionPanel() {
  const engineeringAgents = 7;
  const engineeringJobs = 5;
  const approvalQueue = 1;
  const platformHealth = "Operational";
  const missionStatus = "Engineering Operating System";

  return (
    <section className="mission-panel">
      <div className="mission-header">
        <div>
          <h2>Mission Control</h2>

          <p className="mission-subtitle">
            Mason Forge™ is building the Engineering Operating System for
            SubSource Exchange™.
          </p>
        </div>

        <div className="mission-status">
          {missionStatus}
        </div>
      </div>

      <p className="mission-text">
        Forge the engineering intelligence that designs, builds, validates,
        deploys, and continuously improves SSX while keeping humans at the
        center of every major decision.
      </p>

      <hr className="mission-divider" />

      <h3 className="section-label">Engineering Operations</h3>

      <div className="metrics-grid">
        <div className="metric-card">
          <h3>Engineering Agents</h3>
          <h2>{engineeringAgents}</h2>
          <small>All Divisions Online</small>
        </div>

        <div className="metric-card">
          <h3>Engineering Jobs</h3>
          <h2>{engineeringJobs}</h2>
          <small>5 Active Work Items</small>
        </div>

        <div className="metric-card">
          <h3>Platform Health</h3>
          <h2>{platformHealth}</h2>
          <small>100% Systems Online</small>
        </div>

        <div className="metric-card">
          <h3>Approval Queue</h3>
          <h2>{approvalQueue}</h2>
          <small>Human Review Required</small>
        </div>
      </div>
    </section>
  );
}