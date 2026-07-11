import { useEffect, useMemo, useState } from "react";
import { stateManager, eventBus } from "../core";

export default function GitBridge() {
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [branchName, setBranchName] = useState("main");
  const [connectedRepository, setConnectedRepository] = useState(null);
  const [pendingChanges, setPendingChanges] = useState(
    () => stateManager.get("gitChanges") ?? []
  );
  const [commitMessage, setCommitMessage] = useState("");
  const [commitHistory, setCommitHistory] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const syncGitChanges = (updatedChanges) => {
      setPendingChanges(
        Array.isArray(updatedChanges) ? updatedChanges : []
      );
    };

    const addEngineeringJobChange = (payload) => {
      const job = payload?.job;

      if (!job) {
        return;
      }

      const currentChanges =
        stateManager.get("gitChanges") ?? [];

      const existingChange = currentChanges.find(
        (change) => change.jobId === job.id
      );

      if (existingChange) {
        return;
      }

      const newChange = {
        id: `CHANGE-${job.id}`,
        jobId: job.id,
        planId: job.planId,
        file: `src/generated/${job.id}.js`,
        type: "Generated",
        status: "Pending",
        description: job.title,
        createdAt: new Date().toISOString(),
      };

      stateManager.set("gitChanges", [
        newChange,
        ...currentChanges,
      ]);

      eventBus.emit("git-change-created", {
        change: newChange,
        changeId: newChange.id,
        job,
        jobId: job.id,
        planId: job.planId,
        timestamp: new Date().toISOString(),
      });
    };

    const unsubscribeChanges = stateManager.subscribe(
      "gitChanges",
      syncGitChanges
    );

    const unsubscribeEngineeringJob = eventBus.on(
      "engineering-job-created",
      addEngineeringJobChange
    );

    setPendingChanges(stateManager.get("gitChanges") ?? []);

    return () => {
      if (typeof unsubscribeChanges === "function") {
        unsubscribeChanges();
      }

      if (typeof unsubscribeEngineeringJob === "function") {
        unsubscribeEngineeringJob();
      }
    };
  }, []);

  const connectionStatus = connectedRepository
    ? "Connected"
    : "Not Connected";

  const lastCommit = useMemo(() => {
    return commitHistory[0] ?? null;
  }, [commitHistory]);

  const writeGitChanges = (updater) => {
    const currentChanges =
      stateManager.get("gitChanges") ?? [];

    const updatedChanges =
      typeof updater === "function"
        ? updater(currentChanges)
        : updater;

    stateManager.set("gitChanges", updatedChanges);

    return updatedChanges;
  };

  const handleConnectRepository = (event) => {
    event.preventDefault();

    const trimmedName = repositoryName.trim();
    const trimmedPath = repositoryPath.trim();
    const trimmedBranch = branchName.trim();

    if (!trimmedName || !trimmedPath || !trimmedBranch) {
      setMessage(
        "Enter the repository name, local path, and branch before connecting."
      );
      return;
    }

    const repository = {
      id: `REPO-${Date.now()}`,
      name: trimmedName,
      path: trimmedPath,
      branch: trimmedBranch,
      connectedAt: new Date().toLocaleString(),
    };

    setConnectedRepository(repository);

    eventBus.emit("git-repository-connected", {
      repository,
      repositoryId: repository.id,
      timestamp: new Date().toISOString(),
    });

    setMessage("Repository connected to Mason Forge.");
  };

  const handleDisconnectRepository = () => {
    const repository = connectedRepository;

    setConnectedRepository(null);
    writeGitChanges([]);
    setCommitMessage("");
    setCommitHistory([]);

    eventBus.emit("git-repository-disconnected", {
      repository,
      repositoryId: repository?.id ?? null,
      timestamp: new Date().toISOString(),
    });

    setMessage("Repository disconnected.");
  };

  const handleAddTestChange = () => {
    if (!connectedRepository) {
      setMessage("Connect a repository before tracking changes.");
      return;
    }

    const currentChanges =
      stateManager.get("gitChanges") ?? [];

    const nextChangeNumber = currentChanges.length + 1;

    const newChange = {
      id: `CHANGE-${Date.now()}`,
      jobId: null,
      planId: null,
      file: `src/generated/change-${nextChangeNumber}.js`,
      type: "Modified",
      status: "Pending",
      description: "Test Git change",
      createdAt: new Date().toISOString(),
    };

    writeGitChanges((changes) => [
      newChange,
      ...changes,
    ]);

    eventBus.emit("git-change-created", {
      change: newChange,
      changeId: newChange.id,
      timestamp: new Date().toISOString(),
    });

    setMessage("Test change added to the Git staging queue.");
  };

  const handleRemoveChange = (changeId) => {
    const change =
      (stateManager.get("gitChanges") ?? []).find(
        (currentChange) => currentChange.id === changeId
      ) ?? null;

    writeGitChanges((currentChanges) =>
      currentChanges.filter(
        (currentChange) => currentChange.id !== changeId
      )
    );

    eventBus.emit("git-change-removed", {
      change,
      changeId,
      jobId: change?.jobId ?? null,
      planId: change?.planId ?? null,
      timestamp: new Date().toISOString(),
    });

    setMessage("Pending change removed.");
  };

  const handleCommitChanges = (event) => {
    event.preventDefault();

    if (!connectedRepository) {
      setMessage("Connect a repository before committing changes.");
      return;
    }

    const currentChanges =
      stateManager.get("gitChanges") ?? [];

    if (currentChanges.length === 0) {
      setMessage("There are no pending changes to commit.");
      return;
    }

    const trimmedCommitMessage = commitMessage.trim();

    if (!trimmedCommitMessage) {
      setMessage("Enter a commit message.");
      return;
    }

    const newCommit = {
      id: `COMMIT-${Date.now()}`,
      hash: Math.random().toString(16).slice(2, 9),
      message: trimmedCommitMessage,
      branch: connectedRepository.branch,
      files: currentChanges.length,
      changes: currentChanges,
      createdAt: new Date().toLocaleString(),
      status: "Committed",
    };

    setCommitHistory((currentHistory) => [
      newCommit,
      ...currentHistory,
    ]);

    writeGitChanges([]);
    setCommitMessage("");

    eventBus.emit("git-changes-committed", {
      commit: newCommit,
      commitId: newCommit.id,
      repository: connectedRepository,
      repositoryId: connectedRepository.id,
      changes: currentChanges,
      timestamp: new Date().toISOString(),
    });

    setMessage("Changes committed successfully.");
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Git Bridge</h2>

          <p className="engineering-planner-subtitle">
            Connect Mason Forge to Git repositories for version control and
            automated engineering workflows.
          </p>
        </div>

        <div className="engineering-planner-status">
          {connectionStatus}
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Repository
          </span>

          <strong className="engineering-planner-card-value">
            {connectedRepository ? connectedRepository.name : "--"}
          </strong>

          <p>
            {connectedRepository
              ? connectedRepository.path
              : "No repository connected."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Current Branch
          </span>

          <strong className="engineering-planner-card-value">
            {connectedRepository ? connectedRepository.branch : "--"}
          </strong>

          <p>
            {connectedRepository
              ? "Active Git branch."
              : "No active branch."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Pending Changes
          </span>

          <strong className="engineering-planner-card-value">
            {pendingChanges.length}
          </strong>

          <p>
            {pendingChanges.length === 0
              ? "No tracked changes."
              : `${pendingChanges.length} ${
                  pendingChanges.length === 1 ? "change is" : "changes are"
                } waiting to be committed.`}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Repository Connection</h3>

            <p>
              Configure the local Git repository Mason Forge should manage.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleConnectRepository}
        >
          <label htmlFor="git-repository-name">
            Repository Name
          </label>

          <input
            id="git-repository-name"
            type="text"
            value={repositoryName}
            onChange={(event) => {
              setRepositoryName(event.target.value);
              setMessage("");
            }}
            disabled={Boolean(connectedRepository)}
            placeholder="mason-forge"
          />

          <label htmlFor="git-repository-path">
            Local Repository Path
          </label>

          <input
            id="git-repository-path"
            type="text"
            value={repositoryPath}
            onChange={(event) => {
              setRepositoryPath(event.target.value);
              setMessage("");
            }}
            disabled={Boolean(connectedRepository)}
            placeholder="C:\MasonForge\Code\mason-forge"
          />

          <label htmlFor="git-branch-name">
            Branch
          </label>

          <input
            id="git-branch-name"
            type="text"
            value={branchName}
            onChange={(event) => {
              setBranchName(event.target.value);
              setMessage("");
            }}
            disabled={Boolean(connectedRepository)}
            placeholder="main"
          />

          {message ? (
            <p className="engineering-planner-form-message">
              {message}
            </p>
          ) : null}

          <div className="engineering-planner-actions">
            {connectedRepository ? (
              <button
                type="button"
                className="secondary-button"
                onClick={handleDisconnectRepository}
              >
                Disconnect Repository
              </button>
            ) : (
              <button type="submit" className="primary-button">
                Connect Repository
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Repository Status</h3>

            <p>
              Review the connected repository, branch, and latest commit.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Branch</th>
              <th>Last Commit</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {connectedRepository ? (
              <tr>
                <td>{connectedRepository.name}</td>
                <td>{connectedRepository.branch}</td>
                <td>
                  {lastCommit
                    ? `${lastCommit.hash} — ${lastCommit.message}`
                    : "No commits created"}
                </td>
                <td>Connected</td>
              </tr>
            ) : (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  Git Bridge has not been configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Pending Changes</h3>

            <p>
              Review files waiting to be included in the next Git commit.
            </p>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={handleAddTestChange}
            disabled={!connectedRepository}
          >
            Add Test Change
          </button>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Type</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {pendingChanges.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  No pending Git changes.
                </td>
              </tr>
            ) : (
              pendingChanges.map((change) => (
                <tr key={change.id}>
                  <td>{change.file}</td>
                  <td>{change.type}</td>
                  <td>{change.status}</td>
                  <td>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => handleRemoveChange(change.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <form
          className="engineering-planner-form"
          onSubmit={handleCommitChanges}
        >
          <label htmlFor="git-commit-message">
            Commit Message
          </label>

          <input
            id="git-commit-message"
            type="text"
            value={commitMessage}
            onChange={(event) => {
              setCommitMessage(event.target.value);
              setMessage("");
            }}
            disabled={
              !connectedRepository || pendingChanges.length === 0
            }
            placeholder="Describe the approved engineering changes..."
          />

          <div className="engineering-planner-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={
                !connectedRepository || pendingChanges.length === 0
              }
            >
              Commit Changes
            </button>
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Commit History</h3>

            <p>
              Review commits created through the Mason Forge Git Bridge.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Commit</th>
              <th>Message</th>
              <th>Branch</th>
              <th>Files</th>
              <th>Created</th>
            </tr>
          </thead>

          <tbody>
            {commitHistory.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ textAlign: "center" }}>
                  No commits have been created.
                </td>
              </tr>
            ) : (
              commitHistory.map((commit) => (
                <tr key={commit.id}>
                  <td>{commit.hash}</td>
                  <td>{commit.message}</td>
                  <td>{commit.branch}</td>
                  <td>{commit.files}</td>
                  <td>{commit.createdAt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}