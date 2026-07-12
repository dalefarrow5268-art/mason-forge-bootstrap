import { ForgeInfo } from "../core";

const engineeringItems = [
  {
    icon: "⌂",
    label: "Mission Control",
    id: "mission",
  },
  {
    icon: "◆",
    label: "Knowledge Engine",
    id: "engineering",
  },
  {
    icon: "▤",
    label: "Engineering Planner",
    id: "planner",
  },
  {
    icon: "◉",
    label: "AI Workforce",
    id: "workforce",
  },
  {
    icon: "✓",
    label: "Approval Queue",
    id: "approvals",
  },
  {
    icon: "✦",
    label: "Prompt Library",
    id: "prompts",
  },
  {
    icon: "⌁",
    label: "Git Bridge",
    id: "pipeline",
  },
  {
    icon: "▣",
    label: "VS Code Bridge",
    id: "vscode",
  },
  {
    icon: "◇",
    label: "Verification Engine",
    id: "analytics",
  },
  {
    icon: "▲",
    label: "Deployment Bridge",
    id: "deployments",
  },
  {
    icon: "◎",
    label: "Local AI",
    id: "localai",
  },
  {
    icon: "◈",
    label: "Forge Status",
    id: "forge-status",
  },
];

const platformItems = [
  {
    icon: "▥",
    label: "SSX Projects",
    id: "projects",
  },
  {
    icon: "⚙",
    label: "Platform Settings",
    id: "settings",
  },
];

function NavigationItem({ item, page, setPage }) {
  const isActive = page === item.id;

  return (
    <button
      type="button"
      className={`nav-item ${isActive ? "active" : ""}`}
      onClick={() => setPage(item.id)}
      aria-current={isActive ? "page" : undefined}
      title={item.label}
    >
      <span className="nav-item-icon" aria-hidden="true">
        {item.icon}
      </span>

      <span className="nav-item-label">{item.label}</span>
    </button>
  );
}

export default function Sidebar({ page, setPage }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand-mark" aria-hidden="true">
          MF
        </div>

        <div className="sidebar-brand-content">
          <h2>Mason Forge™</h2>
          <p className="sidebar-subtitle">Engineering Operating System</p>
        </div>
      </div>

      <div className="sidebar-divider" />

      <nav className="sidebar-navigation" aria-label="Mason Forge navigation">
        <div className="sidebar-nav-section">
          <p className="sidebar-section-label">Engineering Systems</p>

          {engineeringItems.map((item) => (
            <NavigationItem
              key={item.id}
              item={item}
              page={page}
              setPage={setPage}
            />
          ))}
        </div>

        <div className="sidebar-nav-section">
          <p className="sidebar-section-label">Platform</p>

          {platformItems.map((item) => (
            <NavigationItem
              key={item.id}
              item={item}
              page={page}
              setPage={setPage}
            />
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-system-status">
          <span className="status-dot" />

          <div>
            <strong>Mason Forge Online</strong>
            <small>{ForgeInfo.milestone} • Shared Systems Active</small>
          </div>
        </div>

        <div className="sidebar-version">
          Version {ForgeInfo.version}
        </div>
      </div>
    </aside>
  );
}