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

    if (contentType.includes("application/json") || contentType.startsWith("text/")) {
      return response.send(await upstream.text());
    }
    const bytes = Buffer.from(await upstream.arrayBuffer());
    return response.send(bytes);
  } catch (error) {
    return response.status(502).json({ error: "Mason Forge Cloud is unavailable.", detail: String(error?.message || error) });
  }
}
