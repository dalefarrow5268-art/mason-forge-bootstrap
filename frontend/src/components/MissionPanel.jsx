import { ForgeInfo } from "../core";

export default function MissionPanel() {
  const stats = [
    {
      title: "Engineering Systems",
      value: ForgeInfo.systems.length,
      subtitle: "Active",
    },
    {
      title: "AI Workforce",
      value: ForgeInfo.engineeringAgents,
      subtitle: "Engineering Agents",
    },
    {
      title: "Platform Health",
      value: "100%",
      subtitle: ForgeInfo.platformHealth,
    },
    {
      title: "Human Approval",
      value: "Enabled",
      subtitle: "Required",
    },
  ];

  return (
    <section className="mission-panel">
      <div className="mission-header">
        <div>
          <p className="section-label">Mission Control</p>

          <h2>Engineering Operating System</h2>

          <p className="mission-subtitle">
            Mason Forge™ coordinates every engineering department responsible
            for planning, building, validating, deploying, and continuously
            improving SubSource Exchange™.
          </p>
        </div>

        <div className="mission-status">
          <span className="status-dot" />
          {ForgeInfo.milestone} Active
        </div>
      </div>

      <div className="mission-objective">
        <h3>Current Objective</h3>

        <p>
          Transform Mason Forge from a dashboard into an autonomous engineering
          operating system where specialized AI teams collaborate, every
          significant action is verified, and every production release requires
          human approval.
        </p>
      </div>

      <div className="metrics-grid">
        {stats.map((stat) => (
          <div className="metric-card" key={stat.title}>
            <small>{stat.title}</small>
            <h2>{stat.value}</h2>
            <span>{stat.subtitle}</span>
          </div>
        ))}
      </div>

      <div className="mission-footer">
        <div>
          <strong>Current Milestone</strong>
          <p>{ForgeInfo.milestone} — Shared Systems Integration</p>
        </div>

        <div>
          <strong>Primary Mission</strong>
          <p>Build the SSX Engineering Operating System</p>
        </div>

        <div>
          <strong>Operating Mode</strong>
          <p>{ForgeInfo.slogan}</p>
        </div>
      </div>
    </section>
  );
}