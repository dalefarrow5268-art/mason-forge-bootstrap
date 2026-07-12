import { useState } from "react";

export default function VSCodeBridge() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceFolder, setWorkspaceFolder] = useState("");
  const [connectedWorkspace, setConnectedWorkspace] = useState(null);
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
      throw new Error("The local Vite API returned an empty response.");
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("The local Vite API returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        data.error || data.message || "Unable to inspect the workspace."
      );
    }

    return data;
  };

  const handleConnectWorkspace = async (event) => {
    event.preventDefault();

    const trimmedName = workspaceName.trim();
    const trimmedFolder = workspaceFolder.trim();

    if (!trimmedName || !trimmedFolder) {
      setMessage("Enter the workspace name and folder path.");
      return;
    }

    setIsLoading(true);
    setMessage("Inspecting local workspace...");

    try {
      const response = await fetch("/api/vscode/workspace/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceFolder: trimmedFolder,
        }),
      });

      const data = await readResponse(response);

      setConnectedWorkspace({
        ...data.workspace,
        displayName: trimmedName,
      });

      setMessage("Local workspace connected and verified.");
    } catch (error) {
      setConnectedWorkspace(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to connect to the local workspace."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshWorkspace = async () => {
    if (!connectedWorkspace) {
      setMessage("Connect a workspace before refreshing.");
      return;
    }

    setIsLoading(true);
    setMessage("Refreshing local workspace...");

    try {
      const response = await fetch("/api/vscode/workspace/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceFolder: connectedWorkspace.folder,
        }),
      });

      const data = await readResponse(response);

      setConnectedWorkspace({
        ...data.workspace,
        displayName: connectedWorkspace.displayName,
      });

      setMessage("Local workspace inspection refreshed.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to refresh the local workspace."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnectWorkspace = () => {
    setConnectedWorkspace(null);
    setMessage("VS Code workspace disconnected.");
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>VS Code Bridge</h2>

          <p className="engineering-planner-subtitle">
            Inspect the real local development workspace through Mason Forge.
          </p>
        </div>

        <div className="engineering-planner-status">
          {isLoading
            ? "Inspecting"
            : connectedWorkspace
              ? "Connected"
              : "Disconnected"}
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Workspace
          </span>

          <strong className="engineering-planner-card-value">
            {connectedWorkspace
              ? connectedWorkspace.displayName
              : "--"}
          </strong>

          <p>
            {connectedWorkspace
              ? connectedWorkspace.folder
              : "No local workspace connected."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Workspace Items
          </span>

          <strong className="engineering-planner-card-value">
            {connectedWorkspace ? connectedWorkspace.itemCount : 0}
          </strong>

          <p>
            {connectedWorkspace
              ? "Top-level items verified by the local API."
              : "No workspace items inspected."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Git Repository
          </span>

          <strong className="engineering-planner-card-value">
            {!connectedWorkspace
              ? "--"
              : connectedWorkspace.hasGitRepository
                ? "Verified"
                : "Not Found"}
          </strong>

          <p>
            {!connectedWorkspace
              ? "Waiting for local workspace inspection."
              : connectedWorkspace.hasGitRepository
                ? "Local Git repository detected."
                : "No local Git repository detected."}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Workspace Connection</h3>

            <p>
              Enter the real local folder Mason Forge should inspect.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleConnectWorkspace}
        >
          <label htmlFor="vscode-workspace-name">
            Workspace Name
          </label>

          <input
            id="vscode-workspace-name"
            type="text"
            value={workspaceName}
            onChange={(event) => {
              setWorkspaceName(event.target.value);
              setMessage("");
            }}
            disabled={Boolean(connectedWorkspace) || isLoading}
            placeholder="Mason Forge"
          />

          <label htmlFor="vscode-workspace-folder">
            Workspace Folder
          </label>

          <input
            id="vscode-workspace-folder"
            type="text"
            value={workspaceFolder}
            onChange={(event) => {
              setWorkspaceFolder(event.target.value);
              setMessage("");
            }}
            disabled={Boolean(connectedWorkspace) || isLoading}
            placeholder="C:\MasonForge\Code\mason-forge-bootstrap"
          />

          {message ? (
            <p className="engineering-planner-form-message">
              {message}
            </p>
          ) : null}

          <div className="engineering-planner-actions">
            {connectedWorkspace ? (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleDisconnectWorkspace}
                  disabled={isLoading}
                >
                  Disconnect Workspace
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={handleRefreshWorkspace}
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
                {isLoading ? "Inspecting..." : "Connect Workspace"}
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Workspace Status</h3>

            <p>
              Verified information returned by the local Vite API.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Folder</th>
              <th>Status</th>
              <th>Last Inspection</th>
            </tr>
          </thead>

          <tbody>
            {connectedWorkspace ? (
              <tr>
                <td>{connectedWorkspace.displayName}</td>
                <td>{connectedWorkspace.folder}</td>
                <td>{connectedWorkspace.status}</td>
                <td>{formatDate(connectedWorkspace.connectedAt)}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  No local workspace has been verified.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Project Detection</h3>

            <p>
              Development project details detected inside the workspace.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Version</th>
              <th>Package File</th>
              <th>Git Repository</th>
              <th>Workspace Items</th>
            </tr>
          </thead>

          <tbody>
            {connectedWorkspace ? (
              <tr>
                <td>{connectedWorkspace.packageName || "--"}</td>
                <td>{connectedWorkspace.packageVersion || "--"}</td>
                <td>
                  {connectedWorkspace.hasPackageJson
                    ? "Detected"
                    : "Not Found"}
                </td>
                <td>
                  {connectedWorkspace.hasGitRepository
                    ? "Detected"
                    : "Not Found"}
                </td>
                <td>{connectedWorkspace.itemCount}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan="5" style={{ textAlign: "center" }}>
                  Connect a workspace to inspect the local project.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}