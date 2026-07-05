export default function Sidebar({ page, setPage }) {
  const menuItems = [
    {
      icon: "🏠",
      label: "Mission Control",
      id: "mission",
    },
    {
      icon: "🧠",
      label: "Knowledge Engine",
      id: "engineering",
    },
    {
      icon: "⚒️",
      label: "Build Engine",
      id: "pipeline",
    },
    {
      icon: "✅",
      label: "Validation Engine",
      id: "analytics",
    },
    {
      icon: "🚀",
      label: "Deployment Engine",
      id: "deployments",
    },
    {
      icon: "📋",
      label: "SSX Projects",
      id: "projects",
    },
    {
      icon: "⚙️",
      label: "Platform Settings",
      id: "settings",
    },
  ];

  return (
    <aside>
      <h2>Mason Forge™</h2>

      <p className="sidebar-subtitle">
        Engineering Intelligence Platform
      </p>

      <nav>
        {menuItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPage(item.id)}
            className={`nav-item ${page === item.id ? "active" : ""}`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}