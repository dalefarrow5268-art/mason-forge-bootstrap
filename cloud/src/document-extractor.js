import { routeExtractedEvidence } from "./evidence-task-router.js";

const now = () => new Date().toISOString();

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const parts = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {
      documentType: "UNCLASSIFIED",
      summary: text,
      verifiedFacts: [],
      keyReferences: [],
      risksOrConflicts: [],
      extractionLimitations: ["Model output was not valid JSON."],
      confidence: "LOW",
    };
  }
}

async function callOpenAI(env, file, bytes) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_DOCUMENT_MODEL || env.OPENAI_MODEL || "gpt-5-mini",
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Analyze this construction-project source document as evidence for Mason Forge.",
              "Do not invent facts, quantities, dates, parties, scope, or conclusions.",
              "Return valid JSON with keys: documentType, title, revision, documentDate, projectName, projectAddress, parties, sheetOrSectionReferences, summary, verifiedFacts, scopeItems, scheduleFacts, costFacts, contactFacts, permitOrLegalFacts, risksOrConflicts, missingInformation, extractionLimitations, confidence.",
              "Use empty arrays or null when evidence is absent. Preserve useful sheet numbers, specification sections, detail references, dates, names, and numeric values exactly as shown.",
            ].join("\n"),
          },
          {
            type: "input_file",
            filename: file.file_name,
            file_data: bytesToBase64(bytes),
          },
        ],
      }],
      text: { format: { type: "json_object" } },
      max_output_tokens: 7000,
      metadata: {
        project_id: String(file.project_id),
        project_file_id: String(file.id),
        source: "mason-forge-r2-extractor",
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${payload?.error?.message || JSON.stringify(payload)}`);
  const text = extractOutputText(payload);
  if (!text) throw new Error("OpenAI returned no document extraction output.");
  return { payload, content: safeJson(text) };
}

export async function extractProjectFile(message, env) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");
  const file = await env.DB.prepare("SELECT * FROM project_files WHERE id = ?").bind(message.fileId).first();
  if (!file || file.extracted_text_key) return { skipped: true };

  const maxBytes = Number(env.MAX_DOCUMENT_EXTRACTION_BYTES || 20 * 1024 * 1024);
  if (Number(file.size_bytes || 0) > maxBytes) {
    throw new Error(`File exceeds extraction limit of ${maxBytes} bytes.`);
  }

  const object = await env.PROJECT_FILES.get(file.r2_key);
  if (!object) throw new Error(`R2 object not found: ${file.r2_key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  const { payload, content } = await callOpenAI(env, file, bytes);

  const extractionKey = `projects/${file.project_id}/extracted/${file.id}.json`;
  const extractionRecord = {
    sourceFile: {
      id: file.id,
      fileName: file.file_name,
      relativePath: file.relative_path,
      r2Key: file.r2_key,
      sha256: file.sha256,
      sizeBytes: file.size_bytes,
    },
    extraction: content,
    openai: {
      responseId: payload.id || null,
      model: payload.model || env.OPENAI_DOCUMENT_MODEL || env.OPENAI_MODEL || "gpt-5-mini",
    },
    extractedAt: now(),
  };

  await env.PROJECT_FILES.put(extractionKey, JSON.stringify(extractionRecord, null, 2), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { projectId: String(file.project_id), fileId: String(file.id) },
  });
  await env.DB.prepare(`
    UPDATE project_files
    SET extracted_text_key = ?, review_status = 'EXTRACTED - NEEDS HUMAN REVIEW', updated_at = ?
    WHERE id = ?
  `).bind(extractionKey, now(), file.id).run();

  const routed = await routeExtractedEvidence(file, extractionKey, env);
  return { fileId: file.id, extractionKey, responseId: payload.id || null, ...routed };
}

export async function markExtractionFailure(message, env, error, terminal = false) {
  await env.DB.prepare(`
    UPDATE project_files
    SET review_status = ?, updated_at = ?
    WHERE id = ? AND extracted_text_key IS NULL
  `).bind(
    terminal ? `EXTRACTION FAILED: ${String(error?.message || error).slice(0, 500)}` : "EXTRACTION RETRYING",
    now(),
    message.fileId,
  ).run();
}
