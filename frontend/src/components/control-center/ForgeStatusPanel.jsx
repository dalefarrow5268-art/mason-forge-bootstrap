export default function ForgeStatusPanel() {
  const rows = [
    ["Mission Control", "Online"],
    ["Brand Assets", "Loaded"],
    ["Knowledge Engine", "Ready"],
    ["Build Engine", "Queued"],
    ["Validation Engine", "Queued"],
    ["Deployment Engine", "Planned"],
    ["Human Approval", "Required"],
  ];

  return (
    <aside className="forge-panel">
      <div className="forge-badge">
        🔨 Forge Control Center
      </div>

      <h2 className="forge-panel-title">
        Mason Forge™
      </h2>

      <p className="forge-panel-text">
        Engineering Operating System for SubSource Exchange™.
        <br />
        <strong>Forge it once. Reuse it forever.™</strong>
      </p>

      <div className="forge-status-list">
        {rows.map(([label, value]) => (
          <div
            className="forge-status-row"
            key={label}
          >
            <span>{label}</span>

            <span className="forge-status-value">
              {value}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}