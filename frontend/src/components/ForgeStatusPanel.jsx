import { useEffect, useMemo, useState } from "react";
import { stateManager, eventBus } from "../../core";

const initialSystems = [
  {
    id: "forge-core",
    name: "Mason Core",
    category: "Mission Control",
    status: "Operational",
    health: 100,
  },
  {
    id: "event-bus",
    name: "Shared Event Bus",
    category: "System Coordination",
    status: "Operational",
    health: 100,
  },
  {
    id: "state-manager",
    name: "Shared State Manager",
    category: "Shared State",
    status: "Operational",
    health: 100,
  },
  {
    id: "knowledge-engine",
    name: "Knowledge Engine",
    category: "Engineering Memory",
    status: "Operational",
    health: 100,
  },
  {
    id: "engineering-planner",
    name: "Engineering Planner",
    category: "Planning",
    status: "Operational",
    health: 100,
  },
  {
    id: "ai-workforce",
    name: "AI Workforce Manager",
    category: "Workforce",
    status: "Operational",
    health: 100,
  },
  {
    id: "approval-queue",
    name: "Human Approval Queue",
    category: "Governance",
    status: "Operational",
    health: 100,
  },
  {
    id: "git-bridge",
    name: "Git Bridge",
    category: "Version Control",
    status: "Ready",
    health: 100,
  },
  {
    id: "vscode-bridge",
    name: "VS Code Bridge",
    category: "Local Development",
    status: "Ready",
    health: 100,
  },
  {
    id: "verification-engine",
    name: "Verification Engine",
    category: "Quality Assurance",
    status: "Ready",
    health: 100,
  },
  {
    id: "deployment-bridge",
    name: "Deployment Bridge",
    category: "Release Operations",
    status: "Ready",
    health: 100,
  },
  {
    id: "local-ai",
    name: "Local AI Integration",
    category: "AI Infrastructure",
    status: "Offline",
    health: 0,
  },
];

const getHealthValue = (healthReport) => {
  if (!healthReport) {
    return 100;
  }

  if (typeof healthReport.health === "number") {
    return healthReport.health;
  }

  if (typeof healthReport.healthPercent === "number") {
    return healthReport.healthPercent;
  }

  if (typeof healthReport.score === "number") {
    return healthReport.score;
  }

  if (
    healthReport.status === "Offline" ||
    healthReport.status === "Failed"
  ) {
    return 0;
  }

  return 100;
};

export default function ForgeStatusPanel() {
  const [systems, setSystems] = useState(initialSystems);
  const [selectedSystemId, setSelectedSystemId] = useState(
    initialSystems[0].id
  );

  useEffect(() => {
    const refreshSystemHealth = () => {
      const eventBusHealth =
        typeof eventBus.getHealth === "function"
          ? eventBus.getHealth()
          : null;

      const stateManagerHealth =
        typeof stateManager.getHealth === "function"
          ? stateManager.getHealth()
          : null;

      const engineeringPlans =
        stateManager.get("engineeringPlans") ?? [];
      const aiWorkers = stateManager.get("aiWorkers") ?? [];
      const approvalQueue =
        stateManager.get("approvalQueue") ?? [];
      const gitChanges = stateManager.get("gitChanges") ?? [];
      const verificationJobs =
        stateManager.get("verificationJobs") ?? [];
      const deployments =
        stateManager.get("deployments") ?? [];
      const localAI = stateManager.get("localAI") ?? [];

      setSystems((currentSystems) =>
        currentSystems.map((system) => {
          if (system.status === "Offline" && system.id !== "local-ai") {
            return system;
          }

          switch (system.id) {
            case "event-bus": {
              const health = getHealthValue(eventBusHealth);

              return {
                ...system,
                status: health > 0 ? "Operational" : "Offline",
                health,
              };
            }

            case "state-manager": {
              const health = getHealthValue(stateManagerHealth);

              return {
                ...system,
                status: health > 0 ? "Operational" : "Offline",
                health,
              };
            }

            case "engineering-planner":
              return {
                ...system,
                status:
                  engineeringPlans.length > 0
                    ? "Operational"
                    : "Ready",
                health: 100,
              };

            case "ai-workforce": {
              const onlineWorkers = aiWorkers.filter(
                (worker) => worker.status === "Online"
              );

              const health =
                aiWorkers.length === 0
                  ? 100
                  : Math.round(
                      onlineWorkers.reduce(
                        (total, worker) =>
                          total + (worker.health ?? 0),
                        0
                      ) / aiWorkers.length
                    );

              return {
                ...system,
                status:
                  aiWorkers.length === 0 || onlineWorkers.length > 0
                    ? "Operational"
                    : "Offline",
                health,
              };
            }

            case "approval-queue":
              return {
                ...system,
                status:
                  approvalQueue.length > 0
                    ? "Operational"
                    : "Ready",
                health: 100,
              };

            case "git-bridge":
              return {
                ...system,
                status:
                  gitChanges.length > 0
                    ? "Operational"
                    : "Ready",
                health: 100,
              };

            case "verification-engine": {
              const failedJobs = verificationJobs.filter(
                (job) => job.result === "Failed"
              );

              return {
                ...system,
                status:
                  failedJobs.length > 0
                    ? "Attention Required"
                    : verificationJobs.length > 0
                      ? "Operational"
                      : "Ready",
                health:
                  failedJobs.length > 0
                    ? Math.max(
                        0,
                        100 -
                          Math.round(
                            (failedJobs.length /
                              verificationJobs.length) *
                              100
                          )
                      )
                    : 100,
              };
            }

            case "deployment-bridge": {
              const failedDeployments = deployments.filter(
                (deployment) => deployment.status === "Failed"
              );

              return {
                ...system,
                status:
                  failedDeployments.length > 0
                    ? "Attention Required"
                    : deployments.length > 0
                      ? "Operational"
                      : "Ready",
                health:
                  failedDeployments.length > 0
                    ? Math.max(
                        0,
                        100 -
                          Math.round(
                            (failedDeployments.length /
                              deployments.length) *
                              100
                          )
                      )
                    : 100,
              };
            }

            case "local-ai": {
              const onlineLocalAI = localAI.filter(
                (item) =>
                  item.status === "Online" ||
                  item.status === "Connected"
              );

              return {
                ...system,
                status:
                  onlineLocalAI.length > 0
                    ? "Operational"
                    : "Offline",
                health:
                  onlineLocalAI.length > 0 ? 100 : 0,
              };
            }

            default:
              return system;
          }
        })
      );
    };

    refreshSystemHealth();

    const intervalId = window.setInterval(
      refreshSystemHealth,
      1000
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const selectedSystem = useMemo(() => {
    return (
      systems.find((system) => system.id === selectedSystemId) ?? null
    );
  }, [systems, selectedSystemId]);

  const operationalCount = useMemo(() => {
    return systems.filter(
      (system) =>
        system.status === "Operational" ||
        system.status === "Ready"
    ).length;
  }, [systems]);

  const offlineCount = useMemo(() => {
    return systems.filter(
      (system) => system.status === "Offline"
    ).length;
  }, [systems]);

  const averageHealth = useMemo(() => {
    if (systems.length === 0) {
      return 0;
    }

    const totalHealth = systems.reduce(
      (total, system) => total + system.health,
      0
    );

    return Math.round(totalHealth / systems.length);
  }, [systems]);

  const handleToggleSystem = (systemId) => {
    let updatedSystem = null;

    setSystems((currentSystems) =>
      currentSystems.map((system) => {
        if (system.id !== systemId) {
          return system;
        }

        const isOffline = system.status === "Offline";

        updatedSystem = {
          ...system,
          status: isOffline ? "Operational" : "Offline",
          health: isOffline ? 100 : 0,
        };

        return updatedSystem;
      })
    );

    if (updatedSystem) {
      eventBus.emit("forge-system-status-changed", {
        system: updatedSystem,
        systemId,
        status: updatedSystem.status,
        health: updatedSystem.health,
        timestamp: new Date().toISOString(),
      });
    }
  };

  return (
    <section className="forge-status-panel">
      <div className="engineering-planner-header">
        <div>
          <h2>Forge Status</h2>

          <p className="engineering-planner-subtitle">
            Monitor the operating health of every Mason Forge engineering
            system.
          </p>
        </div>

        <div className="engineering-planner-status">
          {operationalCount} Systems Ready
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Operational Systems
          </span>

          <strong className="engineering-planner-card-value">
            {operationalCount}
          </strong>

          <p>Mason Forge engineering systems available.</p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Offline Systems
          </span>

          <strong className="engineering-planner-card-value">
            {offlineCount}
          </strong>

          <p>
            {offlineCount === 0
              ? "No systems are offline."
              : "Some systems require connection or review."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Forge Health
          </span>

          <strong className="engineering-planner-card-value">
            {averageHealth}%
          </strong>

          <p>Combined Mason Forge operating health.</p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Engineering Systems</h3>

            <p>
              Review system status, health, and operating responsibility.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>System</th>
              <th>Category</th>
              <th>Status</th>
              <th>Health</th>
            </tr>
          </thead>

          <tbody>
            {systems.map((system) => (
              <tr
                key={system.id}
                onClick={() => setSelectedSystemId(system.id)}
              >
                <td>{system.name}</td>
                <td>{system.category}</td>
                <td>{system.status}</td>
                <td>{system.health}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        {selectedSystem ? (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedSystem.id}
                </span>

                <h3>{selectedSystem.name}</h3>

                <p>{selectedSystem.category}</p>
              </div>

              <div className="engineering-planner-status">
                {selectedSystem.status}
              </div>
            </div>

            <table className="planner-table">
              <tbody>
                <tr>
                  <td>System</td>
                  <td>{selectedSystem.name}</td>
                </tr>

                <tr>
                  <td>Category</td>
                  <td>{selectedSystem.category}</td>
                </tr>

                <tr>
                  <td>Status</td>
                  <td>{selectedSystem.status}</td>
                </tr>

                <tr>
                  <td>Health</td>
                  <td>{selectedSystem.health}%</td>
                </tr>
              </tbody>
            </table>

            <div className="engineering-planner-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleToggleSystem(selectedSystem.id)}
              >
                {selectedSystem.status === "Offline"
                  ? "Bring Online"
                  : "Take Offline"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}