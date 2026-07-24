const REPOSITORY = "dalefarrow5268-art/mason-forge-bootstrap";
const WORKFLOW = "deploy-mason-forge-cloud.yml";

function authorized(request) {
  const expected = process.env.MASON_DASHBOARD_APPROVAL_TOKEN;
  if (!expected) return false;
  return (request.headers.authorization || "") === `Bearer ${expected}`;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed." });
  if (!authorized(request)) return response.status(401).json({ error: "Human approval token is invalid." });

  const githubToken = process.env.MASON_GITHUB_TOKEN;
  if (!githubToken) return response.status(503).json({ error: "MASON_GITHUB_TOKEN is not configured on the server." });

  const { environment = "production", ref = "main", reason = "Approved Mason Forge deployment" } = request.body || {};
  if (environment !== "production") return response.status(400).json({ error: "Only the production Cloudflare workflow is currently supported." });
  if (ref !== "main") return response.status(400).json({ error: "Production deployment must use main." });

  const githubResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({ ref }),
  });

  if (!githubResponse.ok) {
    const detail = await githubResponse.text();
    return response.status(502).json({ error: "GitHub rejected the deployment request.", detail });
  }

  return response.status(202).json({
    status: "REQUESTED",
    repository: REPOSITORY,
    workflow: WORKFLOW,
    ref,
    environment,
    reason,
    requestedAt: new Date().toISOString(),
    verificationRequired: true,
    message: "Deployment workflow requested. Do not call this deployed until workflow and Cloudflare evidence confirm success.",
  });
}
