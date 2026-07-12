import { useState } from "react";
import { eventBus } from "../core";

export default function GitBridge() {
  const [repositoryName, setRepositoryName] = useState("");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [connectedRepository, setConnectedRepository] = useState(null);
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const formatDate = (value) => {
    if (!value) {
      return "--";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  };

  const readResponse = async (response) => {
    const text = await response.text();

    if (!text) {
      throw new Error("The local Git API returned an empty response.");
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The local Git API returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Unable to inspect the repository."
      );
    }

    return data;
  };

  const inspectRepository = async (path) => {
    const response = await fetch("/api/git/repository/inspect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repositoryPath: path,
      }),
    });

    return readResponse(response);
  };

  const handleConnectRepository = async (event) => {
    event.preventDefault();

    const trimmedName = repositoryName.trim();
    const trimmedPath = repositoryPath.trim();

    if (!trimmedName || !trimmedPath) {
      setMessage("Enter the repository name and local path.");
      return;
    }

    setIsLoading(true);
    setMessage("Inspecting local Git repository...");

    try {
      const data = await inspectRepository(trimmedPath);

      const repository = {
        ...data.repository,
        displayName: trimmedName,
      };

      setConnectedRepository(repository);

      eventBus.emit("git-repository-connected", {
        repository,
        timestamp: new Date().toISOString(),
      });

      setMessage("Local Git repository connected and verified.");
    } catch (error) {
      setConnectedRepository(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to the local Git repository."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshRepository = async () => {
    if (!connectedRepository) {
      setMessage("Connect a repository before refreshing.");
      return;
    }

    setIsLoading(true);
    setMessage("Refreshing local Git repository...");

    try {
      const data = await inspectRepository(connectedRepository.path);

      const repository = {
        ...data.repository,
        displayName: connectedRepository.displayName,
      };

      setConnectedRepository(repository);

      eventBus.emit("git-repository-refreshed", {
        repository,
        timestamp: new Date().toISOString(),
      });

      setMessage("Local Git repository inspection refreshed.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to refresh the local Git repository."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectRepository = () => {
    const repository = connectedRepository;

    setConnectedRepository(null);

    eventBus.emit("git-repository-disconnected", {
      repository,
      timestamp: new Date().toISOString(),
    });

    setMessage("Git repository disconnected.");
  };

  const connectionStatus = isLoading
    ? "Inspecting"
    : connectedRepository
      ? "Connected"
      : "Not Connected";

  const pendingChangeCount =
    connectedRepository?.changes?.length ?? 0;

  const recentCommits =
    connectedRepository?.recentCommits ?? [];

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Git Bridge</h2>

          <p className="engineering-planner-subtitle">
            Inspect the real local Git repository through Mason Forge.
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
            {connectedRepository
              ? connectedRepository.displayName
              : "--"}
          </strong>

          <p>
            {connectedRepository
              ? connectedRepository.path
              : "No local repository connected."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Current Branch
          </span>

          <strong className="engineering-planner-card-value">
            {connectedRepository
              ? connectedRepository.branch
              : "--"}
          </strong>

          <p>
            {connectedRepository
              ? "Verified active Git branch."
              : "No active branch verified."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Pending Changes
          </span>

          <strong className="engineering-planner-card-value">
            {pendingChangeCount}
          </strong>

          <p>
            {!connectedRepository
              ? "Waiting for repository inspection."
              : pendingChangeCount === 0
                ? "Working tree is clean."
                : `${pendingChangeCount} ${
                    pendingChangeCount === 1 ? "change was" : "changes were"
                  } detected.`}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Repository Connection</h3>

            <p>
              Enter the local Git repository Mason Forge should inspect.
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
            disabled={Boolean(connectedRepository) || isLoading}
            placeholder="Mason Forge"
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
            disabled={Boolean(connectedRepository) || isLoading}
            placeholder="C:\MasonForge\Code\mason-forge-bootstrap"
          />

          {message ? (
            <p className="engineering-planner-form-message">
              {message}
            </p>
          ) : null}

          <div className="engineering-planner-actions">
            {connectedRepository ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleDisconnectRepository}
                  disabled={isLoading}
                >
                  Disconnect Repository
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={handleRefreshRepository}
                  disabled={isLoading}
                >
                  {isLoading ? "Inspecting..." : "Refresh Inspection"}
                </button>
              </>
            ) : (
              <button
                type="submit"
                className="primary-button"
                disabled={isLoading}
              >
                {isLoading ? "Inspecting..." : "Connect Repository"}
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
              Verified information returned by the local Git API.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Repository</th>
              <th>Branch</th>
              <th>Remote</th>
              <th>Head Commit</th>
              <th>Last Inspection</th>
            </tr>
          </thead>

          <tbody>
            {connectedRepository ? (
              <tr>
                <td>{connectedRepository.displayName}</td>
                <td>{connectedRepository.branch}</td>
                <td>{connectedRepository.remote || "Not Configured"}</td>
                <td>
                  {connectedRepository.headCommit
                    ? `${connectedRepository.headCommit.hash} — ${connectedRepository.headCommit.message}`
                    : "No commit detected"}
                </td>
                <td>{formatDate(connectedRepository.inspectedAt)}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan="5" style={{ textAlign: "center" }}>
                  No local Git repository has been verified.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Working Tree</h3>

            <p>
              Real uncommitted changes detected in the local repository.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Index Status</th>
              <th>Working Tree Status</th>
            </tr>
          </thead>

          <tbody>
            {!connectedRepository || pendingChangeCount === 0 ? (
              <tr>
                <td colSpan="3" style={{ textAlign: "center" }}>
                  {connectedRepository
                    ? "Working tree is clean."
                    : "Connect a repository to inspect its working tree."}
                </td>
              </tr>
            ) : (
              connectedRepository.changes.map((change, index) => (
                <tr key={`${change.file}-${index}`}>
                  <td>{change.file}</td>
                  <td>{change.indexStatus}</td>
                  <td>{change.workingTreeStatus}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Recent Commit History</h3>

            <p>
              Recent commits read directly from the local repository.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Commit</th>
              <th>Message</th>
              <th>Author</th>
              <th>Created</th>
            </tr>
          </thead>

          <tbody>
            {recentCommits.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  {connectedRepository
                    ? "No commit history was returned."
                    : "Connect a repository to inspect commit history."}
                </td>
              </tr>
            ) : (
              recentCommits.map((commit) => (
                <tr key={commit.hash}>
                  <td>{commit.hash}</td>
                  <td>{commit.message}</td>
                  <td>{commit.author}</td>
                  <td>{formatDate(commit.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Human Approval Gate</h3>

            <p>
              Git commits and pushes remain disabled until an approved
              execution workflow is connected.
            </p>
          </div>
        </div>

        <div className="engineering-planner-plan-detail">
          <div className="engineering-planner-plan-detail-header">
            <div>
              <span className="engineering-planner-card-label">
                Protected Action
              </span>

              <h3>Commit and Push</h3>
            </div>

            <div className="engineering-planner-status">
              Approval Required
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}