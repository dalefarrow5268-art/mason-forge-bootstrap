import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const WORKER_HEALTH = "https://mason-forge-cloud.mason-forge-ssx.workers.dev/health";
const DASHBOARD_BOOTSTRAP = "https://mason-forge-live.vercel.app/api/mason";
const REPORT_PATH = resolve(process.env.VERIFY_REPORT_PATH || "../runtime-verification/latest.json");
const EXPECTED_RELEASE = process.env.EXPECTED_RELEASE_ID || null;
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const isoNow = () => new Date().toISOString();

async function getJson(url, label) {
  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}_verify=${Date.now()}-${Math.random()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
    headers: { "cache-control": "no-cache, no-store, max-age=0", pragma: "no-cache" },
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON (${response.status}): ${text.slice(0, 1000)}`);
  }
  return { status: response.status, ok: response.ok, data };
}

function countStatuses(rows = []) {
  return Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count || 0)]));
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function validateDashboard(snapshot, health) {
  const errors = [];
  const data = snapshot.data;
  const retrievedMs = Date.parse(data.retrievedAt || "");
  if (!snapshot.ok) errors.push(`Dashboard HTTP ${snapshot.status}`);
  if (!Number.isFinite(retrievedMs) || Date.now() - retrievedMs > 120000) errors.push("Dashboard retrievedAt is missing or stale.");
  if (!data.continuity) errors.push("Dashboard continuity is null.");
  if (data.continuity && data.continuity.verification_status !== "VERIFIED") errors.push("Dashboard continuity is not VERIFIED.");

  const globalTasks = countStatuses(data.taskTotals || []);
  const projectTasks = {};
  for (const status of ["QUEUED", "RUNNING", "BLOCKED", "COMPLETED", "FAILED", "CANCELED"]) {
    const field = `${status.toLowerCase()}_tasks`;
    projectTasks[status] = sum((data.projects || []).map((project) => project[field]));
    if (projectTasks[status] !== Number(globalTasks[status] || 0)) {
      errors.push(`Project ${status} count ${projectTasks[status]} does not match global ${Number(globalTasks[status] || 0)}.`);
    }
  }
  const projectFiles = sum((data.projects || []).map((project) => project.file_count));
  if (projectFiles !== Number(health.files || 0)) errors.push(`Project files ${projectFiles} do not match health files ${Number(health.files || 0)}.`);
  if (Number(data.outputCount || 0) < 1) errors.push("Dashboard has no department outputs.");
  if (Number(globalTasks.BLOCKED || 0) !== 0) errors.push(`Dashboard has ${globalTasks.BLOCKED} blocked tasks.`);
  if (Number(globalTasks.FAILED || 0) !== 0) errors.push(`Dashboard has ${globalTasks.FAILED} failed tasks.`);

  return { errors, globalTasks, projectTasks, projectFiles };
}

function validateHealth(result) {
  const errors = [];
  const health = result.data;
  if (!result.ok) errors.push(`Health HTTP ${result.status}`);
  if (health.status !== "online") errors.push(`Health status is ${health.status || "missing"}.`);
  if (health.operationalReady !== true) errors.push("operationalReady is not true.");
  if (health.continuity?.verification_status !== "VERIFIED") errors.push("Health continuity is not VERIFIED.");
  if (Number(health.taskTotals?.BLOCKED || 0) !== 0) errors.push(`Health has ${health.taskTotals.BLOCKED} blocked tasks.`);
  if (Number(health.taskTotals?.FAILED || 0) !== 0) errors.push(`Health has ${health.taskTotals.FAILED} failed tasks.`);
  if (Number(health.staleRunningTasks || 0) !== 0) errors.push(`Health has ${health.staleRunningTasks} stale tasks.`);
  if (Number(health.staleExtractionJobs || 0) !== 0) errors.push(`Health has ${health.staleExtractionJobs} stale extraction jobs.`);
  if (health.countsReconcile !== true) errors.push("Health counts do not reconcile.");
  if (Number(health.outputCount || 0) < 1) errors.push("Health has no outputs.");
  if (EXPECTED_RELEASE && health.releaseId !== EXPECTED_RELEASE) errors.push(`Release ${health.releaseId} does not match ${EXPECTED_RELEASE}.`);
  const extraction = health.extraction || {};
  const extractionTotal = sum([extraction.extracted, extraction.queued, extraction.extracting, extraction.retrying, extraction.failed, extraction.pending]);
  if (extractionTotal !== Number(health.files || 0)) errors.push(`Extraction accounting ${extractionTotal} does not match ${Number(health.files || 0)} files.`);
  return errors;
}

const report = {
  schemaVersion: 1,
  startedAt: isoNow(),
  completedAt: null,
  success: false,
  worker: null,
  dashboardSamples: [],
  progression: null,
  errors: [],
};

try {
  let healthResult;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    healthResult = await getJson(WORKER_HEALTH, "Worker health");
    const errors = validateHealth(healthResult);
    report.worker = { attempt, httpStatus: healthResult.status, data: healthResult.data, errors };
    if (!errors.length) break;
    if (attempt < 30) await sleep(10000);
  }
  if (report.worker?.errors?.length) report.errors.push(...report.worker.errors);

  const first = await getJson(DASHBOARD_BOOTSTRAP, "Dashboard bootstrap");
  const firstValidation = validateDashboard(first, healthResult.data);
  report.dashboardSamples.push({ capturedAt: isoNow(), httpStatus: first.status, data: first.data, ...firstValidation });

  let second = first;
  let secondValidation = firstValidation;
  const activeAtStart = Number(firstValidation.globalTasks.QUEUED || 0) + Number(firstValidation.globalTasks.RUNNING || 0) > 0;
  let progressionProved = !activeAtStart;

  for (let attempt = 1; attempt <= (activeAtStart ? 12 : 1); attempt += 1) {
    await sleep(activeAtStart ? 30000 : 2000);
    second = await getJson(DASHBOARD_BOOTSTRAP, "Dashboard bootstrap");
    secondValidation = validateDashboard(second, healthResult.data);
    const firstOutput = Number(first.data.outputCount || 0);
    const secondOutput = Number(second.data.outputCount || 0);
    const firstCompleted = Number(firstValidation.globalTasks.COMPLETED || 0);
    const secondCompleted = Number(secondValidation.globalTasks.COMPLETED || 0);
    progressionProved = secondOutput > firstOutput || secondCompleted > firstCompleted;
    if (progressionProved || !activeAtStart) break;
  }

  report.dashboardSamples.push({ capturedAt: isoNow(), httpStatus: second.status, data: second.data, ...secondValidation });
  const timestampsFresh = first.data.retrievedAt && second.data.retrievedAt && first.data.retrievedAt !== second.data.retrievedAt;
  const outputsNondecreasing = Number(second.data.outputCount || 0) >= Number(first.data.outputCount || 0);
  report.progression = {
    activeAtStart,
    progressionProved,
    timestampsFresh,
    outputsNondecreasing,
    firstOutputCount: Number(first.data.outputCount || 0),
    secondOutputCount: Number(second.data.outputCount || 0),
    firstCompleted: Number(firstValidation.globalTasks.COMPLETED || 0),
    secondCompleted: Number(secondValidation.globalTasks.COMPLETED || 0),
  };

  report.errors.push(...firstValidation.errors, ...secondValidation.errors);
  if (!timestampsFresh) report.errors.push("Dashboard responses did not provide distinct fresh timestamps.");
  if (!outputsNondecreasing) report.errors.push("Output count decreased between samples.");
  if (activeAtStart && !progressionProved) report.errors.push("Queued/running work did not produce a new completion or output during verification.");

  report.errors = [...new Set(report.errors)];
  report.success = report.errors.length === 0;
} catch (error) {
  report.errors.push(String(error?.stack || error));
} finally {
  report.completedAt = isoNow();
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ success: report.success, errors: report.errors, reportPath: REPORT_PATH }, null, 2));
if (!report.success) process.exitCode = 1;
