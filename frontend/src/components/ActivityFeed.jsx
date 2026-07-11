import { useEffect, useState } from "react";
import { eventBus } from "../core";

const formatEventName = (eventName) => {
  return String(eventName ?? "System event")
    .split("-")
    .map((word) => {
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
};

const formatEventTime = (timestamp) => {
  if (!timestamp) {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const createActivityMessage = (event) => {
  const eventName =
    event.eventName ?? event.event ?? event.type ?? event.name;

  const payload = event.payload ?? event.data ?? {};

  if (payload.plan?.objective) {
    return `${formatEventName(eventName)}: ${payload.plan.objective}`;
  }

  if (payload.approval?.plan) {
    return `${formatEventName(eventName)}: ${payload.approval.plan}`;
  }

  if (payload.job?.title) {
    return `${formatEventName(eventName)}: ${payload.job.title}`;
  }

  if (payload.change?.file) {
    return `${formatEventName(eventName)}: ${payload.change.file}`;
  }

  if (payload.commit?.message) {
    return `${formatEventName(eventName)}: ${payload.commit.message}`;
  }

  if (payload.deployment?.description) {
    return `${formatEventName(eventName)}: ${
      payload.deployment.description
    }`;
  }

  return `${formatEventName(eventName)}.`;
};

const getActivityEvents = () => {
  if (typeof eventBus.getHistory !== "function") {
    return [];
  }

  const history = eventBus.getHistory();

  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice()
    .reverse()
    .slice(0, 20)
    .map((event, index) => ({
      id:
        event.id ??
        `${event.timestamp ?? "event"}-${
          event.eventName ?? event.event ?? event.type ?? index
        }`,
      time: formatEventTime(
        event.timestamp ?? event.createdAt ?? event.time
      ),
      message: createActivityMessage(event),
    }));
};

export default function ActivityFeed() {
  const [events, setEvents] = useState(() => getActivityEvents());

  useEffect(() => {
    const refreshActivity = () => {
      setEvents(getActivityEvents());
    };

    refreshActivity();

    const intervalId = window.setInterval(refreshActivity, 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <section>
      <h2>Engineering Activity</h2>

      {events.length === 0 ? (
        <div className="activity-item">
          <strong>--:--</strong>
          <p>No engineering activity has been recorded.</p>
        </div>
      ) : (
        events.map((event) => (
          <div className="activity-item" key={event.id}>
            <strong>{event.time}</strong>
            <p>{event.message}</p>
          </div>
        ))
      )}
    </section>
  );
}