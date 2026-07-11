import { useMemo, useState } from "react";

export default function LocalAIBridge() {
  const [servers, setServers] = useState([]);
  const [computerName, setComputerName] = useState("");
  const [modelName, setModelName] = useState("");
  const [gpuName, setGpuName] = useState("");
  const [selectedServerId, setSelectedServerId] = useState(null);
  const [message, setMessage] = useState("");

  const selectedServer = useMemo(() => {
    return (
      servers.find((server) => server.id === selectedServerId) ?? null
    );
  }, [servers, selectedServerId]);

  const onlineServers = useMemo(() => {
    return servers.filter(
      (server) => server.status === "Online"
    ).length;
  }, [servers]);

  const activeModels = useMemo(() => {
    return servers.filter(
      (server) => server.model !== "--"
    ).length;
  }, [servers]);

  const handleAddServer = (event) => {
    event.preventDefault();

    if (!computerName.trim()) {
      setMessage("Enter the computer name.");
      return;
    }

    const server = {
      id: `AI-${Date.now()}`,
      computer: computerName.trim(),
      model: modelName.trim() || "--",
      gpu: gpuName.trim() || "--",
      status: "Online",
      health: "Healthy",
      jobs: 0,
      connected: new Date().toLocaleString(),
    };

    setServers((current) => [server, ...current]);
    setSelectedServerId(server.id);

    setComputerName("");
    setModelName("");
    setGpuName("");

    setMessage("Local AI server connected.");
  };

  const updateServer = (id, updates) => {
    setServers((current) =>
      current.map((server) =>
        server.id === id ? { ...server, ...updates } : server
      )
    );
  };

  const deleteServer = (id) => {
    setServers((current) =>
      current.filter((server) => server.id !== id)
    );

    if (selectedServerId === id) {
      setSelectedServerId(null);
    }
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Local AI Integration</h2>

          <p className="engineering-planner-subtitle">
            Connect Mason Forge to your local AI lab and engineering
            models.
          </p>
        </div>

        <div className="engineering-planner-status">
          {onlineServers > 0 ? "Online" : "Offline"}
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            AI Servers
          </span>

          <strong className="engineering-planner-card-value">
            {onlineServers}
          </strong>

          <p>
            {onlineServers === 0
              ? "No local AI server connected."
              : "Engineering infrastructure available."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Active Models
          </span>

          <strong className="engineering-planner-card-value">
            {activeModels}
          </strong>

          <p>
            {activeModels === 0
              ? "No AI models loaded."
              : "Engineering models are available."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            GPU Status
          </span>

          <strong className="engineering-planner-card-value">
            {onlineServers > 0 ? "Online" : "Unknown"}
          </strong>

          <p>
            {onlineServers === 0
              ? "Waiting for hardware connection."
              : "GPU resources available."}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Add Local AI Server</h3>

            <p>
              Register AI workstations and engineering inference nodes.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleAddServer}
        >
          <label htmlFor="computer-name">
            Computer Name
          </label>

          <input
            id="computer-name"
            value={computerName}
            onChange={(event) => {
              setComputerName(event.target.value);
              setMessage("");
            }}
            type="text"
          />

          <label htmlFor="model-name">
            AI Model
          </label>

          <input
            id="model-name"
            value={modelName}
            onChange={(event) =>
              setModelName(event.target.value)
            }
            type="text"
            placeholder="llama3, qwen, deepseek..."
          />

          <label htmlFor="gpu-name">
            GPU
          </label>

          <input
            id="gpu-name"
            value={gpuName}
            onChange={(event) =>
              setGpuName(event.target.value)
            }
            type="text"
          />

          {message && (
            <p className="engineering-planner-form-message">
              {message}
            </p>
          )}

          <div className="engineering-planner-actions">
            <button
              className="primary-button"
              type="submit"
            >
              Connect AI Server
            </button>
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Local AI Infrastructure</h3>

            <p>
              Monitor engineering computers, models, GPU resources,
              health, and workload.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Computer</th>
              <th>Model</th>
              <th>Status</th>
              <th>Health</th>
            </tr>
          </thead>

          <tbody>
            {servers.length === 0 ? (
              <tr>
                <td
                  colSpan="4"
                  style={{ textAlign: "center" }}
                >
                  No local AI infrastructure connected.
                </td>
              </tr>
            ) : (
              servers.map((server) => (
                <tr
                  key={server.id}
                  onClick={() =>
                    setSelectedServerId(server.id)
                  }
                >
                  <td>{server.computer}</td>
                  <td>{server.model}</td>
                  <td>{server.status}</td>
                  <td>{server.health}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {selectedServer && (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedServer.id}
                </span>

                <h3>{selectedServer.computer}</h3>

                <p>
                  {selectedServer.model}
                </p>
              </div>

              <div className="engineering-planner-status">
                {selectedServer.status}
              </div>
            </div>

            <table className="planner-table">
              <tbody>
                <tr>
                  <td>GPU</td>
                  <td>{selectedServer.gpu}</td>
                </tr>

                <tr>
                  <td>Health</td>
                  <td>{selectedServer.health}</td>
                </tr>

                <tr>
                  <td>Engineering Jobs</td>
                  <td>{selectedServer.jobs}</td>
                </tr>

                <tr>
                  <td>Connected</td>
                  <td>{selectedServer.connected}</td>
                </tr>
              </tbody>
            </table>

            <div className="engineering-planner-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  updateServer(selectedServer.id, {
                    status:
                      selectedServer.status === "Online"
                        ? "Offline"
                        : "Online",
                  })
                }
              >
                Toggle Status
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  updateServer(selectedServer.id, {
                    jobs: selectedServer.jobs + 1,
                  })
                }
              >
                Assign Job
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  deleteServer(selectedServer.id)
                }
              >
                Remove Server
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}