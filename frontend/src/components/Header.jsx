import forgeLogo from "../assets/brand/mason-forge/Mason-Forge-logo-and-word-mark-white-clear-bg.svg";

export default function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <img
          src={forgeLogo}
          alt="Mason Forge™"
          className="forge-logo"
          draggable="false"
        />

        <div className="header-brand">
          <h1>Mason Forge™</h1>

          <p className="header-subtitle">
            Engineering Operating System for SubSource Exchange™
          </p>
        </div>
      </div>

      <div className="header-center">
        <div className="header-card">
          <small>Mission</small>
          <strong>Build SSX Engineering Platform</strong>
        </div>

        <div className="header-card">
          <small>Milestone</small>
          <strong>Milestone 3</strong>
        </div>

        <div className="header-card">
          <small>Engineering Systems</small>
          <strong>11 Online</strong>
        </div>

        <div className="header-card">
          <small>AI Workforce</small>
          <strong>7 Engineers</strong>
        </div>

        <div className="header-card">
          <small>Core Version</small>
          <strong>v0.4.0</strong>
        </div>

        <div className="header-card">
          <small>Human Approval</small>
          <strong>Required</strong>
        </div>
      </div>

      <div className="header-right">
        <div className="header-status">
          <span className="status-dot"></span>
          All Systems Operational
        </div>

        <div className="header-status">
          🟢 Mason Core Online
        </div>

        <div className="header-status">
          🧠 Knowledge Engine Ready
        </div>

        <div className="header-status">
          🤖 Local AI Ready for Connection
        </div>

        <div className="header-status">
          🔒 Human Approval Required
        </div>
      </div>
    </header>
  );
}