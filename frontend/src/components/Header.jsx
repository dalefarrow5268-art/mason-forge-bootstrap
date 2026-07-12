import forgeLogo from "../assets/brand/mason-forge/Mason-Forge-logo-and-word-mark-white-clear-bg.svg";
import { ForgeInfo } from "../core";

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

        <div className="header-brand-copy">
          <h1>{ForgeInfo.name}</h1>
          <p>Engineering Operating System</p>
          <span>Powered by SubSource Exchange™</span>
        </div>
      </div>

      <div className="header-overview">
        <div className="header-overview-item">
          <span>Current Mission</span>
          <strong>Build the SSX Engineering Platform</strong>
        </div>

        <div className="header-overview-item">
          <span>Milestone</span>
          <strong>{ForgeInfo.milestone}</strong>
        </div>

        <div className="header-overview-item">
          <span>Engineering Systems</span>
          <strong>{ForgeInfo.systems.length} Active</strong>
        </div>

        <div className="header-overview-item">
          <span>AI Workforce</span>
          <strong>{ForgeInfo.engineeringAgents} Engineers</strong>
        </div>
      </div>

      <div className="header-system-status">
        <div className="system-status-heading">
          <span className="status-dot" />
          <strong>All Systems Operational</strong>
        </div>

        <span>Mason Core Online</span>
        <span>Knowledge Engine Ready</span>
        <span>Local AI Ready for Connection</span>
        <span>Human Approval Required</span>
      </div>
    </header>
  );
}