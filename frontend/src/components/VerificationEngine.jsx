import { useEffect, useMemo, useState } from "react";
import { stateManager, eventBus } from "../core";

export default function VerificationEngine() {
  const [verificationJobs, setVerificationJobs] = useState(
    () => stateManager.get("verificationJobs") ?? []
  );
  const [jobName, setJobName] = useState("");
  const [jobType, setJobType] = useState("Unit Test");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const syncVerificationJobs = (updatedJobs) => {
      setVerificationJobs(
        Array.isArray(updatedJobs) ? updatedJobs : []
      );
    };

    const createJobFromCommit = (payload) => {
      const commit = payload?.commit;

      if (!commit) {
        return;
      }

      const currentJobs =
        stateManager.get("verificationJobs") ?? [];

      const existingJob = currentJobs.find(
        (job) => job.commitId === commit.id
      );

      if (existingJob) {
        return;
      }

      const newJob = {
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

      stateManager.set("verificationJobs", [
        newJob,
        ...currentJobs,
      ]);

      eventBus.emit("verification-job-created", {
        job: newJob,
        jobId: newJob.id,
        commit,
        commitId: commit.id,
        timestamp: new Date().toISOString(),
      });
    };

    const unsubscribeJobs = stateManager.subscribe(
      "verificationJobs",
      syncVerificationJobs
    );

    const unsubscribeCommit = eventBus.on(
      "git-changes-committed",
      createJobFromCommit
    );

    setVerificationJobs(
      stateManager.get("verificationJobs") ?? []
    );

    return () => {
      if (typeof unsubscribeJobs === "function") {
        unsubscribeJobs();
      }

      if (typeof unsubscribeCommit === "function") {
        unsubscribeCommit();
      }
    };
  }, []);

  const selectedJob = useMemo(() => {
    return (
      verificationJobs.find((job) => job.id === selectedJobId) ?? null
    );
  }, [verificationJobs, selectedJobId]);

  const pendingCount = useMemo(() => {
    return verificationJobs.filter(
      (job) => job.status === "Pending"
    ).length;
  }, [verificationJobs]);

  const passedCount = useMemo(() => {
    return verificationJobs.filter(
      (job) => job.result === "Passed"
    ).length;
  }, [verificationJobs]);

  const failedCount = useMemo(() => {
    return verificationJobs.filter(
      (job) => job.result === "Failed"
    ).length;
  }, [verificationJobs]);

  const writeVerificationJobs = (updater) => {
    const currentJobs =
      stateManager.get("verificationJobs") ?? [];

    const updatedJobs =
      typeof updater === "function"
        ? updater(currentJobs)
        : updater;

    stateManager.set("verificationJobs", updatedJobs);

    return updatedJobs;
  };

  const createVerificationJob = (event) => {
    event.preventDefault();

    if (!jobName.trim()) {
      setMessage("Enter a verification job.");
      return;
    }

    const newJob = {
      id: `VERIFY-${Date.now()}`,
      commitId: null,
      commitHash: null,
      planIds: [],
      name: jobName.trim(),
      type: jobType,
      status: "Pending",
      result: "Waiting",
      created: new Date().toLocaleString(),
      duration: "--",
    };

    writeVerificationJobs((current) => [
      newJob,
      ...current,
    ]);

    setSelectedJobId(newJob.id);
    setJobName("");
    setJobType("Unit Test");

    eventBus.emit("verification-job-created", {
      job: newJob,
      jobId: newJob.id,
      timestamp: new Date().toISOString(),
    });

    setMessage("Verification job created.");
  };

  const runJob = (id, passed) => {
    const completedAt = new Date().toISOString();
    let completedJob = null;

    writeVerificationJobs((current) =>
      current.map((job) => {
        if (job.id !== id) {
          return job;
        }

        completedJob = {
          ...job,
          status: "Completed",
          result: passed ? "Passed" : "Failed",
          duration: `${Math.floor(Math.random() * 5) + 1}s`,
          completedAt,
        };

        return completedJob;
      })
    );

    if (!completedJob) {
      return;
    }

    if (passed) {
      eventBus.emit("verification-job-passed", {
        job: completedJob,
        jobId: completedJob.id,
        commitId: completedJob.commitId,
        planIds: completedJob.planIds,
        timestamp: completedAt,
      });
    } else {
      eventBus.emit("verification-job-failed", {
        job: completedJob,
        jobId: completedJob.id,
        commitId: completedJob.commitId,
        planIds: completedJob.planIds,
        timestamp: completedAt,
      });
    }

    eventBus.emit("verification-job-completed", {
      job: completedJob,
      jobId: completedJob.id,
      result: completedJob.result,
      commitId: completedJob.commitId,
      planIds: completedJob.planIds,
      timestamp: completedAt,
    });

    setMessage(
      passed
        ? "Verification passed."
        : "Verification failed."
    );
  };

  const deleteJob = (id) => {
    const deletedJob =
      (stateManager.get("verificationJobs") ?? []).find(
        (job) => job.id === id
      ) ?? null;

    writeVerificationJobs((current) =>
      current.filter((job) => job.id !== id)
    );

    eventBus.emit("verification-job-deleted", {
      job: deletedJob,
      jobId: id,
      commitId: deletedJob?.commitId ?? null,
      timestamp: new Date().toISOString(),
    });

    if (selectedJobId === id) {
      setSelectedJobId(null);
    }
  };

  return (
    <section className="engineering-planner">
      <div className="engineering-planner-header">
        <div>
          <h2>Verification Engine</h2>

          <p className="engineering-planner-subtitle">
            Automatically verify every engineering change before it reaches
            production.
          </p>
        </div>

        <div className="engineering-planner-status">
          Ready
        </div>
      </div>

      <div className="engineering-planner-grid">
        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Pending Tests
          </span>

          <strong className="engineering-planner-card-value">
            {pendingCount}
          </strong>

          <p>
            {pendingCount === 0
              ? "No verification jobs queued."
              : `${pendingCount} verification ${
                  pendingCount === 1 ? "job is" : "jobs are"
                } waiting.`}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Passed
          </span>

          <strong className="engineering-planner-card-value">
            {passedCount}
          </strong>

          <p>
            {passedCount === 0
              ? "No completed verification jobs."
              : "Successful engineering validations."}
          </p>
        </article>

        <article className="engineering-planner-card">
          <span className="engineering-planner-card-label">
            Failed
          </span>

          <strong className="engineering-planner-card-value">
            {failedCount}
          </strong>

          <p>
            {failedCount === 0
              ? "No failed verification jobs."
              : "Engineering attention required."}
          </p>
        </article>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Create Verification Job</h3>

            <p>
              Schedule automated validation before deployment.
            </p>
          </div>
        </div>

        <form
          className="engineering-planner-form"
          onSubmit={createVerificationJob}
        >
          <label htmlFor="verification-name">
            Verification Job
          </label>

          <input
            id="verification-name"
            type="text"
            value={jobName}
            onChange={(event) => {
              setJobName(event.target.value);
              setMessage("");
            }}
          />

          <label htmlFor="verification-type">
            Verification Type
          </label>

          <select
            id="verification-type"
            value={jobType}
            onChange={(event) =>
              setJobType(event.target.value)
            }
          >
            <option>Unit Test</option>
            <option>Integration Test</option>
            <option>Regression Test</option>
            <option>UI Validation</option>
            <option>Security Scan</option>
            <option>Performance Test</option>
          </select>

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
              Queue Verification
            </button>
          </div>
        </form>
      </div>

      <div className="engineering-planner-workspace">
        <div className="engineering-planner-workspace-header">
          <div>
            <h3>Verification Queue</h3>

            <p>
              Execute, review, and approve engineering verification jobs.
            </p>
          </div>
        </div>

        <table className="planner-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Type</th>
              <th>Status</th>
              <th>Result</th>
            </tr>
          </thead>

          <tbody>
            {verificationJobs.length === 0 ? (
              <tr>
                <td
                  colSpan="4"
                  style={{ textAlign: "center" }}
                >
                  No verification jobs available.
                </td>
              </tr>
            ) : (
              verificationJobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                >
                  <td>{job.name}</td>
                  <td>{job.type}</td>
                  <td>{job.status}</td>
                  <td>{job.result}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {selectedJob && (
          <div className="engineering-planner-plan-detail">
            <div className="engineering-planner-plan-detail-header">
              <div>
                <span className="engineering-planner-card-label">
                  {selectedJob.id}
                </span>

                <h3>{selectedJob.name}</h3>

                <p>
                  {selectedJob.type}
                </p>
              </div>

              <div className="engineering-planner-status">
                {selectedJob.result}
              </div>
            </div>

            <table className="planner-table">
              <tbody>
                <tr>
                  <td>Status</td>
                  <td>{selectedJob.status}</td>
                </tr>

                <tr>
                  <td>Result</td>
                  <td>{selectedJob.result}</td>
                </tr>

                <tr>
                  <td>Duration</td>
                  <td>{selectedJob.duration}</td>
                </tr>

                <tr>
                  <td>Created</td>
                  <td>{selectedJob.created}</td>
                </tr>
              </tbody>
            </table>

            <div className="engineering-planner-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => runJob(selectedJob.id, true)}
              >
                Pass
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => runJob(selectedJob.id, false)}
              >
                Fail
              </button>

              <button
                type="button"
                className="secondary-button"
                onClick={() => deleteJob(selectedJob.id)}
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