import { masonCore } from "../core";

export default function CoreStatusPanel() {
  const health = masonCore.health();

  const systems = [
    {
      name: "Core Engine",
      value: `🟢 ${health.status}`,
    },
    {
      name: "Version",
      value: health.version,
    },
    {
      name: "Knowledge Engine",
      value: health.knowledge?.status ?? "Standby",
    },
    {
      name: "Engineering Planner",
      value: "Ready",
    },
    {
      name: "AI Workforce",
      value: "7 Online",
    },
    {
      name: "Approval Queue",
      value: "Ready",
    },
    {
      name: "Prompt Library",
      value: "Ready",
    },
    {
      name: "Git Bridge",
      value: "Offline",
    },
    {
      name: "VS Code Bridge",
      value: "Offline",
    },
    {
      name: "Verification Engine",
      value: "Ready",
    },
    {
      name: "Deployment Bridge",
      value: "Ready",
    },
    {
      name: "Local AI",
      value: "Offline",
    },
  ];

  return (
    <section>
      <h2>Mason Forge™ Core Status</h2>

      <div className="status-grid">
        {systems.map((system) => (
          <div className="status-card" key={system.name}>
            <h3>{system.name}</h3>
            <p>{system.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}