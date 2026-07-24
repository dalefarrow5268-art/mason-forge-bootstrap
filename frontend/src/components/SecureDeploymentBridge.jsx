import { useState } from "react";
import { requestMasonDeployment } from "../services/masonCloud";

export default function SecureDeploymentBridge() {
  const [approvalToken, setApprovalToken] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("IDLE");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!approvalToken.trim()) {
      setError("Enter the authorized human approval token.");
      return;
    }
    if (!reason.trim()) {
      setError("Enter the reason for this production deployment.");
      return;
    }

    setStatus("REQUESTING");
    setError("");
    setResult(null);
    try {
      const payload = await requestMasonDeployment({ approvalToken: approvalToken.trim(), reason: reason.trim() });
      setResult(payload);
      setStatus("REQUESTED");
      setApprovalToken("");
    } catch (requestError) {
      setError(String(requestError?.message || requestError));
      setStatus("FAILED");
    }
  }

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <p className="section-label">Protected Release Control</p>
          <h2>Deployment Bridge</h2>
          <p className="engineering-planner-subtitle">
            Dispatch the approved GitHub workflow without exposing GitHub or Mason Forge credentials to the browser.
          </p>
        </div>
        <div className="engineering-planner-status">{status}</div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">Source</span>
          <strong className="engineering-planner-card-value">main</strong>
          <p>Production releases are restricted to the verified main branch.</p>
        </article>
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">Target</span>
          <strong className="engineering-planner-card-value">Cloudflare</strong>
          <p>Mason Forge Worker, D1 migrations, queues, and health verification.</p>
        </article>
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">Approval</span>
          <strong className="engineering-planner-card-value">Required</strong>
          <p>A server-validated human approval token is mandatory.</p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Request Production Deployment</h3>
            <p>A successful request is not proof of deployment. Workflow and Cloudflare evidence must confirm completion.</p>
          </div>
        </div>

        <form className="engineering-planner-form" onSubmit={submit}>
          <label htmlFor="deployment-reason">Deployment reason</label>
          <textarea
            id="deployment-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Describe the approved changes and expected result."
          />

          <label htmlFor="deployment-approval-token">Human approval token</label>
          <input
            id="deployment-approval-token"
            type="password"
            value={approvalToken}
            onChange={(event) => setApprovalToken(event.target.value)}
            autoComplete="off"
          />

          <button type="submit" disabled={status === "REQUESTING"}>
            {status === "REQUESTING" ? "Requesting…" : "Request Production Deployment"}
          </button>
        </form>

        {error ? <div className="engineering-planner-empty-state"><strong>Request failed</strong><p>{error}</p></div> : null}
        {result ? (
          <div className="engineering-planner-empty-state">
            <strong>Workflow request accepted</strong>
            <p>{result.message}</p>
            <p>Requested: {result.requestedAt}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
