export default function BuildQueue() {
  const queueTitle = "Forge Build Queue";

  const queue = [
    {
      id: 1,
      name: "Mission Control",
      priority: "Complete",
      status: "Online",
      progress: 100,
    },
    {
      id: 2,
      name: "Knowledge Engine",
      priority: "High",
      status: "Next Build",
      progress: 10,
    },
    {
      id: 3,
      name: "Build Engine",
      priority: "High",
      status: "Queued",
      progress: 0,
    },
    {
      id: 4,
      name: "Validation Engine",
      priority: "High",
      status: "Queued",
      progress: 0,
    },
    {
      id: 5,
      name: "Deployment Engine",
      priority: "Medium",
      status: "Planned",
      progress: 0,
    },
  ];

  return (
    <section>
      <h2>{queueTitle}</h2>

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

          <small>Priority: {job.priority}</small>
        </div>
      ))}
    </section>
  );
}