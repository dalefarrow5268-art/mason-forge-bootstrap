const API_URL = (import.meta.env.VITE_MASON_API_URL || "https://mason-forge-cloud.mason-forge-ssx.workers.dev").replace(/\/$/, "");
const API_TOKEN = import.meta.env.VITE_MASON_API_TOKEN || "";

export async function getMasonCloudBootstrap() {
  if (!API_TOKEN) throw new Error("VITE_MASON_API_TOKEN is not configured.");
  const response = await fetch(`${API_URL}/api/connector/bootstrap`, {
    headers: { authorization: `Bearer ${API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Mason Forge Cloud returned ${response.status}.`);
  return response.json();
}
