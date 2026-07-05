import { masonCore } from "../core";

export default function CoreStatusPanel() {
  const health = masonCore.health();

  return (
    <section>
      <h2>Mason Forge™ Core Status</h2>

      <div className="status-grid">
        <div className="status-card">
          <h3>Core Version</h3>
          <p>{health.version}</p>
        </div>

        <div className="status-card">
          <h3>Core Status</h3>
          <p>🟢 {health.status}</p>
        </div>

        <div className="status-card">
          <h3>Knowledge Engine</h3>
          <p>{health.knowledge?.status ?? "Standby"}</p>
        </div>

        <div className="status-card">
          <h3>Health Check</h3>
          <p>{health.status}</p>
        </div>
      </div>
    </section>
  );
}