export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const cloudflareApiBase = process.env.CONTACT_SYSTEM_API_BASE_URL;
  return response.status(200).json({
    system: "SSX Contact System",
    version: "1.0-cloudflare-foundation",
    mode: "source-only",
    aiEnrichment: false,
    storage: "Cloudflare D1 + private R2",
    workerApiConfigured: Boolean(cloudflareApiBase),
    readyForEmailImports: false,
    acceptedSourceTypes: [".msg"],
    timestamp: new Date().toISOString(),
  });
}
