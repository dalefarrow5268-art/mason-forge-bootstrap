export default function AIEngineeringTeam() {
  const title = "Mason Forge™ Engineering Divisions";
  const onlineDivisions = 7;
  const systemStatus = "All Systems Operational";

  const team = [
    {
      id: 1,
      role: "Chief Engineering Intelligence",
      name: "Mason Forge™ Core",
      status: "🟢 Online",
    },
    {
      id: 2,
      role: "Knowledge Engine",
      name: "Engineering Memory",
      status: "🟢 Ready",
    },
    {
      id: 3,
      role: "Build Engine",
      name: "Code Generation",
      status: "🟢 Ready",
    },
    {
      id: 4,
      role: "Validation Engine",
      name: "Quality Assurance",
      status: "🟢 Ready",
    },
    {
      id: 5,
      role: "Deployment Engine",
      name: "Release Operations",
      status: "🟢 Ready",
    },
    {
      id: 6,
      role: "Brand Intelligence",
      name: "SSX Design System",
      status: "🟢 Ready",
    },
    {
      id: 7,
      role: "Human Approval",
      name: "Final Decision Layer",
      status: "🟢 Required",
    },
  ];

  return (
    <section>
      <p className="section-label">
        {onlineDivisions} Engineering Divisions • {systemStatus}
      </p>

      <h2>{title}</h2>

      <div className="team-grid">
        {team.map((member) => (
          <div className="team-card" key={member.id}>
            <h3>{member.role}</h3>
            <p>{member.name}</p>
            <span className="team-status">{member.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}