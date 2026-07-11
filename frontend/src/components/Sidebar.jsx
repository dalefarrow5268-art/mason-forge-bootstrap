import { ForgeInfo } from "../core";

const primaryItems = [
  {
    icon: "⌂",
    label: "Mission Control",
    id: "mission",
    description: "Platform command center",
  },
  {
    icon: "🧠",
    label: "Knowledge Engine",
    id: "engineering",
    description: "Engineering memory",
  },
  {
    icon: "📋",
    label: "Engineering Planner",
    id: "planner",
    description: "Engineering planning",
  },
  {
    icon: "👥",
    label: "AI Workforce",
    id: "workforce",
    description: "AI employee management",
  },
  {
    icon: "✔",
    label: "Approval Queue",
    id: "approvals",
    description: "Human review",
  },
  {
    icon: "💬",
    label: "Prompt Library",
    id: "prompts",
    description: "Reusable prompts",
  },
  {
    icon: "🔗",
    label: "Git Bridge",
    id: "pipeline",
    description: "Repository integration",
  },
  {
    icon: "💻",
    label: "VS Code Bridge",
    id: "vscode",
    description: "Local workspace",
  },
  {
    icon: "🧪",
    label: "Verification Engine",
    id: "analytics",
    description: "Testing and verification",
  },
  {
    icon: "🚀",
    label: "Deployment Bridge",
    id: "deployments",
    description: "Release operations",
  },
  {
    icon: "🤖",
    label: "Local AI",
    id: "localai",
    description: "AI lab integration",
  },
  {
    icon: "📡",
    label: "Forge Status",
    id: "forge-status",
    description: "Engineering systems",
  },
];

const platformItems = [
  {
    icon: "▤",
    label: "SSX Projects",
    id: "projects",
    description: "Active platform builds",
  },
  {
    icon: "⚙",
    label: "Platform Settings",
    id: "settings",
    description: "System configuration",
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
    >
      <span className="nav-item-icon" aria-hidden="true">
        {item.icon}
      </span>

      <span className="nav-item-content">
        <span className="nav-item-label">{item.label}</span>
        <span className="nav-item-description">{item.description}</span>
      </span>

      <span className="nav-item-indicator" aria-hidden="true">
        {isActive ? "●" : ""}
      </span>
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

          <p className="sidebar-subtitle">
            Engineering Operating System
          </p>
        </div>
      </div>

      <div className="sidebar-divider" />

      <nav className="sidebar-navigation" aria-label="Mason Forge navigation">
        <div className="sidebar-nav-section">
          <p className="sidebar-section-label">
            Engineering Systems
          </p>

          {primaryItems.map((item) => (
            <NavigationItem
              key={item.id}
              item={item}
              page={page}
              setPage={setPage}
            />
          ))}
        </div>

        <div className="sidebar-nav-section">
          <p className="sidebar-section-label">
            Platform
          </p>

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
            <small>
              {ForgeInfo.milestone} • Shared Systems Active
            </small>
          </div>
        </div>

        <div className="sidebar-version">
          Version {ForgeInfo.version}
        </div>
      </div>
    </aside>
  );
}