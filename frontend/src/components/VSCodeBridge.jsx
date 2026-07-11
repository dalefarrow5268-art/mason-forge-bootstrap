import { useMemo, useState } from "react";

export default function VSCodeBridge() {
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceFolder, setWorkspaceFolder] = useState("");
  const [connectedWorkspace, setConnectedWorkspace] = useState(null);
  const [managedFiles, setManagedFiles] = useState([]);
  const [filePath, setFilePath] = useState("");
  const [selectedFileId, setSelectedFileId] = useState(null);
  const [message, setMessage] = useState("");

  const selectedFile = useMemo(() => {
    return (
      managedFiles.find((file) => file.id === selectedFileId) ?? null
    );
  }, [managedFiles, selectedFileId]);

  const handleConnectWorkspace = (event) => {
    event.preventDefault();

    const trimmedName = workspaceName.trim();
    const trimmedFolder = workspaceFolder.trim();

    if (!trimmedName || !trimmedFolder) {
      setMessage("Enter the workspace name and folder path.");
      return;
    }

    setConnectedWorkspace({
      id: `WORKSPACE-${Date.now()}`,
      name: trimmedName,
      folder: trimmedFolder,
      status: "Connected",
      lastSync: new Date().toLocaleString(),
    });

    setMessage("VS Code workspace connected.");
  };

  const handleDisconnectWorkspace = () => {
    setConnectedWorkspace(null);
    setManagedFiles([]);
    setSelectedFileId(null);
    setFilePath("");
    setMessage("VS Code workspace disconnected.");
  };

  const handleAddFile = (event) => {
    event.preventDefault();

    if (!connectedWorkspace) {
      setMessage("Connect a workspace before adding files.");
      return;
    }

    const trimmedPath = filePath.trim();

    if (!trimmedPath) {
      setMessage("Enter a file path.");
      return;
    }

    const duplicateFile = managedFiles.some(
      (file) => file.path.toLowerCase() === trimmedPath.toLowerCase()
    );

    if (duplicateFile) {
      setMessage("That file is already managed.");
      return;
    }

    const newFile = {
      id: `FILE-${Date.now()}`,
      path: trimmedPath,
      status: "Open",
      syncStatus: "Synced",
      lastModified: new Date().toLocaleString(),
    };

    setManagedFiles((currentFiles) => [newFile, ...currentFiles]);
    setSelectedFileId(newFile.id);
    setFilePath("");
    setMessage("File added to the VS Code Bridge.");
  };

  const handleCloseFile = (fileId) => {
    setManagedFiles((currentFiles) =>
      currentFiles.filter((file) => file.id !== fileId)
    );

    if (selectedFileId === fileId) {
      setSelectedFileId(null);
    }

    setMessage("File removed from the managed workspace.");
  };

  const handleMarkModified = (fileId) => {
    setManagedFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.id === fileId
          ? {
              ...file,
              syncStatus: "Changes Pending",
              lastModified: new Date().toLocaleString(),
            }
          : file
      )
    );

    setMessage("File marked with pending changes.");
  };

  const handleSyncFile = (fileId) => {
    setManagedFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.id === fileId
          ? {
              ...file,
              syncStatus: "Synced",
              lastModified: new Date().toLocaleString(),
            }
          : file
      )
    );

    setConnectedWorkspace((currentWorkspace) =>
      currentWorkspace
        ? {
            ...currentWorkspace,
            lastSync: new Date().toLocaleString(),
          }
        : currentWorkspace
    );

    setMessage("File synchronized.");
  };

  const handleSyncWorkspace = () => {
    if (!connectedWorkspace) {
      setMessage("Connect a workspace before synchronizing.");
      return;
    }

    setManagedFiles((currentFiles) =>
      currentFiles.map((file) => ({
        ...file,
        syncStatus: "Synced",
        lastModified: new Date().toLocaleString(),
      }))
    );

    setConnectedWorkspace((currentWorkspace) => ({
      ...currentWorkspace,
      lastSync: new Date().toLocaleString(),
    }));

    setMessage("Workspace synchronization complete.");
  };

  const pendingSyncCount = useMemo(() => {
    return managedFiles.filter(
      (file) => file.syncStatus === "Changes Pending"
    ).length;
  }, [managedFiles]);

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>VS Code Bridge</h2>

          <p className="engineering-planner-subtitle">
            Connect Mason Forge directly to the local development workspace.
          </p>
        </div>

        <div className="engineering-planner-status">
          {connectedWorkspace ? "Connected" : "Disconnected"}
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Workspace
          </span>

          <strong className="engineering-planner-card-value">
            {connectedWorkspace ? connectedWorkspace.name : "--"}
          </strong>

          <p>
            {connectedWorkspace
              ? connectedWorkspace.folder
              : "No workspace connected."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Open Files
          </span>

          <strong className="engineering-planner-card-value">
            {managedFiles.length}
          </strong>

          <p>
            {managedFiles.length === 0
              ? "No files currently managed."
              : `${managedFiles.length} ${
                  managedFiles.length === 1 ? "file is" : "files are"
                } currently managed.`}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Sync Status
          </span>

          <strong className="engineering-planner-card-value">
            {!connectedWorkspace
              ? "Offline"
              : pendingSyncCount > 0
                ? "Pending"
                : "Synced"}
          </strong>

          <p>
            {!connectedWorkspace
              ? "Waiting for local bridge connection."
              : pendingSyncCount > 0
                ? `${pendingSyncCount} ${
                    pendingSyncCount === 1 ? "file requires" : "files require"
                  } synchronization.`
                : "Local workspace synchronized."}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Workspace Connection</h3>

            <p>
              Configure the local VS Code workspace Mason Forge should manage.
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
            disabled={Boolean(connectedWorkspace)}
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
            disabled={Boolean(connectedWorkspace)}
            placeholder="C:\MasonForge\Code\mason-forge"
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
                >
                  Disconnect Workspace
                </button>

                <button
                  type="button"
                  className="primary-button"
                  onClick={handleSyncWorkspace}
                >
                  Sync Workspace
                </button>
              </>
            ) : (
              <button type="submit" className="primary-button">
                Connect Workspace
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
              Review the connected workspace and synchronization status.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Workspace</th>
              <th>Folder</th>
              <th>Status</th>
              <th>Last Sync</th>
            </tr>
          </thead>

          <tbody>
            {connectedWorkspace ? (
              <tr>
                <td>{connectedWorkspace.name}</td>
                <td>{connectedWorkspace.folder}</td>
                <td>{connectedWorkspace.status}</td>
                <td>{connectedWorkspace.lastSync}</td>
              </tr>
            ) : (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  VS Code Bridge has not been connected.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Managed Files</h3>

            <p>
              Add files that Mason Forge should track inside the connected
              workspace.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleAddFile}
        >
          <label htmlFor="vscode-file-path">
            File Path
          </label>

          <input
            id="vscode-file-path"
            type="text"
            value={filePath}
            onChange={(event) => {
              setFilePath(event.target.value);
              setMessage("");
            }}
            disabled={!connectedWorkspace}
            placeholder="src/components/Dashboard.jsx"
          />

          <div className="engineering-planner-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={!connectedWorkspace}
            >
              Add File
            </button>
          </div>
        </form>

        <table className="planner-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Status</th>
              <th>Sync Status</th>
              <th>Last Modified</th>
            </tr>
          </thead>

          <tbody>
            {managedFiles.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center" }}>
                  No workspace files are currently managed.
                </td>
              </tr>
            ) : (
              managedFiles.map((file) => (
                <tr
                  key={file.id}
                  onClick={() => setSelectedFileId(file.id)}
                >
                  <td>{file.path}</td>
                  <td>{file.status}</td>
                  <td>{file.syncStatus}</td>
                  <td>{file.lastModified}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {selectedFile ? (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedFile.id}
                </span>

                <h3>{selectedFile.path}</h3>
              </div>

              <div className="engineering-planner-status">
                {selectedFile.syncStatus}
              </div>
            </div>

            <div className="engineering-planner-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleCloseFile(selectedFile.id)}
              >
                Remove File
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => handleMarkModified(selectedFile.id)}
              >
                Mark Modified
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={() => handleSyncFile(selectedFile.id)}
                disabled={selectedFile.syncStatus === "Synced"}
              >
                Sync File
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}