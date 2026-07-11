/**
 * Mason Forge™
 * WorkflowCoordinator
 *
 * Coordinates the shared engineering workflow across Mason Forge.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

class WorkflowCoordinator {
  constructor({ stateManager, eventBus }) {
    this.stateManager = stateManager;
    this.eventBus = eventBus;
    this.subscriptions = [];
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) {
      return this.getStatus();
    }

    this.subscriptions.push(
      this.eventBus.on(
        "engineering-plan-submitted-for-approval",
        (payload) => this.handlePlanSubmitted(payload)
      )
    );

    this.subscriptions.push(
      this.eventBus.on(
        "engineering-plan-approved",
        (payload) => this.handlePlanApproved(payload)
      )
    );

    this.subscriptions.push(
      this.eventBus.on(
        "engineering-plan-deleted",
        (payload) => this.handlePlanDeleted(payload)
      )
    );

    this.subscriptions.push(
      this.eventBus.on(
        "engineering-job-created",
        (payload) => this.handleEngineeringJobCreated(payload)
      )
    );

    this.subscriptions.push(
      this.eventBus.on(
        "git-changes-committed",
        (payload) => this.handleGitCommit(payload)
      )
    );

    this.subscriptions.push(
      this.eventBus.on(
        "verification-job-passed",
        (payload) => this.handleVerificationPassed(payload)
      )
    );

    this.initialized = true;

    this.eventBus.emit("workflow-coordinator-initialized", {
      status: "Operational",
      timestamp: new Date().toISOString(),
    });

    return this.getStatus();
  }

  handlePlanSubmitted(payload) {
    const plan = payload?.plan;

    if (!plan) {
      return;
    }

    const approvals =
      this.stateManager.get("approvalQueue") ?? [];

    const existingApproval = approvals.find(
      (approval) => approval.planId === plan.id
    );

    if (existingApproval) {
      const updatedApprovals = approvals.map((approval) =>
        approval.planId === plan.id
          ? {
              ...approval,
              plan: plan.objective,
              status: "Pending",
              decision: "--",
            }
          : approval
      );

      this.stateManager.set(
        "approvalQueue",
        updatedApprovals
      );

      return;
    }

    const approval = {
      id: `APPROVAL-${plan.id}`,
      planId: plan.id,
      priority: "Normal",
      plan: plan.objective,
      reviewer: "Dale",
      status: "Pending",
      created: new Date().toLocaleString(),
      decision: "--",
    };

    this.stateManager.set("approvalQueue", [
      approval,
      ...approvals,
    ]);

    this.eventBus.emit("approval-request-created", {
      approval,
      approvalId: approval.id,
      plan,
      planId: plan.id,
      timestamp: new Date().toISOString(),
    });
  }

  handlePlanApproved(payload) {
    const plan = payload?.plan;

    if (!plan) {
      return;
    }

    const engineeringJobs =
      this.stateManager.get("engineeringJobs") ?? [];

    const existingJob = engineeringJobs.find(
      (job) => job.planId === plan.id
    );

    if (existingJob) {
      return;
    }

    const workers =
      this.stateManager.get("aiWorkers") ?? [];

    const buildEngine = workers.find(
      (worker) => worker.id === "MF-AI-003"
    );

    if (!buildEngine || buildEngine.status !== "Online") {
      this.eventBus.emit(
        "engineering-job-assignment-failed",
        {
          plan,
          planId: plan.id,
          reason: "Build Engine is not online.",
          timestamp: new Date().toISOString(),
        }
      );

      return;
    }

    const engineeringJob = {
      id: `MF-JOB-${plan.id}`,
      planId: plan.id,
      title: plan.objective,
      assignedWorkerId: buildEngine.id,
      assignedWorkerName: buildEngine.name,
      status: "Assigned",
      createdAt: new Date().toISOString(),
    };

    const updatedWorkers = workers.map((worker) =>
      worker.id === buildEngine.id
        ? {
            ...worker,
            currentJob: plan.objective,
          }
        : worker
    );

    this.stateManager.set("aiWorkers", updatedWorkers);

    this.stateManager.set("engineeringJobs", [
      engineeringJob,
      ...engineeringJobs,
    ]);

    this.eventBus.emit("engineering-job-created", {
      job: engineeringJob,
      jobId: engineeringJob.id,
      plan,
      planId: plan.id,
      timestamp: new Date().toISOString(),
    });

    this.eventBus.emit("engineering-job-assigned", {
      job: engineeringJob,
      jobId: engineeringJob.id,
      worker: buildEngine,
      workerId: buildEngine.id,
      planId: plan.id,
      timestamp: new Date().toISOString(),
    });
  }

  handlePlanDeleted(payload) {
    const planId = payload?.planId;

    if (!planId) {
      return;
    }

    const approvals =
      this.stateManager.get("approvalQueue") ?? [];

    this.stateManager.set(
      "approvalQueue",
      approvals.filter(
        (approval) => approval.planId !== planId
      )
    );
  }

  handleEngineeringJobCreated(payload) {
    const job = payload?.job;

    if (!job) {
      return;
    }

    const gitChanges =
      this.stateManager.get("gitChanges") ?? [];

    const existingChange = gitChanges.find(
      (change) => change.jobId === job.id
    );

    if (existingChange) {
      return;
    }

    const gitChange = {
      id: `CHANGE-${job.id}`,
      jobId: job.id,
      planId: job.planId,
      file: `src/generated/${job.id}.js`,
      type: "Generated",
      status: "Pending",
      description: job.title,
      createdAt: new Date().toISOString(),
    };

    this.stateManager.set("gitChanges", [
      gitChange,
      ...gitChanges,
    ]);

    this.eventBus.emit("git-change-created", {
      change: gitChange,
      changeId: gitChange.id,
      job,
      jobId: job.id,
      planId: job.planId,
      timestamp: new Date().toISOString(),
    });
  }

  handleGitCommit(payload) {
    const commit = payload?.commit;

    if (!commit) {
      return;
    }

    const verificationJobs =
      this.stateManager.get("verificationJobs") ?? [];

    const existingJob = verificationJobs.find(
      (job) => job.commitId === commit.id
    );

    if (existingJob) {
      return;
    }

    const verificationJob = {
      id: `VERIFY-${commit.id}`,
      commitId: commit.id,
      commitHash: commit.hash,
      planIds: [
        ...new Set(
          (payload.changes ?? [])
            .map((change) => change.planId)
            .filter(Boolean)
        ),
      ],
      name: `Verify commit: ${commit.message}`,
      type: "Integration Test",
      status: "Pending",
      result: "Waiting",
      created: new Date().toLocaleString(),
      duration: "--",
    };

    this.stateManager.set("verificationJobs", [
      verificationJob,
      ...verificationJobs,
    ]);

    this.eventBus.emit("verification-job-created", {
      job: verificationJob,
      jobId: verificationJob.id,
      commit,
      commitId: commit.id,
      timestamp: new Date().toISOString(),
    });
  }

  handleVerificationPassed(payload) {
    const verificationJob = payload?.job;

    if (!verificationJob) {
      return;
    }

    const deployments =
      this.stateManager.get("deployments") ?? [];

    const existingDeployment = deployments.find(
      (deployment) =>
        deployment.verificationJobId === verificationJob.id
    );

    if (existingDeployment) {
      return;
    }

    const deployment = {
      id: `DEPLOY-${verificationJob.id}`,
      verificationJobId: verificationJob.id,
      commitId: verificationJob.commitId,
      planIds: verificationJob.planIds ?? [],
      environment: "development",
      environmentName: "Development",
      version:
        verificationJob.commitHash ?? "Verified Build",
      description: verificationJob.name,
      status: "Queued",
      approvalStatus: "Not Required",
      createdAt: new Date().toLocaleString(),
      deployedAt: "--",
    };

    this.stateManager.set("deployments", [
      deployment,
      ...deployments,
    ]);

    this.eventBus.emit("deployment-queued", {
      deployment,
      deploymentId: deployment.id,
      verificationJob,
      verificationJobId: verificationJob.id,
      commitId: verificationJob.commitId,
      planIds: verificationJob.planIds ?? [],
      timestamp: new Date().toISOString(),
    });
  }

  destroy() {
    this.subscriptions.forEach((unsubscribe) => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    });

    this.subscriptions = [];
    this.initialized = false;
  }

  getStatus() {
    return {
      name: "Mason Forge Workflow Coordinator",
      status: this.initialized
        ? "Operational"
        : "Not Initialized",
      subscriptions: this.subscriptions.length,
      timestamp: new Date().toISOString(),
    };
  }
}

export default WorkflowCoordinator;