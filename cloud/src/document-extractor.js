import { routeExtractedEvidence, routeReadyEvidenceBatches } from "./evidence-task-router.js";

const now = () => new Date().toISOString();

function permanentError(message) {
  const error = new Error(message);
  error.permanent = true;
  return error;
}

export function isPermanentExtractionError(error) {
  return Boolean(error?.permanent);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function extension(name = "") {
  const clean = String(name).toLowerCase().split("?")[0];
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index + 1) : "";
}

const imageExtensions = new Set(["jpeg", "jpg", "png", "webp", "gif"]);
const directlyReadableExtensions = new Set(["json", "csv", "md", "txt", "html", "xml"]);
const supportedDocumentExtensions = new Set(["pdf", "docx", "xlsx", "pptx"]);

export function sourceKind(file, extraction = null) {
  const ext = extension(file.file_name);
  if (imageExtensions.has(ext)) return "IMAGE";
  const evidence = [
    extraction?.documentType,
    extraction?.title,
    ...(extraction?.extractionLimitations || []),
  ].join(" ").toUpperCase();
  if (/\b(DRAWING|PLAN SET|SHEET|BLUEPRINT)\b/.test(evidence)) return "DRAWING";
  if (/\b(SCAN|SCANNED|OCR|IMAGE[- ]ONLY)\b/.test(evidence)) return "SCAN";
  return "DOCUMENT";
}

export function failureClassification(file, error) {
  const ext = extension(file.file_name);
  const message = String(error?.message || error);
  if (!directlyReadableExtensions.has(ext) && !imageExtensions.has(ext) && !supportedDocumentExtensions.has(ext)) {
    return { sourceKind: "UNSUPPORTED FORMAT", reviewType: "MANUAL", reason: `Unsupported .${ext || "[no extension]"} format. ${message}` };
  }
  if (/corrupt|malformed|invalid (pdf|file)|cannot (read|parse)|damaged/i.test(message)) {
    return { sourceKind: "CORRUPTED FILE", reviewType: "MANUAL", reason: message };
  }
  if (/exceeds extraction limit|too large|413/i.test(message)) {
    return { sourceKind: sourceKind(file), reviewType: "MANUAL", reason: `File exceeds automated extraction capacity. ${message}` };
  }
  return { sourceKind: sourceKind(file), reviewType: "MANUAL", reason: message };
}

async function routeForReview(env, file, reviewType, kind, reason) {
  const timestamp = now();
  await env.DB.prepare(`INSERT INTO extraction_review_queue
    (file_id, project_id, review_type, source_kind, reason, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      review_type=excluded.review_type, source_kind=excluded.source_kind,
      reason=excluded.reason, status='PENDING', updated_at=excluded.updated_at`)
    .bind(file.id, file.project_id, reviewType, kind, String(reason).slice(0, 1000), timestamp, timestamp).run();
}

function mimeType(file) {
  if (file.file_type && String(file.file_type).includes("/")) return String(file.file_type).split(";")[0].trim();
  const types = {
    pdf: "application/pdf",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    json: "application/json",
    csv: "text/csv",
    md: "text/markdown",
    txt: "text/plain",
    html: "text/html",
    xml: "application/xml",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return types[extension(file.file_name)] || "application/octet-stream";
}

async function uploadOpenAIFile(env, file, bytes) {
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", new File([bytes], file.file_name, { type: mimeType(file) }));
  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    signal: AbortSignal.timeout(Number(env.OPENAI_REQUEST_TIMEOUT_MS || 600000)),
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    const message = `OpenAI file upload ${response.status}: ${payload?.error?.message || JSON.stringify(payload)}`;
    if ([400, 413, 415, 422].includes(response.status)) throw permanentError(message);
    throw new Error(message);
  }
  return payload.id;
}

export async function deleteOpenAIFile(env, fileId) {
  if (!fileId) return;
  try {
    await fetch(`https://api.openai.com/v1/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    });
  } catch (error) {
    console.error("Temporary OpenAI extraction file cleanup failed", { fileId, error: String(error?.message || error) });
  }
}

export async function fileInputContent(env, file, bytes) {
  const ext = extension(file.file_name);
  if (directlyReadableExtensions.has(ext)) {
    const maxTextBytes = 2 * 1024 * 1024;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, maxTextBytes));
    return {
      content: [{
        type: "input_text",
        text: `SOURCE FILE: ${file.file_name}\nCONTENT${bytes.length > maxTextBytes ? " (TRUNCATED TO 2 MIB)" : ""}:\n${text}`,
      }],
      uploadedFileId: null,
    };
  }
  if (imageExtensions.has(ext)) {
    return {
      content: [{ type: "input_image", image_url: `data:${mimeType(file)};base64,${bytesToBase64(bytes)}`, detail: "high" }],
      uploadedFileId: null,
    };
  }
  if (ext === "pdf" && env.INLINE_PDF_INPUT_ENABLED === 'true' && bytes.length <= 5 * 1024 * 1024) {
    return {content: [{type: 'input_file', filename: file.file_name,
      file_data: `data:application/pdf;base64,${bytesToBase64(bytes)}`}], uploadedFileId: null};
  }
  const uploadedFileId = await uploadOpenAIFile(env, file, bytes);
  return {
    content: [{ type: "input_file", file_id: uploadedFileId }],
    uploadedFileId,
  };
}

export function extractOutputText(response) {
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
  const inputFile = await fileInputContent(env, file, bytes);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(Number(env.OPENAI_REQUEST_TIMEOUT_MS || 600000)),
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
        "x-client-request-id": crypto.randomUUID(),
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
            ...inputFile.content,
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

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = `OpenAI ${response.status}: ${payload?.error?.message || JSON.stringify(payload)}`;
      if ([400, 413, 415, 422].includes(response.status)) throw permanentError(message);
      throw new Error(message);
    }
    const text = extractOutputText(payload);
    if (!text) throw new Error("OpenAI returned no document extraction output.");
    return { payload, content: safeJson(text) };
  } finally {
    await deleteOpenAIFile(env, inputFile.uploadedFileId);
  }
}

export async function extractProjectFile(message, env) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

  const file = await env.DB.prepare("SELECT * FROM project_files WHERE id = ?").bind(message.fileId).first();
  if (!file || file.archived_at || file.relative_path?.startsWith("SSX Project Holding Folder/Phase One Project Review/") || file.extracted_text_key) return { skipped: true };

  const claim = await env.DB.prepare(`
    UPDATE project_files
    SET review_status = 'EXTRACTING', updated_at = ?
    WHERE id = ?
      AND extracted_text_key IS NULL
      AND (
        review_status IN ('EXTRACTION QUEUED','EXTRACTION RETRYING')
        OR (review_status = 'EXTRACTING' AND updated_at < datetime('now', '-20 minutes'))
      )
  `).bind(now(), file.id).run();

  if (Number(claim.meta?.changes || 0) === 0) {
    const current = await env.DB.prepare("SELECT review_status, extracted_text_key FROM project_files WHERE id = ?")
      .bind(file.id).first();
    if (current?.extracted_text_key) return { skipped: true };
    return { busy: true, reviewStatus: current?.review_status || file.review_status };
  }

  const maxBytes = Number(env.MAX_DOCUMENT_EXTRACTION_BYTES || 20 * 1024 * 1024);
  if (Number(file.size_bytes || 0) > maxBytes) {
    throw permanentError(`File exceeds extraction limit of ${maxBytes} bytes.`);
  }
  const ext = extension(file.file_name);
  if (!directlyReadableExtensions.has(ext) && !imageExtensions.has(ext) && !supportedDocumentExtensions.has(ext)) {
    throw permanentError(`Unsupported extraction format: .${ext || "[no extension]"}.`);
  }

  const object = await env.PROJECT_FILES.get(file.r2_key);
  if (!object) throw permanentError(`R2 object not found: ${file.r2_key}`);
  const bytes = new Uint8Array(await object.arrayBuffer());
  const { payload, content } = await callOpenAI(env, file, bytes);
  const kind = sourceKind(file, content);
  const requiresVisualReview = ["IMAGE", "DRAWING", "SCAN"].includes(kind);
  const limitations = Array.isArray(content.extractionLimitations) ? content.extractionLimitations.filter(Boolean) : [];
  const lowConfidence = String(content.confidence || "").toUpperCase() === "LOW";
  const requiresManualReview = lowConfidence || limitations.length > 0;
  const reviewType = requiresVisualReview ? "VISUAL" : requiresManualReview ? "MANUAL" : null;
  const reviewReason = requiresVisualReview
    ? `${kind} evidence requires visual verification.`
    : requiresManualReview
      ? `Extraction requires review: ${[...limitations, lowConfidence ? "Low extraction confidence." : ""].filter(Boolean).join(" ")}`
      : null;

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
    classification: {
      sourceKind: kind,
      readable: true,
      reviewType,
      reviewReason,
    },
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
    SET extracted_text_key = ?, review_status = ?, updated_at = ?
    WHERE id = ? AND extracted_text_key IS NULL
  `).bind(
    extractionKey,
    reviewType ? `EXTRACTED - ${reviewType} REVIEW REQUIRED: ${kind}` : "EXTRACTED - READY",
    now(),
    file.id,
  ).run();
  if (reviewType) await routeForReview(env, file, reviewType, kind, reviewReason);

  const routed = await routeExtractedEvidence(file, extractionKey, env);
  return { fileId: file.id, extractionKey, responseId: payload.id || null, ...routed };
}

export async function markExtractionFailure(message, env, error, terminal = false) {
  const file = await env.DB.prepare("SELECT * FROM project_files WHERE id = ?").bind(message.fileId).first();
  const classification = file ? failureClassification(file, error) : null;
  await env.DB.prepare(`
    UPDATE project_files
    SET review_status = ?, updated_at = ?
    WHERE id = ? AND extracted_text_key IS NULL
  `).bind(
    terminal
      ? `${classification?.reviewType || "MANUAL"} REVIEW REQUIRED: ${classification?.sourceKind || "UNREADABLE"}`
      : "EXTRACTION RETRYING",
    now(),
    message.fileId,
  ).run();

  if (terminal && file?.project_id) {
    await routeForReview(
      env,
      file,
      classification.reviewType,
      classification.sourceKind,
      classification.reason,
    );
    await routeReadyEvidenceBatches(Number(file.project_id), env);
  }
}
