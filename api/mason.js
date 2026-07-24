const ALLOWED_PATHS = new Set([
  "/health",
  "/api/connector/bootstrap",
  "/api/continuity",
  "/api/continuity/system/mason-forge",
]);

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed." });
  }

  const requestedPath = typeof request.query?.path === "string"
    ? `/${request.query.path.replace(/^\/+/, "")}`
    : "/api/connector/bootstrap";

  if (!ALLOWED_PATHS.has(requestedPath)) {
    return response.status(403).json({ error: "Path is not available through the dashboard proxy." });
  }

  const apiUrl = (process.env.MASON_API_URL || "https://mason-forge-cloud.mason-forge-ssx.workers.dev").replace(/\/$/, "");
  const apiToken = process.env.MASON_API_TOKEN;
  if (!apiToken) return response.status(503).json({ error: "MASON_API_TOKEN is not configured on the server." });

  try {
    const upstream = await fetch(`${apiUrl}${requestedPath}`, {
      headers: { authorization: `Bearer ${apiToken}` },
    });
    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    return response.send(text);
  } catch (error) {
    return response.status(502).json({ error: "Mason Forge Cloud is unavailable.", detail: String(error?.message || error) });
  }
}
