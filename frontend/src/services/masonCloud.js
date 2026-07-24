export async function getMasonCloudBootstrap() {
  const response = await fetch("/api/mason?path=api/connector/bootstrap", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Mason Forge Cloud returned ${response.status}: ${detail}`);
  }
  return response.json();
}

export async function requestMasonDeployment({ approvalToken, reason }) {
  const response = await fetch("/api/deploy", {
    method: "POST",
    headers: {
      authorization: `Bearer ${approvalToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ environment: "production", ref: "main", reason }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Deployment request failed with ${response.status}.`);
  return payload;
}
