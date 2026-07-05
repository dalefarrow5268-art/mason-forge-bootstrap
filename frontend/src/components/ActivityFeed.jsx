export default function ActivityFeed() {
  const logTitle = "Forge Activity Log";

  const events = [
    {
      id: 1,
      message: "🚀 Mason Forge™ boot sequence complete",
    },
    {
      id: 2,
      message: "🧠 Knowledge Engine scheduled for development",
    },
    {
      id: 3,
      message: "⚒️ Build Engine framework initialized",
    },
    {
      id: 4,
      message: "✅ Validation Engine planned",
    },
    {
      id: 5,
      message: "🚀 Deployment Engine planned",
    },
    {
      id: 6,
      message: "🏗️ SSX Foundation Build progressing",
    },
  ];

  return (
    <section>
      <h2>{logTitle}</h2>

      {events.map((event) => (
        <div className="activity-item" key={event.id}>
          {event.message}
        </div>
      ))}
    </section>
  );
}