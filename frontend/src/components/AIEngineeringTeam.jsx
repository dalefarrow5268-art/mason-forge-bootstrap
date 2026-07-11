export default function AIEngineeringTeam() {
  const divisions = [
    {
      id: 1,
      title: "Mission Control",
      lead: "Mason Forge Core",
      status: "Online",
    },
    {
      id: 2,
      title: "Knowledge Engine",
      lead: "Engineering Intelligence",
      status: "Online",
    },
    {
      id: 3,
      title: "Engineering Planner",
      lead: "Planning Department",
      status: "Ready",
    },
    {
      id: 4,
      title: "AI Workforce Manager",
      lead: "Engineering Operations",
      status: "Ready",
    },
    {
      id: 5,
      title: "Approval Queue",
      lead: "Executive Review",
      status: "Ready",
    },
    {
      id: 6,
      title: "Prompt Library",
      lead: "Engineering Knowledge",
      status: "Ready",
    },
    {
      id: 7,
      title: "Git Bridge",
      lead: "Version Control",
      status: "Offline",
    },
    {
      id: 8,
      title: "VS Code Bridge",
      lead: "Local Development",
      status: "Offline",
    },
    {
      id: 9,
      title: "Verification Engine",
      lead: "Quality Assurance",
      status: "Ready",
    },
    {
      id: 10,
      title: "Deployment Bridge",
      lead: "Release Operations",
      status: "Ready",
    },
    {
      id: 11,
      title: "Local AI Integration",
      lead: "AI Infrastructure",
      status: "Offline",
    },
    {
      id: 12,
      title: "Human Approval Gate",
      lead: "Executive Oversight",
      status: "Required",
    },
  ];

  return (
    <section>
      <p className="section-label">
        12 Engineering Systems • Mason Forge Milestone 2
      </p>

      <h2>Engineering Organization</h2>

      <div className="team-grid">
        {divisions.map((division) => (
          <div className="team-card" key={division.id}>
            <h3>{division.title}</h3>

            <p>{division.lead}</p>

            <span className="team-status">
              {division.status === "Offline"
                ? "⚪"
                : division.status === "Required"
                ? "🟡"
                : "🟢"}{" "}
              {division.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}