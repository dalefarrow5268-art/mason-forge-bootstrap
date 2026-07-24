function connectorPathAllowed(path) {
  if (["/health", "/api/connector/bootstrap", "/api/continuity", "/api/continuity/system/mason-forge"].includes(path)) return true;
  if (/^\/api\/continuity\/[^/]+\/[^/]+$/.test(path)) return true;
  return /^\/api\/projects\/\d+\/(status|files|tasks|outputs|findings|evidence|rfis|contacts|continuity)$/.test(path)
    || /^\/api\/projects\/\d+\/files\/\d+(\/source)?$/.test(path);
}

function disableCaching(response) {
  response.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.setHeader("cdn-cache-control", "no-store");
  response.setHeader("vercel-cdn-cache-control", "no-store");
  response.setHeader("surrogate-control", "no-store");
  response.setHeader("pragma", "no-cache");
  response.setHeader("expires", "0");
}

function normalizeBootstrap(payload) {
  if (!payload || !Array.isArray(payload.taskTotals)) return payload;
  const rows = payload.taskTotals;
  const taskTotals = Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count || 0)]));
  const projects = (payload.projects || []).map((project) => ({
    ...project,
    file_count: Number(project.file_count || 0),
    running_tasks: Number(project.running_tasks || 0),
    queued_tasks: Number(project.queued_tasks || 0),
    blocked_tasks: Number(project.blocked_tasks || 0),
    completed_tasks: Number(project.completed_tasks || 0),
    failed_tasks: Number(project.failed_tasks || 0),
    canceled_tasks: Number(project.canceled_tasks || 0),
  }));
  return { ...payload, projects, taskTotals, taskTotalsRows: rows };
}

export default async function handler(request, response) {
  disableCaching(response);
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed." });

  const requestedPath = typeof request.query?.path === "string"
    ? `/${request.query.path.replace(/^\/+/, "")}`
    : "/api/connector/bootstrap";

  if (!connectorPathAllowed(requestedPath)) {
    return response.status(403).json({ error: "Path is not available through the dashboard proxy." });
  }

  const apiUrl = (process.env.MASON_API_URL || "https://mason-forge-cloud.mason-forge-ssx.workers.dev").replace(/\/$/, "");
  const apiToken = process.env.MASON_API_TOKEN;
  if (!apiToken) return response.status(503).json({ error: "MASON_API_TOKEN is not configured on the server." });

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const upstreamUrl = `${apiUrl}${requestedPath}${requestedPath.includes("?") ? "&" : "?"}_fresh=${encodeURIComponent(nonce)}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "cache-control": "no-cache, no-store, max-age=0",
        pragma: "no-cache",
      },
    });
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const disposition = upstream.headers.get("content-disposition");
    response.status(upstream.status);
    response.setHeader("content-type", contentType);
    if (disposition) response.setHeader("content-disposition", disposition);
    response.setHeader("x-mason-proxy-retrieved-at", new Date().toISOString());
    response.setHeader("x-mason-upstream-status", String(upstream.status));

    if (contentType.includes("application/json")) {
      const text = await upstream.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { return response.send(text); }
      return response.json(requestedPath === "/api/connector/bootstrap" ? normalizeBootstrap(parsed) : parsed);
    }
    if (contentType.startsWith("text/")) return response.send(await upstream.text());
    const bytes = Buffer.from(await upstream.arrayBuffer());
    return response.send(bytes);
  } catch (error) {
    return response.status(502).json({ error: "Mason Forge Cloud is unavailable.", detail: String(error?.message || error) });
  }
}
