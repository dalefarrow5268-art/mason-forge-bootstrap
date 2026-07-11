import { useEffect, useMemo, useState } from "react";
import { stateManager, eventBus } from "../core";

const environments = [
  {
    id: "development",
    name: "Development",
    protected: false,
  },
  {
    id: "staging",
    name: "Staging",
    protected: false,
  },
  {
    id: "production",
    name: "Production",
    protected: true,
  },
];

export default function DeploymentBridge() {
  const [deployments, setDeployments] = useState(
    () => stateManager.get("deployments") ?? []
  );
  const [environment, setEnvironment] = useState("development");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [humanApproved, setHumanApproved] = useState(false);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const syncDeployments = (updatedDeployments) => {
      setDeployments(
        Array.isArray(updatedDeployments)
          ? updatedDeployments
          : []
      );
    };

    const queueVerifiedBuild = (payload) => {
      const verificationJob = payload?.job;

      if (!verificationJob) {
        return;
      }

      const currentDeployments =
        stateManager.get("deployments") ?? [];

      const existingDeployment = currentDeployments.find(
        (deployment) =>
          deployment.verificationJobId === verificationJob.id
      );

      if (existingDeployment) {
        return;
      }

      const newDeployment = {
        id: `DEPLOY-${verificationJob.id}`,
        verificationJobId: verificationJob.id,
        commitId: verificationJob.commitId,
        planIds: verificationJob.planIds ?? [],
        environment: "development",
        environmentName: "Development",
        version: verificationJob.commitHash ?? "Verified Build",
        description: verificationJob.name,
        status: "Queued",
        approvalStatus: "Not Required",
        createdAt: new Date().toLocaleString(),
        deployedAt: "--",
      };

      stateManager.set("deployments", [
        newDeployment,
        ...currentDeployments,
      ]);

      eventBus.emit("deployment-queued", {
        deployment: newDeployment,
        deploymentId: newDeployment.id,
        verificationJob,
        verificationJobId: verificationJob.id,
        commitId: verificationJob.commitId,
        planIds: verificationJob.planIds ?? [],
        timestamp: new Date().toISOString(),
      });
    };

    const unsubscribeDeployments = stateManager.subscribe(
      "deployments",
      syncDeployments
    );

    const unsubscribeVerification = eventBus.on(
      "verification-job-passed",
      queueVerifiedBuild
    );

    setDeployments(stateManager.get("deployments") ?? []);

    return () => {
      if (typeof unsubscribeDeployments === "function") {
        unsubscribeDeployments();
      }

      if (typeof unsubscribeVerification === "function") {
        unsubscribeVerification();
      }
    };
  }, []);

  const selectedDeployment = useMemo(() => {
    return (
      deployments.find(
        (deployment) => deployment.id === selectedDeploymentId
      ) ?? null
    );
  }, [deployments, selectedDeploymentId]);

  const getLatestDeployment = (environmentId) => {
    return (
      deployments.find(
        (deployment) => deployment.environment === environmentId
      ) ?? null
    );
  };

  const developmentDeployment = getLatestDeployment("development");
  const stagingDeployment = getLatestDeployment("staging");
  const productionDeployment = getLatestDeployment("production");

  const writeDeployments = (updater) => {
    const currentDeployments =
      stateManager.get("deployments") ?? [];

    const updatedDeployments =
      typeof updater === "function"
        ? updater(currentDeployments)
        : updater;

    stateManager.set("deployments", updatedDeployments);

    return updatedDeployments;
  };

  const handleCreateDeployment = (event) => {
    event.preventDefault();

    const trimmedVersion = version.trim();
    const trimmedDescription = description.trim();

    if (!trimmedVersion) {
      setMessage("Enter a build version.");
      return;
    }

    if (!trimmedDescription) {
      setMessage("Enter a deployment description.");
      return;
    }

    if (environment === "production" && !humanApproved) {
      setMessage("Human approval is required for production deployment.");
      return;
    }

    const selectedEnvironment = environments.find(
      (item) => item.id === environment
    );

    const newDeployment = {
      id: `DEPLOY-${Date.now()}`,
      verificationJobId: null,
      commitId: null,
      planIds: [],
      environment,
      environmentName: selectedEnvironment.name,
      version: trimmedVersion,
      description: trimmedDescription,
      status: "Queued",
      approvalStatus:
        environment === "production" ? "Approved" : "Not Required",
      createdAt: new Date().toLocaleString(),
      deployedAt: "--",
    };

    writeDeployments((currentDeployments) => [
      newDeployment,
      ...currentDeployments,
    ]);

    eventBus.emit("deployment-queued", {
      deployment: newDeployment,
      deploymentId: newDeployment.id,
      timestamp: new Date().toISOString(),
    });

    setSelectedDeploymentId(newDeployment.id);
    setVersion("");
    setDescription("");
    setHumanApproved(false);
    setMessage("Deployment added to the pipeline.");
  };

  const handleRunDeployment = (deploymentId) => {
    const deployedAt = new Date().toLocaleString();
    let completedDeployment = null;

    writeDeployments((currentDeployments) =>
      currentDeployments.map((deployment) => {
        if (deployment.id !== deploymentId) {
          return deployment;
        }

        completedDeployment = {
          ...deployment,
          status: "Deployed",
          deployedAt,
        };

        return completedDeployment;
      })
    );

    if (completedDeployment) {
      eventBus.emit("deployment-completed", {
        deployment: completedDeployment,
        deploymentId,
        environment: completedDeployment.environment,
        verificationJobId:
          completedDeployment.verificationJobId,
        commitId: completedDeployment.commitId,
        planIds: completedDeployment.planIds,
        timestamp: new Date().toISOString(),
      });
    }

    setMessage("Deployment completed.");
  };

  const handleFailDeployment = (deploymentId) => {
    const failedAt = new Date().toLocaleString();
    let failedDeployment = null;

    writeDeployments((currentDeployments) =>
      currentDeployments.map((deployment) => {
        if (deployment.id !== deploymentId) {
          return deployment;
        }

        failedDeployment = {
          ...deployment,
          status: "Failed",
          deployedAt: failedAt,
        };

        return failedDeployment;
      })
    );

    if (failedDeployment) {
      eventBus.emit("deployment-failed", {
        deployment: failedDeployment,
        deploymentId,
        environment: failedDeployment.environment,
        verificationJobId: failedDeployment.verificationJobId,
        commitId: failedDeployment.commitId,
        planIds: failedDeployment.planIds,
        timestamp: new Date().toISOString(),
      });
    }

    setMessage("Deployment marked as failed.");
  };

  const handleRollbackDeployment = (deploymentId) => {
    const rolledBackAt = new Date().toLocaleString();
    let rolledBackDeployment = null;

    writeDeployments((currentDeployments) =>
      currentDeployments.map((deployment) => {
        if (deployment.id !== deploymentId) {
          return deployment;
        }

        rolledBackDeployment = {
          ...deployment,
          status: "Rolled Back",
          deployedAt: rolledBackAt,
        };

        return rolledBackDeployment;
      })
    );

    if (rolledBackDeployment) {
      eventBus.emit("deployment-rolled-back", {
        deployment: rolledBackDeployment,
        deploymentId,
        environment: rolledBackDeployment.environment,
        verificationJobId:
          rolledBackDeployment.verificationJobId,
        commitId: rolledBackDeployment.commitId,
        planIds: rolledBackDeployment.planIds,
        timestamp: new Date().toISOString(),
      });
    }

    setMessage("Deployment rolled back.");
  };

  const handleDeleteDeployment = (deploymentId) => {
    const deletedDeployment =
      (stateManager.get("deployments") ?? []).find(
        (deployment) => deployment.id === deploymentId
      ) ?? null;

    writeDeployments((currentDeployments) =>
      currentDeployments.filter(
        (deployment) => deployment.id !== deploymentId
      )
    );

    eventBus.emit("deployment-deleted", {
      deployment: deletedDeployment,
      deploymentId,
      timestamp: new Date().toISOString(),
    });

    if (selectedDeploymentId === deploymentId) {
      setSelectedDeploymentId(null);
    }

    setMessage("Deployment removed.");
  };

  const renderEnvironmentValue = (
    deployment,
    defaultValue,
    protectedEnvironment = false
  ) => {
    if (!deployment) {
      return protectedEnvironment ? "Protected" : defaultValue;
    }

    return deployment.status;
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Deployment Bridge</h2>

          <p className="engineering-planner-subtitle">
            Deploy approved Mason Forge builds to development, staging, and
            production environments.
          </p>
        </div>

        <div className="engineering-planner-status">Ready</div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Development
          </span>

          <strong className="engineering-planner-card-value">
            {renderEnvironmentValue(developmentDeployment, "Idle")}
          </strong>

          <p>
            {developmentDeployment
              ? `Version ${developmentDeployment.version}`
              : "No deployment in progress."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Staging
          </span>

          <strong className="engineering-planner-card-value">
            {renderEnvironmentValue(stagingDeployment, "Idle")}
          </strong>

          <p>
            {stagingDeployment
              ? `Version ${stagingDeployment.version}`
              : "No deployment in progress."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Production
          </span>

          <strong className="engineering-planner-card-value">
            {renderEnvironmentValue(
              productionDeployment,
              "Protected",
              true
            )}
          </strong>

          <p>
            {productionDeployment
              ? `Version ${productionDeployment.version}`
              : "Human approval required before release."}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Create Deployment</h3>

            <p>
              Queue an approved build for deployment to the selected
              environment.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleCreateDeployment}
        >
          <label htmlFor="deployment-environment">
            Environment
          </label>

          <select
            id="deployment-environment"
            value={environment}
            onChange={(event) => {
              setEnvironment(event.target.value);
              setHumanApproved(false);
              setMessage("");
            }}
          >
            {environments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <label htmlFor="deployment-version">
            Build Version
          </label>

          <input
            id="deployment-version"
            type="text"
            value={version}
            onChange={(event) => {
              setVersion(event.target.value);
              setMessage("");
            }}
            placeholder="1.0.0"
          />

          <label htmlFor="deployment-description">
            Deployment Description
          </label>

          <textarea
            id="deployment-description"
            rows="5"
            value={description}
            onChange={(event) => {
              setDescription(event.target.value);
              setMessage("");
            }}
            placeholder="Describe the approved build and deployment purpose..."
          />

          {environment === "production" ? (
            <label>
              <input
                type="checkbox"
                checked={humanApproved}
                onChange={(event) => {
                  setHumanApproved(event.target.checked);
                  setMessage("");
                }}
              />
              Human approval confirmed
            </label>
          ) : null}

          {message ? (
            <p className="engineering-planner-form-message">
              {message}
            </p>
          ) : null}

          <div className="engineering-planner-actions">
            <button type="submit" className="primary-button">
              Queue Deployment
            </button>
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Deployment Pipeline</h3>

            <p>
              Review queued, completed, failed, and rolled-back deployments.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Version</th>
              <th>Status</th>
              <th>Last Deployment</th>
            </tr>
          </thead>

          <tbody>
            {deployments.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  No deployments have been executed.
                </td>
              </tr>
            ) : (
              deployments.map((deployment) => (
                <tr
                  key={deployment.id}
                  onClick={() =>
                    setSelectedDeploymentId(deployment.id)
                  }
                >
                  <td>{deployment.environmentName}</td>
                  <td>{deployment.version}</td>
                  <td>{deployment.status}</td>
                  <td>{deployment.deployedAt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {selectedDeployment ? (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedDeployment.id}
                </span>

                <h3>
                  {selectedDeployment.environmentName} Deployment
                </h3>

                <p>Version {selectedDeployment.version}</p>
              </div>

              <div className="engineering-planner-status">
                {selectedDeployment.status}
              </div>
            </div>

            <table className="planner-table">
              <tbody>
                <tr>
                  <td>Description</td>
                  <td>{selectedDeployment.description}</td>
                </tr>

                <tr>
                  <td>Approval</td>
                  <td>{selectedDeployment.approvalStatus}</td>
                </tr>

                <tr>
                  <td>Created</td>
                  <td>{selectedDeployment.createdAt}</td>
                </tr>

                <tr>
                  <td>Deployed</td>
                  <td>{selectedDeployment.deployedAt}</td>
                </tr>
              </tbody>
            </table>

            <div className="engineering-planner-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  handleDeleteDeployment(selectedDeployment.id)
                }
              >
                Delete
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  handleFailDeployment(selectedDeployment.id)
                }
                disabled={selectedDeployment.status !== "Queued"}
              >
                Mark Failed
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  handleRollbackDeployment(selectedDeployment.id)
                }
                disabled={selectedDeployment.status !== "Deployed"}
              >
                Roll Back
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  handleRunDeployment(selectedDeployment.id)
                }
                disabled={selectedDeployment.status !== "Queued"}
              >
                Deploy Build
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}