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
    <section className="mission-panel command-center">
      <div className="command-hero">
        <div className="command-hero-copy">
          <p className="section-label">Mason Forge Control Center</p>
          <h2>Every project.<br /><span>One intelligent command.</span></h2>
          <p className="mission-subtitle">
            Live engineering intelligence coordinates projects, people,
            evidence, schedules, risk, and decisions across SSX.
          </p>
          <div className="command-pulse">
            <span className="status-dot" />
            Mason Core online · verified system state
          </div>
        </div>

        <div className="command-hero-visual">
          <img src="/control-center/project-cockpit.jpg" alt="Mason Forge live project cockpit" />
          <div className="scan-line" aria-hidden="true" />
          <div className="visual-readout">
            <span>LIVE PROJECT SIGNAL</span>
            <strong>91%</strong>
            <small>System health</small>
          </div>
        </div>
      </div>

      <div className="command-metrics" aria-label="Mason Forge status">
        {stats.map((stat, index) => (
          <div className="command-metric" key={stat.title}>
            <span>0{index + 1}</span>
            <small>{stat.title}</small>
            <strong>{stat.value}</strong>
            <em>{stat.subtitle}</em>
          </div>
        ))}
      </div>

      <div className="command-deck">
        <article className="command-feature command-feature-wide">
          <img src="/control-center/project-health.jpg" alt="Live Mason Forge project health instrumentation" />
          <div className="command-feature-copy">
            <span>PROJECT INTELLIGENCE</span>
            <h3>See the first broken link before it becomes the next delay.</h3>
          </div>
        </article>
        <article className="command-feature">
          <img src="/control-center/project-schedule.jpg" alt="Mason Forge project schedule intelligence" />
          <div className="command-feature-copy">
            <span>SCHEDULE SIGNAL</span>
            <h3>Every dependency visible.</h3>
          </div>
        </article>
      </div>
    </section>
  );
}
