import { ForgeInfo } from "../core";

export default function ProjectStatus() {
  const platformItems = [
    {
      label: "Platform",
      value: "SubSource Exchange™",
    },
    {
      label: "Status",
      value: ForgeInfo.platformHealth,
      status: true,
    },
    {
      label: "Milestone",
      value: ForgeInfo.milestone,
    },
    {
      label: "Phase",
      value: "Shared Systems Integration",
    },
    {
      label: "Environment",
      value: "Local Development",
    },
    {
      label: "Repository",
      value: "mason-forge-bootstrap",
    },
    {
      label: "Branch",
      value: "main",
    },
    {
      label: "Deployment",
      value: "Ready",
    },
    {
      label: "Engineering Systems",
      value: `${ForgeInfo.systems.length} Active`,
    },
    {
      label: "AI Workforce",
      value: `${ForgeInfo.engineeringAgents} Engineers`,
    },
    {
      label: "Approval Gate",
      value: "Enabled",
    },
    {
      label: "Local AI",
      value: "Ready for Connection",
    },
  ];

  return (
    <section>
      <h2>Platform Status</h2>

      <div className="status-grid">
        {platformItems.map((item) => (
          <div className="status-card" key={item.label}>
            <h3>{item.label}</h3>

            <p>
              {item.status && <span className="status-dot" />}
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}