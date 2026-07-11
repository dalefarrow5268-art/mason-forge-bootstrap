import { useEffect, useMemo, useState } from "react";
import { stateManager, eventBus } from "../core";

const initialWorkers = [
  {
    id: "MF-AI-001",
    name: "Mason Core",
    department: "Mission Control",
    role: "Engineering Conductor",
    status: "Online",
    currentJob: "Idle",
    health: 100,
  },
  {
    id: "MF-AI-002",
    name: "Knowledge Engine",
    department: "Memory",
    role: "Knowledge Specialist",
    status: "Online",
    currentJob: "Idle",
    health: 100,
  },
  {
    id: "MF-AI-003",
    name: "Build Engine",
    department: "Engineering",
    role: "Code Generation Specialist",
    status: "Online",
    currentJob: "Idle",
    health: 100,
  },
  {
    id: "MF-AI-004",
    name: "Validation Engine",
    department: "Quality Assurance",
    role: "Verification Specialist",
    status: "Online",
    currentJob: "Idle",
    health: 100,
  },
  {
    id: "MF-AI-005",
    name: "Deployment Engine",
    department: "Release Operations",
    role: "Deployment Specialist",
    status: "Online",
    currentJob: "Idle",
    health: 100,
  },
  {
    id: "MF-AI-006",
    name: "Dashboard Service",
    department: "User Interface",
    role: "Interface Operations Specialist",
    status: "Online",
    currentJob: "Idle",
    health: 100,
  },
  {
    id: "MF-AI-007",
    name: "Event Bus",
    department: "System Coordination",
    role: "Workflow Coordination Specialist",
    status: "Online",
    currentJob: "Idle",
    health: 100,
  },
];

const createEngineeringJob = (plan, worker) => {
  return {
    id: `MF-JOB-${plan.id}`,
    planId: plan.id,
    title: plan.objective,
    assignedWorkerId: worker.id,
    assignedWorkerName: worker.name,
    status: "Assigned",
    createdAt: new Date().toISOString(),
  };
};

export default function AIWorkforceManager() {
  const [workers, setWorkers] = useState(() => {
    const storedWorkers = stateManager.get("aiWorkers");

    return Array.isArray(storedWorkers) && storedWorkers.length > 0
      ? storedWorkers
      : initialWorkers;
  });

  const [selectedWorkerId, setSelectedWorkerId] = useState(
    initialWorkers[0].id
  );
  const [jobTitle, setJobTitle] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const storedWorkers = stateManager.get("aiWorkers");

    if (!Array.isArray(storedWorkers) || storedWorkers.length === 0) {
      stateManager.set("aiWorkers", initialWorkers);
    }

    const syncWorkers = (updatedWorkers) => {
      setWorkers(
        Array.isArray(updatedWorkers) ? updatedWorkers : initialWorkers
      );
    };

    const assignApprovedPlan = (payload) => {
      const plan = payload?.plan;

      if (!plan) {
        return;
      }

      const currentJobs =
        stateManager.get("engineeringJobs") ?? [];

      const existingJob = currentJobs.find(
        (job) => job.planId === plan.id
      );

      if (existingJob) {
        return;
      }

      const currentWorkers =
        stateManager.get("aiWorkers") ?? initialWorkers;

      const buildEngine = currentWorkers.find(
        (worker) => worker.id === "MF-AI-003"
      );

      if (!buildEngine || buildEngine.status !== "Online") {
        eventBus.emit("engineering-job-assignment-failed", {
          plan,
          planId: plan.id,
          reason: "Build Engine is not online.",
          timestamp: new Date().toISOString(),
        });

        return;
      }

      const engineeringJob = createEngineeringJob(
        plan,
        buildEngine
      );

      const updatedWorkers = currentWorkers.map((worker) =>
        worker.id === buildEngine.id
          ? {
              ...worker,
              currentJob: plan.objective,
            }
          : worker
      );

      stateManager.set("aiWorkers", updatedWorkers);
      stateManager.set("engineeringJobs", [
        engineeringJob,
        ...currentJobs,
      ]);

      eventBus.emit("engineering-job-created", {
        job: engineeringJob,
        jobId: engineeringJob.id,
        plan,
        planId: plan.id,
        timestamp: new Date().toISOString(),
      });

      eventBus.emit("engineering-job-assigned", {
        job: engineeringJob,
        jobId: engineeringJob.id,
        worker: buildEngine,
        workerId: buildEngine.id,
        planId: plan.id,
        timestamp: new Date().toISOString(),
      });
    };

    const unsubscribeWorkers = stateManager.subscribe(
      "aiWorkers",
      syncWorkers
    );

    const unsubscribeApprovedPlan = eventBus.on(
      "engineering-plan-approved",
      assignApprovedPlan
    );

    setWorkers(stateManager.get("aiWorkers") ?? initialWorkers);

    return () => {
      if (typeof unsubscribeWorkers === "function") {
        unsubscribeWorkers();
      }

      if (typeof unsubscribeApprovedPlan === "function") {
        unsubscribeApprovedPlan();
      }
    };
  }, []);

  const onlineWorkers = useMemo(() => {
    return workers.filter((worker) => worker.status === "Online").length;
  }, [workers]);

  const assignedJobs = useMemo(() => {
    return workers.filter((worker) => worker.currentJob !== "Idle").length;
  }, [workers]);

  const averageHealth = useMemo(() => {
    if (workers.length === 0) {
      return 0;
    }

    const totalHealth = workers.reduce(
      (total, worker) => total + worker.health,
      0
    );

    return Math.round(totalHealth / workers.length);
  }, [workers]);

  const selectedWorker = useMemo(() => {
    return (
      workers.find((worker) => worker.id === selectedWorkerId) ?? null
    );
  }, [workers, selectedWorkerId]);

  const writeWorkers = (updater) => {
    const currentWorkers =
      stateManager.get("aiWorkers") ?? initialWorkers;

    const updatedWorkers =
      typeof updater === "function"
        ? updater(currentWorkers)
        : updater;

    stateManager.set("aiWorkers", updatedWorkers);

    return updatedWorkers;
  };

  const handleAssignJob = (event) => {
    event.preventDefault();

    const trimmedJobTitle = jobTitle.trim();

    if (!selectedWorker) {
      setMessage("Select an AI employee before assigning a job.");
      return;
    }

    if (!trimmedJobTitle) {
      setMessage("Enter an engineering job before assigning it.");
      return;
    }

    if (selectedWorker.status !== "Online") {
      setMessage("The selected AI employee must be online.");
      return;
    }

    const engineeringJob = {
      id: `MF-JOB-${Date.now()}`,
      planId: null,
      title: trimmedJobTitle,
      assignedWorkerId: selectedWorker.id,
      assignedWorkerName: selectedWorker.name,
      status: "Assigned",
      createdAt: new Date().toISOString(),
    };

    writeWorkers((currentWorkers) =>
      currentWorkers.map((worker) =>
        worker.id === selectedWorker.id
          ? {
              ...worker,
              currentJob: trimmedJobTitle,
            }
          : worker
      )
    );

    const currentJobs =
      stateManager.get("engineeringJobs") ?? [];

    stateManager.set("engineeringJobs", [
      engineeringJob,
      ...currentJobs,
    ]);

    eventBus.emit("engineering-job-created", {
      job: engineeringJob,
      jobId: engineeringJob.id,
      timestamp: new Date().toISOString(),
    });

    eventBus.emit("engineering-job-assigned", {
      job: engineeringJob,
      jobId: engineeringJob.id,
      worker: selectedWorker,
      workerId: selectedWorker.id,
      timestamp: new Date().toISOString(),
    });

    setJobTitle("");
    setMessage(`${selectedWorker.name} has been assigned a new job.`);
  };

  const handleReleaseWorker = (workerId) => {
    const worker = workers.find(
      (currentWorker) => currentWorker.id === workerId
    );

    if (!worker) {
      return;
    }

    const releasedJob = worker.currentJob;

    writeWorkers((currentWorkers) =>
      currentWorkers.map((currentWorker) =>
        currentWorker.id === workerId
          ? {
              ...currentWorker,
              currentJob: "Idle",
            }
          : currentWorker
      )
    );

    const currentJobs =
      stateManager.get("engineeringJobs") ?? [];

    const updatedJobs = currentJobs.map((job) =>
      job.assignedWorkerId === workerId &&
      job.status === "Assigned" &&
      job.title === releasedJob
        ? {
            ...job,
            status: "Released",
            releasedAt: new Date().toISOString(),
          }
        : job
    );

    stateManager.set("engineeringJobs", updatedJobs);

    eventBus.emit("engineering-job-released", {
      worker,
      workerId,
      jobTitle: releasedJob,
      timestamp: new Date().toISOString(),
    });

    setMessage("AI employee released from the current job.");
  };

  const handleToggleStatus = (workerId) => {
    const currentWorker = workers.find(
      (worker) => worker.id === workerId
    );

    if (!currentWorker) {
      return;
    }

    const nextStatus =
      currentWorker.status === "Online" ? "Offline" : "Online";

    writeWorkers((currentWorkers) =>
      currentWorkers.map((worker) =>
        worker.id === workerId
          ? {
              ...worker,
              status: nextStatus,
              currentJob:
                nextStatus === "Offline"
                  ? "Idle"
                  : worker.currentJob,
            }
          : worker
      )
    );

    eventBus.emit("ai-worker-status-changed", {
      workerId,
      previousStatus: currentWorker.status,
      status: nextStatus,
      timestamp: new Date().toISOString(),
    });

    setMessage("AI employee status updated.");
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>AI Workforce Manager</h2>

          <p className="engineering-planner-subtitle">
            Manage every AI employee inside Mason Forge.
          </p>
        </div>

        <div className="engineering-planner-status">
          {onlineWorkers} AI Online
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Active Engineers
          </span>

          <strong className="engineering-planner-card-value">
            {onlineWorkers}
          </strong>

          <p>
            {onlineWorkers === 0
              ? "No AI employees are currently available."
              : "Engineering workforce available."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Assigned Jobs
          </span>

          <strong className="engineering-planner-card-value">
            {assignedJobs}
          </strong>

          <p>
            {assignedJobs === 0
              ? "No engineering jobs assigned."
              : `${assignedJobs} ${
                  assignedJobs === 1 ? "job is" : "jobs are"
                } currently assigned.`}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            System Health
          </span>

          <strong className="engineering-planner-card-value">
            {averageHealth}%
          </strong>

          <p>
            {averageHealth === 100
              ? "All AI workers operational."
              : "AI workforce requires review."}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Engineering Workforce</h3>

            <p>
              Review AI employee status, assignments, roles, and operating
              health.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>AI Employee</th>
              <th>Department</th>
              <th>Role</th>
              <th>Status</th>
              <th>Current Job</th>
              <th>Health</th>
            </tr>
          </thead>

          <tbody>
            {workers.map((worker) => (
              <tr
                key={worker.id}
                onClick={() => setSelectedWorkerId(worker.id)}
              >
                <td>
                  <strong>{worker.name}</strong>
                  <br />
                  <span>{worker.id}</span>
                </td>

                <td>{worker.department}</td>
                <td>{worker.role}</td>
                <td>{worker.status}</td>
                <td>{worker.currentJob}</td>
                <td>{worker.health}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Workforce Controls</h3>

            <p>
              Assign jobs, release workers, and control AI employee status.
            </p>
          </div>
        </div>

        {selectedWorker ? (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedWorker.id}
                </span>

                <h3>{selectedWorker.name}</h3>

                <p>
                  {selectedWorker.role} · {selectedWorker.department}
                </p>
              </div>

              <div className="engineering-planner-status">
                {selectedWorker.status}
              </div>
            </div>

            <form
              className="engineering-planner-form"
              onSubmit={handleAssignJob}
            >
              <label htmlFor="ai-job-title">
                Engineering Job
              </label>

              <textarea
                id="ai-job-title"
                name="aiJobTitle"
                rows="4"
                value={jobTitle}
                onChange={(event) => {
                  setJobTitle(event.target.value);

                  if (message) {
                    setMessage("");
                  }
                }}
                placeholder="Describe the job this AI employee should perform..."
              />

              {message ? (
                <p className="engineering-planner-form-message">
                  {message}
                </p>
              ) : null}

              <div className="engineering-planner-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleToggleStatus(selectedWorker.id)}
                >
                  {selectedWorker.status === "Online"
                    ? "Take Offline"
                    : "Bring Online"}
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => handleReleaseWorker(selectedWorker.id)}
                  disabled={selectedWorker.currentJob === "Idle"}
                >
                  Release Job
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={selectedWorker.status !== "Online"}
                >
                  Assign Job
                </button>
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </section>
  );
}