import { useMemo, useState } from "react";

export default function PromptLibrary() {
  const [prompts, setPrompts] = useState([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Engineering");
  const [content, setContent] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState(null);
  const [message, setMessage] = useState("");

  const approvedCount = useMemo(
    () => prompts.filter((prompt) => prompt.status === "Approved").length,
    [prompts]
  );

  const templateCount = useMemo(
    () => prompts.filter((prompt) => prompt.category === "Template").length,
    [prompts]
  );

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) ?? null,
    [prompts, selectedPromptId]
  );

  const handleCreatePrompt = (event) => {
    event.preventDefault();

    if (!name.trim() || !content.trim()) {
      setMessage("Enter a prompt name and prompt content.");
      return;
    }

    const newPrompt = {
      id: `PROMPT-${Date.now()}`,
      name: name.trim(),
      category,
      version: "1.0.0",
      status: "Draft",
      content: content.trim(),
      created: new Date().toLocaleString(),
    };

    setPrompts((current) => [newPrompt, ...current]);
    setSelectedPromptId(newPrompt.id);

    setName("");
    setContent("");
    setCategory("Engineering");

    setMessage("Prompt saved.");
  };

  const updatePrompt = (id, updates) => {
    setPrompts((current) =>
      current.map((prompt) =>
        prompt.id === id ? { ...prompt, ...updates } : prompt
      )
    );
  };

  const deletePrompt = (id) => {
    setPrompts((current) => current.filter((prompt) => prompt.id !== id));

    if (selectedPromptId === id) {
      setSelectedPromptId(null);
    }
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Prompt Library</h2>

          <p className="engineering-planner-subtitle">
            Store, organize, version, and reuse engineering prompts across
            Mason Forge.
          </p>
        </div>

        <div className="engineering-planner-status">
          {prompts.length} Prompt{prompts.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Prompt Collections
          </span>

          <strong className="engineering-planner-card-value">
            {prompts.length}
          </strong>

          <p>
            {prompts.length === 0
              ? "No prompt collections have been created."
              : "Engineering prompt library is growing."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Approved Prompts
          </span>

          <strong className="engineering-planner-card-value">
            {approvedCount}
          </strong>

          <p>
            {approvedCount === 0
              ? "No approved prompts available."
              : "Approved prompts are ready for reuse."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-value">
            {templateCount}
          </span>

          <span className="engineering-planner-card-label">
            Reusable Templates
          </span>

          <p>Engineering templates available.</p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Create Prompt</h3>

            <p>
              Save engineering prompts for future AI workers and reusable
              workflows.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleCreatePrompt}
        >
          <label htmlFor="prompt-name">Prompt Name</label>

          <input
            id="prompt-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <label htmlFor="prompt-category">Category</label>

          <select
            id="prompt-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option>Engineering</option>
            <option>Verification</option>
            <option>Deployment</option>
            <option>Documentation</option>
            <option>Template</option>
          </select>

          <label htmlFor="prompt-content">Prompt</label>

          <textarea
            id="prompt-content"
            rows="8"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Enter the reusable engineering prompt..."
          />

          {message && (
            <p className="engineering-planner-form-message">
              {message}
            </p>
          )}

          <div className="engineering-planner-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setName("");
                setCategory("Engineering");
                setContent("");
              }}
            >
              Clear
            </button>

            <button
              type="submit"
              className="primary-button"
            >
              Save Prompt
            </button>
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Prompt Repository</h3>

            <p>
              Browse, approve, version, and manage engineering prompts.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Version</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            {prompts.length === 0 ? (
              <tr>
                <td
                  colSpan="4"
                  style={{ textAlign: "center" }}
                >
                  No prompts have been added yet.
                </td>
              </tr>
            ) : (
              prompts.map((prompt) => (
                <tr
                  key={prompt.id}
                  onClick={() => setSelectedPromptId(prompt.id)}
                >
                  <td>{prompt.name}</td>
                  <td>{prompt.category}</td>
                  <td>{prompt.version}</td>
                  <td>{prompt.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {selectedPrompt && (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedPrompt.id}
                </span>

                <h3>{selectedPrompt.name}</h3>

                <p>
                  {selectedPrompt.category} • Version{" "}
                  {selectedPrompt.version}
                </p>
              </div>

              <div className="engineering-planner-status">
                {selectedPrompt.status}
              </div>
            </div>

            <pre className="engineering-planner-prompt-preview">
{selectedPrompt.content}
            </pre>

            <div className="engineering-planner-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  updatePrompt(selectedPrompt.id, {
                    status: "Approved",
                  })
                }
              >
                Approve
              </button>

              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  updatePrompt(selectedPrompt.id, {
                    version: (
                      Number(selectedPrompt.version) + 0.1
                    ).toFixed(1),
                  })
                }
              >
                New Version
              </button>

              <button
                className="secondary-button"
                type="button"
                onClick={() => deletePrompt(selectedPrompt.id)}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}