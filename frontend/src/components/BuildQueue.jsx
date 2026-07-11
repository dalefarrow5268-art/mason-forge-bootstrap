export default function BuildQueue() {
  const queue = [
    {
      id: 1,
      name: "Mission Control Dashboard",
      owner: "Mason Forge Core",
      status: "Complete",
      progress: 100,
    },
    {
      id: 2,
      name: "Knowledge Engine",
      owner: "Knowledge Department",
      status: "Complete",
      progress: 100,
    },
    {
      id: 3,
      name: "Engineering Planner",
      owner: "Planning Department",
      status: "Complete",
      progress: 100,
    },
    {
      id: 4,
      name: "AI Workforce Manager",
      owner: "Engineering Operations",
      status: "Complete",
      progress: 100,
    },
    {
      id: 5,
      name: "Human Approval Queue",
      owner: "Executive Review",
      status: "Complete",
      progress: 100,
    },
    {
      id: 6,
      name: "Prompt Library",
      owner: "Knowledge Systems",
      status: "Complete",
      progress: 100,
    },
    {
      id: 7,
      name: "Git Bridge",
      owner: "Source Control",
      status: "Foundation Complete",
      progress: 100,
    },
    {
      id: 8,
      name: "VS Code Bridge",
      owner: "Development Tools",
      status: "Foundation Complete",
      progress: 100,
    },
    {
      id: 9,
      name: "Verification Engine",
      owner: "Quality Assurance",
      status: "Foundation Complete",
      progress: 100,
    },
    {
      id: 10,
      name: "Deployment Bridge",
      owner: "Release Operations",
      status: "Foundation Complete",
      progress: 100,
    },
    {
      id: 11,
      name: "Local AI Integration",
      owner: "Infrastructure",
      status: "Foundation Complete",
      progress: 100,
    },
    {
      id: 12,
      name: "Milestone 3 - Real Backend Integration",
      owner: "Entire Engineering Organization",
      status: "Next Up",
      progress: 0,
    },
  ];

  return (
    <section>
      <h2>Engineering Build Queue</h2>

      {queue.map((job) => (
        <div className="pipeline-card" key={job.id}>
          <div className="pipeline-header">
            <strong>{job.name}</strong>
            <span>{job.status}</span>
          </div>

          <div className="pipeline-progress">
            <div
              className="pipeline-fill"
              style={{ width: `${job.progress}%` }}
            />
          </div>

          <small>
            Owner: {job.owner} • {job.progress}% Complete
          </small>
        </div>
      ))}
    </section>
  );
}