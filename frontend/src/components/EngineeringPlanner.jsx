import { useEffect, useMemo, useState } from "react";
import { stateManager, eventBus } from "../core";

const createPlanId = () => {
  return `MF-PLAN-${Date.now()}`;
};

const createPlanSteps = (objective) => {
  return [
    {
      id: 1,
      title: "Analyze Objective",
      description: `Review the requested engineering objective: ${objective}`,
      status: "Pending",
    },
    {
      id: 2,
      title: "Identify Required Systems",
      description:
        "Determine the components, services, files, integrations, and dependencies required.",
      status: "Pending",
    },
    {
      id: 3,
      title: "Create Implementation Sequence",
      description:
        "Organize the work into atomic, verifiable engineering steps.",
      status: "Pending",
    },
    {
      id: 4,
      title: "Define Verification Requirements",
      description:
        "Establish tests, validation checks, rollback conditions, and approval gates.",
      status: "Pending",
    },
    {
      id: 5,
      title: "Submit for Human Approval",
      description:
        "Route the completed engineering plan to the Human Approval Queue.",
      status: "Pending",
    },
  ];
};

export default function EngineeringPlanner() {
  const [engineeringObjective, setEngineeringObjective] = useState("");
  const [plans, setPlans] = useState(
    () => stateManager.get("engineeringPlans") ?? []
  );
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [formMessage, setFormMessage] = useState("");

  useEffect(() => {
    const unsubscribe = stateManager.subscribe(
      "engineeringPlans",
      (updatedPlans) => {
        setPlans(Array.isArray(updatedPlans) ? updatedPlans : []);
      }
    );

    setPlans(stateManager.get("engineeringPlans") ?? []);

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, []);

  const activePlans = useMemo(() => {
    return plans.filter((plan) => plan.status === "Planning").length;
  }, [plans]);

  const awaitingApproval = useMemo(() => {
    return plans.filter((plan) => plan.status === "Awaiting Approval").length;
  }, [plans]);

  const readyForBuild = useMemo(() => {
    return plans.filter((plan) => plan.status === "Ready for Build").length;
  }, [plans]);

  const selectedPlan = useMemo(() => {
    return plans.find((plan) => plan.id === selectedPlanId) ?? null;
  }, [plans, selectedPlanId]);

  const updatePlans = (updater) => {
    const currentPlans = stateManager.get("engineeringPlans") ?? [];
    const updatedPlans =
      typeof updater === "function" ? updater(currentPlans) : updater;

    stateManager.set("engineeringPlans", updatedPlans);
  };

  const handleObjectiveChange = (event) => {
    setEngineeringObjective(event.target.value);

    if (formMessage) {
      setFormMessage("");
    }
  };

  const handleClear = () => {
    setEngineeringObjective("");
    setFormMessage("");
  };

  const handleGeneratePlan = (event) => {
    event.preventDefault();

    const objective = engineeringObjective.trim();

    if (!objective) {
      setFormMessage("Enter an engineering objective before generating a plan.");
      return;
    }

    const newPlan = {
      id: createPlanId(),
      objective,
      status: "Awaiting Approval",
      createdAt: new Date().toISOString(),
      steps: createPlanSteps(objective),
    };

    updatePlans((currentPlans) => [newPlan, ...currentPlans]);

    eventBus.emit("engineering-plan-created", {
      plan: newPlan,
      planId: newPlan.id,
      timestamp: new Date().toISOString(),
    });

    eventBus.emit("engineering-plan-submitted-for-approval", {
      plan: newPlan,
      planId: newPlan.id,
      timestamp: new Date().toISOString(),
    });

    setSelectedPlanId(newPlan.id);
    setEngineeringObjective("");
    setFormMessage("Engineering plan generated and sent for human approval.");
  };

  const handleApprovePlan = (planId) => {
    let approvedPlan = null;

    updatePlans((currentPlans) =>
      currentPlans.map((plan) => {
        if (plan.id !== planId) {
          return plan;
        }

        approvedPlan = {
          ...plan,
          status: "Ready for Build",
          approvedAt: new Date().toISOString(),
          steps: plan.steps.map((step) => ({
            ...step,
            status: "Approved",
          })),
        };

        return approvedPlan;
      })
    );

    if (approvedPlan) {
      eventBus.emit("engineering-plan-approved", {
        plan: approvedPlan,
        planId,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const handleReturnToPlanning = (planId) => {
    let returnedPlan = null;

    updatePlans((currentPlans) =>
      currentPlans.map((plan) => {
        if (plan.id !== planId) {
          return plan;
        }

        returnedPlan = {
          ...plan,
          status: "Planning",
          returnedToPlanningAt: new Date().toISOString(),
          steps: plan.steps.map((step) => ({
            ...step,
            status: "Pending",
          })),
        };

        return returnedPlan;
      })
    );

    if (returnedPlan) {
      eventBus.emit("engineering-plan-returned-to-planning", {
        plan: returnedPlan,
        planId,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const handleSubmitForApproval = (planId) => {
    let submittedPlan = null;

    updatePlans((currentPlans) =>
      currentPlans.map((plan) => {
        if (plan.id !== planId) {
          return plan;
        }

        submittedPlan = {
          ...plan,
          status: "Awaiting Approval",
          submittedForApprovalAt: new Date().toISOString(),
        };

        return submittedPlan;
      })
    );

    if (submittedPlan) {
      eventBus.emit("engineering-plan-submitted-for-approval", {
        plan: submittedPlan,
        planId,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const handleDeletePlan = (planId) => {
    const deletedPlan =
      (stateManager.get("engineeringPlans") ?? []).find(
        (plan) => plan.id === planId
      ) ?? null;

    updatePlans((currentPlans) =>
      currentPlans.filter((plan) => plan.id !== planId)
    );

    eventBus.emit("engineering-plan-deleted", {
      plan: deletedPlan,
      planId,
      timestamp: new Date().toISOString(),
    });

    if (selectedPlanId === planId) {
      setSelectedPlanId(null);
    }
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Engineering Planner</h2>

          <p className="engineering-planner-subtitle">
            Convert approved product goals into structured engineering plans.
          </p>
        </div>

        <div className="engineering-planner-status">Planner Ready</div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Active Plans
          </span>

          <strong className="engineering-planner-card-value">
            {activePlans}
          </strong>

          <p>
            {activePlans === 0
              ? "No engineering plans are currently active."
              : `${activePlans} engineering ${
                  activePlans === 1 ? "plan is" : "plans are"
                } currently active.`}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Awaiting Approval
          </span>

          <strong className="engineering-planner-card-value">
            {awaitingApproval}
          </strong>

          <p>
            {awaitingApproval === 0
              ? "No plans are waiting for human approval."
              : `${awaitingApproval} ${
                  awaitingApproval === 1 ? "plan is" : "plans are"
                } waiting for human approval.`}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Ready for Build
          </span>

          <strong className="engineering-planner-card-value">
            {readyForBuild}
          </strong>

          <p>
            {readyForBuild === 0
              ? "No approved plans are ready for execution."
              : `${readyForBuild} approved ${
                  readyForBuild === 1 ? "plan is" : "plans are"
                } ready for execution.`}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Create Engineering Plan</h3>

            <p>
              Define the engineering objective Mason Forge should analyze and
              convert into an executable build plan.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={handleGeneratePlan}
        >
          <label htmlFor="engineering-objective">
            Engineering Objective
          </label>

          <textarea
            id="engineering-objective"
            name="engineeringObjective"
            rows="7"
            value={engineeringObjective}
            onChange={handleObjectiveChange}
            placeholder="Describe the feature, system, repair, or improvement Mason Forge should plan..."
          />

          {formMessage ? (
            <p className="engineering-planner-form-message">{formMessage}</p>
          ) : null}

          <div className="engineering-planner-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleClear}
            >
              Clear
            </button>

            <button type="submit" className="primary-button">
              Generate Plan
            </button>
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Engineering Plans</h3>

            <p>
              Review generated plans, inspect their execution steps, and apply
              the human approval gate.
            </p>
          </div>
        </div>

        {plans.length === 0 ? (
          <div className="engineering-planner-empty-state">
            <p>No engineering plans have been generated.</p>
          </div>
        ) : (
          <div className="engineering-planner-plan-layout">
            <div className="engineering-planner-plan-list">
              {plans.map((plan) => (
                <button
                  type="button"
                  key={plan.id}
                  className={`engineering-planner-plan-item ${
                    selectedPlanId === plan.id ? "active" : ""
                  }`}
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  <span className="engineering-planner-plan-item-id">
                    {plan.id}
                  </span>

                  <strong>{plan.objective}</strong>

                  <span className="engineering-planner-plan-item-status">
                    {plan.status}
                  </span>
                </button>
              ))}
            </div>

            {selectedPlan ? (
              <article className="engineering-planner-plan-detail">
                <div className="engineering-planner-plan-detail-header">
                  <div>
                    <span className="engineering-planner-card-label">
                      {selectedPlan.id}
                    </span>

                    <h3>{selectedPlan.objective}</h3>
                  </div>

                  <div className="engineering-planner-status">
                    {selectedPlan.status}
                  </div>
                </div>

                <div className="engineering-planner-step-list">
                  {selectedPlan.steps.map((step) => (
                    <div
                      key={step.id}
                      className="engineering-planner-step"
                    >
                      <div className="engineering-planner-step-number">
                        {step.id}
                      </div>

                      <div>
                        <strong>{step.title}</strong>
                        <p>{step.description}</p>
                      </div>

                      <span className="engineering-planner-step-status">
                        {step.status}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="engineering-planner-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleDeletePlan(selectedPlan.id)}
                  >
                    Delete Plan
                  </button>

                  {selectedPlan.status === "Awaiting Approval" ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          handleReturnToPlanning(selectedPlan.id)
                        }
                      >
                        Return to Planning
                      </button>

                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => handleApprovePlan(selectedPlan.id)}
                      >
                        Approve Plan
                      </button>
                    </>
                  ) : null}

                  {selectedPlan.status === "Planning" ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() =>
                        handleSubmitForApproval(selectedPlan.id)
                      }
                    >
                      Submit for Approval
                    </button>
                  ) : null}
                </div>
              </article>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}