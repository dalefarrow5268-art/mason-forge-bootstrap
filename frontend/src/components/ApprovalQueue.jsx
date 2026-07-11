import { useEffect, useMemo, useState } from "react";
import { stateManager, eventBus } from "../core";

const createApprovalFromPlan = (plan) => {
  return {
    id: `APPROVAL-${plan.id}`,
    planId: plan.id,
    priority: "Normal",
    plan: plan.objective,
    reviewer: "Dale",
    status: "Pending",
    created: new Date().toLocaleString(),
    decision: "--",
  };
};

export default function ApprovalQueue() {
  const [approvals, setApprovals] = useState(
    () => stateManager.get("approvalQueue") ?? []
  );
  const [planName, setPlanName] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [reviewer, setReviewer] = useState("Dale");
  const [selectedApprovalId, setSelectedApprovalId] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const syncApprovals = (updatedApprovals) => {
      setApprovals(Array.isArray(updatedApprovals) ? updatedApprovals : []);
    };

    const addPlanApproval = (payload) => {
      const plan = payload?.plan;

      if (!plan) {
        return;
      }

      const currentApprovals = stateManager.get("approvalQueue") ?? [];
      const existingApproval = currentApprovals.find(
        (approval) => approval.planId === plan.id
      );

      if (existingApproval) {
        const updatedApprovals = currentApprovals.map((approval) =>
          approval.planId === plan.id
            ? {
                ...approval,
                plan: plan.objective,
                status: "Pending",
                decision: "--",
              }
            : approval
        );

        stateManager.set("approvalQueue", updatedApprovals);
        return;
      }

      const newApproval = createApprovalFromPlan(plan);

      stateManager.set("approvalQueue", [
        newApproval,
        ...currentApprovals,
      ]);
    };

    const removePlanApproval = (payload) => {
      const planId = payload?.planId;

      if (!planId) {
        return;
      }

      const currentApprovals = stateManager.get("approvalQueue") ?? [];

      stateManager.set(
        "approvalQueue",
        currentApprovals.filter(
          (approval) => approval.planId !== planId
        )
      );
    };

    const unsubscribeState = stateManager.subscribe(
      "approvalQueue",
      syncApprovals
    );

    const unsubscribeSubmitted = eventBus.on(
      "engineering-plan-submitted-for-approval",
      addPlanApproval
    );

    const unsubscribeDeleted = eventBus.on(
      "engineering-plan-deleted",
      removePlanApproval
    );

    const currentApprovals = stateManager.get("approvalQueue") ?? [];
    const engineeringPlans =
      stateManager.get("engineeringPlans") ?? [];

    const awaitingPlans = engineeringPlans.filter(
      (plan) => plan.status === "Awaiting Approval"
    );

    const missingApprovals = awaitingPlans
      .filter(
        (plan) =>
          !currentApprovals.some(
            (approval) => approval.planId === plan.id
          )
      )
      .map(createApprovalFromPlan);

    if (missingApprovals.length > 0) {
      stateManager.set("approvalQueue", [
        ...missingApprovals,
        ...currentApprovals,
      ]);
    } else {
      setApprovals(currentApprovals);
    }

    return () => {
      if (typeof unsubscribeState === "function") {
        unsubscribeState();
      }

      if (typeof unsubscribeSubmitted === "function") {
        unsubscribeSubmitted();
      }

      if (typeof unsubscribeDeleted === "function") {
        unsubscribeDeleted();
      }
    };
  }, []);

  const selectedApproval = useMemo(() => {
    return (
      approvals.find(
        (approval) => approval.id === selectedApprovalId
      ) ?? null
    );
  }, [approvals, selectedApprovalId]);

  const pendingCount = useMemo(() => {
    return approvals.filter(
      (approval) => approval.status === "Pending"
    ).length;
  }, [approvals]);

  const approvedCount = useMemo(() => {
    return approvals.filter(
      (approval) => approval.status === "Approved"
    ).length;
  }, [approvals]);

  const rejectedCount = useMemo(() => {
    return approvals.filter(
      (approval) => approval.status === "Rejected"
    ).length;
  }, [approvals]);

  const writeApprovals = (updater) => {
    const currentApprovals =
      stateManager.get("approvalQueue") ?? [];

    const updatedApprovals =
      typeof updater === "function"
        ? updater(currentApprovals)
        : updater;

    stateManager.set("approvalQueue", updatedApprovals);
  };

  const updateEngineeringPlan = (planId, status, stepStatus) => {
    if (!planId) {
      return null;
    }

    const currentPlans =
      stateManager.get("engineeringPlans") ?? [];

    let updatedPlan = null;

    const updatedPlans = currentPlans.map((plan) => {
      if (plan.id !== planId) {
        return plan;
      }

      updatedPlan = {
        ...plan,
        status,
        steps: plan.steps.map((step) => ({
          ...step,
          status: stepStatus,
        })),
      };

      return updatedPlan;
    });

    stateManager.set("engineeringPlans", updatedPlans);

    return updatedPlan;
  };

  const handleCreateApproval = (event) => {
    event.preventDefault();

    if (!planName.trim()) {
      setMessage("Enter an engineering plan.");
      return;
    }

    const approval = {
      id: `APPROVAL-${Date.now()}`,
      planId: null,
      priority,
      plan: planName.trim(),
      reviewer,
      status: "Pending",
      created: new Date().toLocaleString(),
      decision: "--",
    };

    writeApprovals((current) => [approval, ...current]);
    setSelectedApprovalId(approval.id);

    eventBus.emit("approval-request-created", {
      approval,
      approvalId: approval.id,
      timestamp: new Date().toISOString(),
    });

    setPlanName("");
    setPriority("Normal");
    setReviewer("Dale");
    setMessage("Approval request created.");
  };

  const handleApprove = (approval) => {
    const decidedAt = new Date().toISOString();

    const updatedApproval = {
      ...approval,
      status: "Approved",
      decision: "Approved",
      decidedAt,
    };

    writeApprovals((current) =>
      current.map((item) =>
        item.id === approval.id ? updatedApproval : item
      )
    );

    const updatedPlan = updateEngineeringPlan(
      approval.planId,
      "Ready for Build",
      "Approved"
    );

    eventBus.emit("approval-approved", {
      approval: updatedApproval,
      approvalId: approval.id,
      plan: updatedPlan,
      planId: approval.planId,
      timestamp: decidedAt,
    });

    if (updatedPlan) {
      eventBus.emit("engineering-plan-approved", {
        plan: updatedPlan,
        planId: updatedPlan.id,
        timestamp: decidedAt,
      });
    }
  };

  const handleReject = (approval) => {
    const decidedAt = new Date().toISOString();

    const updatedApproval = {
      ...approval,
      status: "Rejected",
      decision: "Rejected",
      decidedAt,
    };

    writeApprovals((current) =>
      current.map((item) =>
        item.id === approval.id ? updatedApproval : item
      )
    );

    const updatedPlan = updateEngineeringPlan(
      approval.planId,
      "Planning",
      "Pending"
    );

    eventBus.emit("approval-rejected", {
      approval: updatedApproval,
      approvalId: approval.id,
      plan: updatedPlan,
      planId: approval.planId,
      timestamp: decidedAt,
    });

    if (updatedPlan) {
      eventBus.emit("engineering-plan-returned-to-planning", {
        plan: updatedPlan,
        planId: updatedPlan.id,
        timestamp: decidedAt,
      });
    }
  };

  const deleteApproval = (approval) => {
    writeApprovals((current) =>
      current.filter((item) => item.id !== approval.id)
    );

    eventBus.emit("approval-request-deleted", {
      approval,
      approvalId: approval.id,
      planId: approval.planId,
      timestamp: new Date().toISOString(),
    });

    if (selectedApprovalId === approval.id) {
      setSelectedApprovalId(null);
    }
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Human Approval Queue</h2>

          <p className="engineering-planner-subtitle">
            Every major engineering decision requires human approval before
            execution.
          </p>
        </div>

        <div className="engineering-planner-status">
          {pendingCount} Pending
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Pending Reviews
          </span>

          <strong className="engineering-planner-card-value">
            {pendingCount}
          </strong>

          <p>
            {pendingCount === 0
              ? "No engineering plans are awaiting review."
              : "Engineering work awaiting approval."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Approved
          </span>

          <strong className="engineering-planner-card-value">
            {approvedCount}
          </strong>

          <p>
            {approvedCount === 0
              ? "No approvals recorded."
              : "Engineering approvals completed."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Rejected
          </span>

          <strong className="engineering-planner-card-value">
            {rejectedCount}
          </strong>

          <p>
            {rejectedCount === 0
              ? "No rejected engineering plans."
              : "Engineering plans require revision."}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Create Approval Request</h3>

            <p>
              Submit engineering work for human review before execution.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleCreateApproval}
        >
          <label htmlFor="approval-plan">
            Engineering Plan
          </label>

          <input
            id="approval-plan"
            type="text"
            value={planName}
            onChange={(event) => {
              setPlanName(event.target.value);
              setMessage("");
            }}
          />

          <label htmlFor="approval-priority">
            Priority
          </label>

          <select
            id="approval-priority"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value)
            }
          >
            <option>Low</option>
            <option>Normal</option>
            <option>High</option>
            <option>Critical</option>
          </select>

          <label htmlFor="approval-reviewer">
            Reviewer
          </label>

          <input
            id="approval-reviewer"
            type="text"
            value={reviewer}
            onChange={(event) =>
              setReviewer(event.target.value)
            }
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
              Submit for Approval
            </button>
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Approval Queue</h3>

            <p>
              Review, approve, reject, or remove engineering decisions.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Priority</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Assigned Reviewer</th>
            </tr>
          </thead>

          <tbody>
            {approvals.length === 0 ? (
              <tr>
                <td
                  colSpan="4"
                  style={{ textAlign: "center" }}
                >
                  No approvals are currently waiting.
                </td>
              </tr>
            ) : (
              approvals.map((approval) => (
                <tr
                  key={approval.id}
                  onClick={() =>
                    setSelectedApprovalId(approval.id)
                  }
                >
                  <td>{approval.priority}</td>
                  <td>{approval.plan}</td>
                  <td>{approval.status}</td>
                  <td>{approval.reviewer}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {selectedApproval && (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedApproval.id}
                </span>

                <h3>{selectedApproval.plan}</h3>

                <p>
                  Reviewer: {selectedApproval.reviewer}
                </p>
              </div>

              <div className="engineering-planner-status">
                {selectedApproval.status}
              </div>
            </div>

            <table className="planner-table">
              <tbody>
                <tr>
                  <td>Priority</td>
                  <td>{selectedApproval.priority}</td>
                </tr>

                <tr>
                  <td>Decision</td>
                  <td>{selectedApproval.decision}</td>
                </tr>

                <tr>
                  <td>Created</td>
                  <td>{selectedApproval.created}</td>
                </tr>
              </tbody>
            </table>

            <div className="engineering-planner-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleReject(selectedApproval)}
              >
                Reject
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => deleteApproval(selectedApproval)}
              >
                Delete
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={() => handleApprove(selectedApproval)}
              >
                Approve
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}