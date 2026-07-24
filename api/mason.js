const ALLOWED_PATHS = new Set([
  "/health",
  "/api/connector/bootstrap",
  "/api/continuity",
  "/api/continuity/system/mason-forge",
]);

function disableCaching(response) {
  response.setHeader("cache-control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  response.setHeader("cdn-cache-control", "no-store");
  response.setHeader("vercel-cdn-cache-control", "no-store");
  response.setHeader("surrogate-control", "no-store");
  response.setHeader("pragma", "no-cache");
  response.setHeader("expires", "0");
}

export default async function handler(request, response) {
  disableCaching(response);

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

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const separator = requestedPath.includes("?") ? "&" : "?";
  const upstreamUrl = `${apiUrl}${requestedPath}${separator}_fresh=${encodeURIComponent(nonce)}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "cache-control": "no-cache, no-store, max-age=0",
        pragma: "no-cache",
      },
    });
    const text = await upstream.text();
    response.status(upstream.status);
    response.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    response.setHeader("x-mason-proxy-retrieved-at", new Date().toISOString());
    response.setHeader("x-mason-upstream-status", String(upstream.status));
    return response.send(text);
  } catch (error) {
    return response.status(502).json({ error: "Mason Forge Cloud is unavailable.", detail: String(error?.message || error) });
  }
}
