export default function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const privateFileStorageConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

  return response.status(200).json({
    system: "SSX Contact System",
    version: "1.0-foundation",
    mode: "source-only",
    aiEnrichment: false,
    databaseConfigured,
    privateFileStorageConfigured,
    readyForEmailImports: databaseConfigured && privateFileStorageConfigured,
    acceptedSourceTypes: [".msg"],
    timestamp: new Date().toISOString(),
  });
}
