const dashboardUrl = (process.env.MASON_DASHBOARD_URL || "").replace(/\/$/, "");
const expectedRelease = process.env.MASON_EXPECTED_RELEASE || "2026-07-24-operational-1";

if (!dashboardUrl) {
  console.error("MASON_DASHBOARD_URL is required.");
  process.exit(2);
}

async function readJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${text.slice(0, 500)}`);
  return body;
}

const dashboard = await fetch(`${dashboardUrl}/`, { redirect: "follow" });
if (!dashboard.ok) throw new Error(`Dashboard returned ${dashboard.status}.`);

const health = await readJson(`${dashboardUrl}/api/mason?path=health`);
if (health.status !== "online") throw new Error(`Cloud status is ${health.status || "unknown"}.`);
if (health.releaseId && health.releaseId !== expectedRelease) {
  throw new Error(`Expected release ${expectedRelease}, received ${health.releaseId}.`);
}

const bootstrap = await readJson(`${dashboardUrl}/api/mason`);
const totals = bootstrap?.totals || bootstrap?.operations || {};

console.log(JSON.stringify({
  verified: true,
  dashboardUrl,
  releaseId: health.releaseId || null,
  projects: health.projects ?? totals.projects ?? null,
  files: health.files ?? totals.files ?? null,
  extractedFiles: health.extractedFiles ?? totals.extractedFiles ?? null,
  departmentOutputs: health.departmentOutputs ?? totals.departmentOutputs ?? null,
  queuedTasks: health.tasks?.queued ?? totals.queuedTasks ?? null,
  runningTasks: health.tasks?.running ?? totals.runningTasks ?? null,
  completedTasks: health.tasks?.completed ?? totals.completedTasks ?? null,
  executionProven: health.executionProven ?? null,
  checkedAt: new Date().toISOString(),
}, null, 2));
