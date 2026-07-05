import forgeLogo from "../assets/brand/mason-forge/Mason-Forge-logo-and-word-mark-white-clear-bg.svg";

export default function Header() {
  return (
    <header className="header">
      <div className="header-brand">
        <img
          src={forgeLogo}
          alt="Mason Forge™"
          className="forge-logo"
          draggable="false"
        />

        <p className="header-subtitle">
          Engineering Operating System for SubSource Exchange™
        </p>
      </div>

      <div className="header-status">
        <div className="header-badge">
          <span className="status-dot"></span>
          All Systems Operational
        </div>

        <div className="header-badge">SSX Connected</div>

        <div className="header-version">
          Foundation Build • Milestone 1
        </div>
      </div>
    </header>
  );
}