import { extractOutlookMsg } from "./msg-extractor";

export interface Env {
  DB: D1Database;
  CONTACT_FILES: R2Bucket;
  CONTACT_SYSTEM_TOKEN: string;
}

type ContactInput = { displayName: string; firstName?: string; lastName?: string; email?: string; phone?: string; title?: string; companyId?: string };
type ContactUpdateInput = Partial<ContactInput> & { sourceEmailId?: string; sourceLocation?: string };
type CompanyInput = { name?: string; website?: string | null; phone?: string | null; tradeCategory?: string | null; emrRating?: number | null; emrEffectiveDate?: string | null; sourceContactId?: string; sourceEmailId?: string; sourceLocation?: string };
type ProjectLinkInput = { projectName: string; projectId?: number | null; projectRole?: string | null; isCurrent?: boolean; sourceEmailId: string; sourceLocation: string };
type TaskUpdateInput = { status: "open" | "completed" | "dismissed" };
type CoiInput = { attachmentId: string; insurerName?: string | null; policyNumber?: string | null; effectiveDate?: string | null; expirationDate?: string | null; notes?: string | null; sourceLocation: string };
type DuplicateReviewUpdateInput = { status: "not_duplicate" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,X-SSX-File-Name,X-SSX-SHA256,X-SSX-Refresh-Profile",
  "Access-Control-Max-Age": "86400"
};
const noStoreHeaders = { "Cache-Control": "no-store", ...corsHeaders };
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers: { ...noStoreHeaders, ...headers } });
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160);
const decodeFileHeader = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
const validTitle = (value: unknown) => {
  const title = typeof value === "string" ? value.trim() : "";
  return Boolean(title && title.length <= 80 && !/[0-9]/.test(title) && !/^(?:o|m|p|f|phone|office|mobile|direct)\s*:/i.test(title) && !/^dale farrow$/i.test(title));
};
function imageContentType(bytes: Uint8Array) {
  const b = bytes;
  if (b.length >= 8 && b[0]===137 && b[1]===80 && b[2]===78 && b[3]===71 && b[4]===13 && b[5]===10 && b[6]===26 && b[7]===10) return "image/png";
  if (b.length >= 3 && b[0]===255 && b[1]===216 && b[2]===255) return "image/jpeg";
  if (b.length >= 6 && String.fromCharCode(...b.slice(0,6)) === "GIF87a" || b.length >= 6 && String.fromCharCode(...b.slice(0,6)) === "GIF89a") return "image/gif";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0,4)) === "RIFF" && String.fromCharCode(...b.slice(8,12)) === "WEBP") return "image/webp";
  return null;
}
const masterContactCardTemplateUrl = "https://mason-forge-bootstrap.vercel.app/final-templates/master-contact-card-template.html";
const escapeCardHtml = (value: unknown) => String(value ?? "Not provided").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const sessionMaxAge = 60 * 60 * 24 * 30;
const cookie = (request: Request, name: string) => request.headers.get("Cookie")?.split(/;\s*/).find(value => value.startsWith(name + "="))?.slice(name.length + 1);
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sessionValue(env: Env) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.CONTACT_SYSTEM_TOKEN), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("ssx-contact-upload-session-v1"))));
}
async function authorized(request: Request, env: Env) {
  if (!env.CONTACT_SYSTEM_TOKEN) return false;
  if (request.headers.get("Authorization") === "Bearer " + env.CONTACT_SYSTEM_TOKEN) return true;
  return cookie(request, "ssx_upload_session") === await sessionValue(env);
}
async function sessionHeaders(request: Request, env: Env): Promise<Record<string, string>> {
  return request.headers.get("Authorization") === "Bearer " + env.CONTACT_SYSTEM_TOKEN ? { "Set-Cookie": "ssx_upload_session=" + await sessionValue(env) + "; Max-Age=" + sessionMaxAge + "; Path=/contact-system; HttpOnly; Secure; SameSite=Strict" } : {};
}
async function requireAuth(request: Request, env: Env) { return await authorized(request, env) ? null : json({ error: "Unauthorized" }, 401); }

function completeness(record: Record<string, unknown>) {
  // This score is strictly the source-backed email-contact profile.  Optional
  // compliance and enrichment fields (EMR, photo, research) are not used to
  // lower a new contact's score.
  const fields = [
    ["Contact name", record.display_name], ["Email", record.primary_email], ["Phone", record.primary_phone],
    ["Title", validTitle(record.title) ? record.title : null], ["Company", record.company_name], ["Company website", record.company_website],
    ["Trade category", record.company_trade_category], ["Company logo", record.company_logo_r2_key]
  ] as const;
  const present = fields.filter(([, value]) => value !== null && value !== undefined && value !== "").length;
  return { score: Math.round((present / fields.length) * 100), complete: present === fields.length, missing: fields.filter(([, value]) => value === null || value === undefined || value === "").map(([name]) => name) };
}

async function getContact(env: Env, contactId: string) {
  const contact = await env.DB.prepare(`SELECT c.*, co.name AS company_name, co.website AS company_website, co.emr_rating AS company_emr_rating, co.emr_effective_date AS company_emr_effective_date, co.logo_r2_key AS company_logo_r2_key, co.trade_category AS company_trade_category FROM ssx_contacts c LEFT JOIN ssx_companies co ON co.id=c.company_id WHERE c.id=?`).bind(contactId).first();
  if (!contact) return null;
  const [emails, attachments, tasks, projects, cois, evidence] = await env.DB.batch([
    env.DB.prepare("SELECT id, subject, sender_name, sender_email, received_at, extraction_status, original_file_name, original_size_bytes FROM ssx_contact_emails WHERE contact_id=? ORDER BY received_at DESC").bind(contactId),
    env.DB.prepare("SELECT a.id,a.email_id,a.file_name,a.content_type,a.size_bytes,a.sha256 FROM ssx_contact_attachments a JOIN ssx_contact_emails e ON e.id=a.email_id WHERE e.contact_id=? ORDER BY a.created_at DESC").bind(contactId),
    env.DB.prepare("SELECT * FROM ssx_contact_tasks WHERE contact_id=? ORDER BY created_at DESC").bind(contactId),
    env.DB.prepare("SELECT * FROM ssx_contact_projects WHERE contact_id=? ORDER BY is_current DESC, linked_at DESC").bind(contactId),
    env.DB.prepare("SELECT c.*,a.file_name,a.content_type,a.size_bytes FROM ssx_contact_cois c JOIN ssx_contact_attachments a ON a.id=c.attachment_id WHERE c.contact_id=? ORDER BY c.expiration_date ASC").bind(contactId),
    env.DB.prepare("SELECT field_name, field_value, source_location FROM ssx_contact_evidence WHERE contact_id=? ORDER BY created_at DESC").bind(contactId)
  ]);
  const attachmentsByEmail = new Map<string, unknown[]>();
  for (const attachment of attachments.results as Array<Record<string, unknown>>) {
    const emailId = String(attachment.email_id);
    attachmentsByEmail.set(emailId, [...(attachmentsByEmail.get(emailId) || []), { ...attachment, downloadPath: `/contact-system/files/${attachment.id}` }]);
  }
  const emailRecords = (emails.results as Array<Record<string, unknown>>).map(email => ({ ...email, originalDownloadPath: `/contact-system/files/${email.id}`, attachments: attachmentsByEmail.get(String(email.id)) || [] }));
  const coiRecords = (cois.results as Array<Record<string, unknown>>).map(coi => {
    const expirationDate = typeof coi.expiration_date === "string" ? coi.expiration_date : null;
    const expiresAt = expirationDate ? Date.parse(`${expirationDate}T23:59:59Z`) : NaN;
    return { ...coi, calculated_status: coiStatus(expirationDate), days_until_expiration: Number.isNaN(expiresAt) ? null : Math.ceil((expiresAt - Date.now()) / 86_400_000), downloadPath: `/contact-system/files/${coi.attachment_id}` };
  });
  return { contact, completeness: completeness(contact as Record<string, unknown>), emails: emailRecords, tasks: tasks.results, projects: projects.results, cois: coiRecords, evidence: evidence.results };
}

async function createContact(env: Env, input: ContactInput, source = "manual") {
  if (!input?.displayName?.trim()) throw new Error("displayName is required");
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const existing = await env.DB.prepare("SELECT id FROM ssx_contacts WHERE primary_email=?").bind(email).first<{id:string}>();
    if (existing) return { id: existing.id, created: false };
  }
  const contactId = id();
  const now = new Date().toISOString();
  const possibleDuplicates = await env.DB.prepare("SELECT id FROM ssx_contacts WHERE normalized_name=? LIMIT 20").bind(normalize(input.displayName)).all<{id:string}>();
  await env.DB.prepare(`INSERT INTO ssx_contacts (id,company_id,first_name,last_name,display_name,normalized_name,primary_email,primary_phone,title,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(contactId,input.companyId || null,input.firstName || null,input.lastName || null,input.displayName.trim(),normalize(input.displayName),email,input.phone || null,input.title || null,now,now).run();
  for (const [field, value] of Object.entries({ display_name: input.displayName, primary_email: email, primary_phone: input.phone, title: input.title })) {
    if (value) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,field_name,field_value,source_location) VALUES (?,?,?,?,?)").bind(id(),contactId,field,String(value),source).run();
  }
  for (const candidate of possibleDuplicates.results) {
    await env.DB.prepare("INSERT OR IGNORE INTO ssx_contact_duplicate_reviews (id,contact_id,possible_duplicate_contact_id,match_reason,status) VALUES (?,?,?,?, 'open')").bind(id(),contactId,candidate.id,"Same normalized display name; exact email did not match").run();
  }
  return { id: contactId, created: true };
}

function cleanWebsite(value: string | null | undefined) {
  if (value === null || value === undefined || value.trim() === "") return null;
  const candidate = value.trim();
  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch { throw new Error("website must be a valid http(s) address"); }
}

function coiStatus(expirationDate?: string | null): "current" | "expiring" | "expired" | "review" {
  if (!expirationDate || !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) return "review";
  const expires = Date.parse(`${expirationDate}T23:59:59Z`);
  if (Number.isNaN(expires)) return "review";
  const days = Math.ceil((expires - Date.now()) / 86_400_000);
  return days < 0 ? "expired" : days <= 30 ? "expiring" : "current";
}

async function saveCompany(env: Env, companyId: string | null, input: CompanyInput) {
  const hasSourcedFact = input.website !== undefined || input.phone !== undefined || input.tradeCategory !== undefined || input.emrRating !== undefined || input.emrEffectiveDate !== undefined;
  if (hasSourcedFact && (!input.sourceContactId || !input.sourceEmailId || !input.sourceLocation?.trim())) throw new Error("Company facts require sourceContactId, sourceEmailId, and sourceLocation from an imported Outlook email");
  if (input.emrRating !== undefined && input.emrRating !== null && (!Number.isFinite(input.emrRating) || input.emrRating < 0 || input.emrRating > 100)) throw new Error("emrRating must be between 0 and 100");
  const now = new Date().toISOString();
  let record = companyId ? await env.DB.prepare("SELECT * FROM ssx_companies WHERE id=?").bind(companyId).first<any>() : null;
  if (!record) {
    if (!input.name?.trim()) throw new Error("name is required for a new company");
    const existing = await env.DB.prepare("SELECT * FROM ssx_companies WHERE normalized_name=?").bind(normalize(input.name)).first<any>();
    if (existing) record = existing;
    else {
      record = { id: id(), name: input.name.trim(), normalized_name: normalize(input.name), website: null, phone: null, trade_category: null, emr_rating: null, emr_effective_date: null };
      await env.DB.prepare("INSERT INTO ssx_companies (id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(record.id,record.name,record.normalized_name,now,now).run();
    }
  }
  const next = { name: input.name?.trim() ?? record.name, website: input.website === undefined ? record.website : cleanWebsite(input.website), phone: input.phone === undefined ? record.phone : input.phone?.trim() || null, tradeCategory: input.tradeCategory === undefined ? record.trade_category : input.tradeCategory?.trim() || null, emrRating: input.emrRating === undefined ? record.emr_rating : input.emrRating, emrEffectiveDate: input.emrEffectiveDate === undefined ? record.emr_effective_date : input.emrEffectiveDate || null };
  await env.DB.prepare("UPDATE ssx_companies SET name=?,normalized_name=?,website=?,phone=?,trade_category=?,emr_rating=?,emr_effective_date=?,updated_at=? WHERE id=?").bind(next.name,normalize(next.name),next.website,next.phone,next.tradeCategory,next.emrRating,next.emrEffectiveDate,now,record.id).run();
  if (hasSourcedFact) for (const [field, value] of Object.entries({ company_name: input.name, company_website: input.website, company_phone: input.phone, trade_category: input.tradeCategory, emr_rating: input.emrRating, emr_effective_date: input.emrEffectiveDate })) if (value !== undefined) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),input.sourceContactId,input.sourceEmailId,field,value === null ? null : String(value),input.sourceLocation!.trim()).run();
  return await env.DB.prepare("SELECT * FROM ssx_companies WHERE id=?").bind(record.id).first();
}

async function linkProject(env: Env, contactId: string, input: ProjectLinkInput) {
  if (!input.projectName?.trim()) throw new Error("projectName is required");
  if (!input.sourceEmailId || !input.sourceLocation?.trim()) throw new Error("sourceEmailId and sourceLocation from an imported Outlook email are required");
  const contact = await env.DB.prepare("SELECT id FROM ssx_contacts WHERE id=?").bind(contactId).first();
  if (!contact) throw new Error("Contact not found");
  const email = await env.DB.prepare("SELECT id FROM ssx_contact_emails WHERE id=? AND contact_id=?").bind(input.sourceEmailId, contactId).first();
  if (!email) throw new Error("sourceEmailId must belong to this contact");
  const now = new Date().toISOString();
  const projectId = input.projectId ?? null;
  const existing = await env.DB.prepare("SELECT id FROM ssx_contact_projects WHERE contact_id=? AND project_name=? AND COALESCE(project_id,-1)=COALESCE(?,-1)").bind(contactId,input.projectName.trim(),projectId).first<{id:string}>();
  if (input.isCurrent) await env.DB.prepare("UPDATE ssx_contact_projects SET is_current=0 WHERE contact_id=?").bind(contactId).run();
  const linkId = existing?.id || id();
  if (existing) await env.DB.prepare("UPDATE ssx_contact_projects SET project_role=?,is_current=?,linked_at=?,source_email_id=? WHERE id=?").bind(input.projectRole?.trim() || null,input.isCurrent === false ? 0 : 1,now,input.sourceEmailId,linkId).run();
  else await env.DB.prepare("INSERT INTO ssx_contact_projects (id,contact_id,project_id,project_name,project_role,is_current,linked_at,source_email_id) VALUES (?,?,?,?,?,?,?,?)").bind(linkId,contactId,projectId,input.projectName.trim(),input.projectRole?.trim() || null,input.isCurrent === false ? 0 : 1,now,input.sourceEmailId).run();
  await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,input.sourceEmailId,"project_link",input.projectName.trim(),input.sourceLocation.trim()).run();
  return await env.DB.prepare("SELECT * FROM ssx_contact_projects WHERE id=?").bind(linkId).first();
}

async function registerCoi(env: Env, contactId: string, input: CoiInput) {
  if (!input.attachmentId || !input.sourceLocation?.trim()) throw new Error("attachmentId and sourceLocation are required");
  const attachment = await env.DB.prepare("SELECT a.id,a.email_id FROM ssx_contact_attachments a JOIN ssx_contact_emails e ON e.id=a.email_id WHERE a.id=? AND e.contact_id=?").bind(input.attachmentId,contactId).first<{id:string;email_id:string}>();
  if (!attachment) throw new Error("attachmentId must belong to an imported email for this contact");
  const status = coiStatus(input.expirationDate);
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT id FROM ssx_contact_cois WHERE attachment_id=?").bind(input.attachmentId).first<{id:string}>();
  const coiId = existing?.id || id();
  if (existing) await env.DB.prepare("UPDATE ssx_contact_cois SET insurer_name=?,policy_number=?,effective_date=?,expiration_date=?,status=?,notes=?,updated_at=? WHERE id=?").bind(input.insurerName || null,input.policyNumber || null,input.effectiveDate || null,input.expirationDate || null,status,input.notes || null,now,coiId).run();
  else await env.DB.prepare("INSERT INTO ssx_contact_cois (id,contact_id,email_id,attachment_id,insurer_name,policy_number,effective_date,expiration_date,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(coiId,contactId,attachment.email_id,input.attachmentId,input.insurerName || null,input.policyNumber || null,input.effectiveDate || null,input.expirationDate || null,status,input.notes || null,now,now).run();
  await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,attachment.email_id,"certificate_of_insurance",input.attachmentId,input.sourceLocation.trim()).run();
  return await env.DB.prepare("SELECT * FROM ssx_contact_cois WHERE id=?").bind(coiId).first();
}

function requestedAction(subject?: string, body?: string) {
  const source = `${subject || ""}\n${body || ""}`.trim();
  if (!source || !/\b(please|could you|can you|need you to|let me know|reply|send|provide|review|confirm)\b/i.test(source)) return null;
  return source.replace(/\s+/g, " ").slice(0, 800);
}

function projectFromEmail(subject?: string, fileName?: string, body?: string) {
  const text = `${subject || ""}\n${fileName || ""}\n${body || ""}`;
  if (/autograph.*jericho|jericho.*autograph/i.test(text)) return "Autograph by Marriott – Jericho, NY";
  if (/tmc.*helix.*houston/i.test(text)) return "TMC Helix Park – Houston, TX";
  if (/sam'?s club.*maple grove/i.test(text)) return "Sam's Club Maple Grove, MN";
  if (/walmart.*monroe/i.test(text)) return "Walmart Monroe, NY 2637-259";
  return null;
}

type SignatureFacts = { companyName?: string; website?: string; phone?: string; title?: string; tradeCategory?: string };

function signatureFacts(body?: string, senderName?: string): SignatureFacts {
  const lines = (body || "").replace(/\r/g, "").split("\n").map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const signatureLines = lines.slice(-45);
  const phone = [...signatureLines].reverse().map(line => line.match(/(?:\+?1[ .-]?)?(?:\(?\d{3}\)?[ .-]?)\d{3}[ .-]\d{4}/)?.[0]).find(Boolean);
  const websiteMatch = [...signatureLines].reverse().map(line => line.match(/(?:https?:\/\/|www\.)[^\s<>]+/i)?.[0]).find(Boolean);
  const website = websiteMatch?.replace(/[),.;]+$/, "");
  const excluded = /^(thanks|thank you|regards|best|sincerely|sent from|tel|phone|fax|mobile|office|direct|www\.|https?:\/\/|\S+@\S+|\d{1,6}\s+.+|.*\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|suite|floor|ny|tx|mn|ca)\b.*)$/i;
  const companyLine = [...signatureLines].reverse().find(line => {
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    const upper = (line.match(/[A-Z]/g) || []).length;
    return letters >= 4 && upper / letters >= 0.70 && !excluded.test(line) && !/^\d/.test(line);
  });
  const companyName = companyLine?.replace(/\s{2,}/g, " ").replace(/[|•]+/g, " ").trim();
  const companyIndex = companyName ? signatureLines.lastIndexOf(companyLine!) : -1;
  const candidateTitle = companyIndex > 0 ? signatureLines[companyIndex - 1] : undefined;
  const senderNormalized = normalize(senderName || "");
  const title = candidateTitle && !excluded.test(candidateTitle) && normalize(candidateTitle) !== senderNormalized && validTitle(candidateTitle) ? candidateTitle : undefined;
  const candidateTrade = companyIndex >= 0 ? signatureLines[companyIndex + 1] : undefined;
  const tradeCategory = candidateTrade && candidateTrade.length < 100 && !excluded.test(candidateTrade) && !/[0-9@]/.test(candidateTrade) ? candidateTrade : undefined;
  return { companyName, website, phone, title, tradeCategory };
}

async function importEmail(request: Request, env: Env) {
  const fileName = safeName(decodeFileHeader(request.headers.get("X-SSX-File-Name") || "email.msg"));
  const sha = (request.headers.get("X-SSX-SHA256") || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) return json({ error: "A valid X-SSX-SHA256 header is required" }, 400);
  if (!fileName.toLowerCase().endsWith(".msg")) return json({ error: "Only .msg files are accepted" }, 415);
  const duplicate = await env.DB.prepare("SELECT id, contact_id, email_id, status FROM ssx_contact_import_jobs WHERE original_sha256=?").bind(sha).first<{id:string;contact_id:string|null;email_id:string|null;status:string}>();
  const existingEmail = duplicate ? await env.DB.prepare("SELECT id FROM ssx_contact_emails WHERE original_sha256=?").bind(sha).first<{id:string}>() : null;
  const retryingReview = Boolean(duplicate && duplicate.status === "review" && !duplicate.contact_id && existingEmail);
  const refreshingDuplicate = Boolean(duplicate && duplicate.contact_id && duplicate.email_id && request.headers.get("X-SSX-Refresh-Profile") === "1");
  if (duplicate && !retryingReview && !refreshingDuplicate) return json({ duplicate: true, import: duplicate }, 409, await sessionHeaders(request, env));
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) return json({ error: "Email must be between 1 byte and 50 MB" }, 413);
  const computed = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2,"0")).join("");
  if (computed !== sha) return json({ error: "SHA-256 does not match uploaded bytes" }, 400);
  const importId = duplicate?.id || id(); const now = new Date().toISOString();
  const extracted = extractOutlookMsg(bytes);
  // Outlook can export the same message with different file bytes.  Stop those
  // copies before they become separate communication-history records.
  if (!duplicate && extracted.senderEmail && extracted.subject && extracted.bodyText) {
    const semanticDuplicate = await env.DB.prepare("SELECT e.id AS email_id,e.contact_id,j.id AS import_id FROM ssx_contact_emails e LEFT JOIN ssx_contact_import_jobs j ON j.email_id=e.id WHERE e.sender_email=? AND COALESCE(e.subject,'')=? AND COALESCE(e.body_text,'')=? ORDER BY e.created_at DESC LIMIT 1").bind(extracted.senderEmail, extracted.subject, extracted.bodyText).first<{email_id:string;contact_id:string|null;import_id:string|null}>();
    if (semanticDuplicate?.email_id) return json({ id: semanticDuplicate.import_id || semanticDuplicate.email_id, contactId: semanticDuplicate.contact_id, emailId: semanticDuplicate.email_id, status: "completed", duplicate: true, message: "Same Outlook email already stored; no second communication record was created." }, 200, await sessionHeaders(request, env));
  }
  let contactId: string | null = null;
  if (!extracted.parseError && extracted.senderEmail) {
    const exact = await env.DB.prepare("SELECT id FROM ssx_contacts WHERE primary_email=?").bind(extracted.senderEmail).first<{id:string}>();
    if (exact) contactId = exact.id;
    else if (extracted.senderName) contactId = (await createContact(env, { displayName: extracted.senderName, email: extracted.senderEmail }, "Outlook .msg sender header")).id;
  }
  if (refreshingDuplicate && !contactId) contactId = duplicate!.contact_id;
  const objectKey = `contacts/${contactId || "unassigned"}/emails/${sha}/${fileName}`;
  await env.CONTACT_FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/vnd.ms-outlook" }, customMetadata: { sha256: sha, importId } });
  const emailId = existingEmail?.id || id(); const status = extracted.parseError ? "review" : (contactId ? "completed" : "review");
  if (retryingReview || refreshingDuplicate) {
    await env.DB.prepare("UPDATE ssx_contact_emails SET contact_id=?,sender_name=?,sender_email=?,recipients_json=?,subject=?,body_text=?,extraction_status=? WHERE id=?").bind(contactId,extracted.senderName || null,extracted.senderEmail || null,JSON.stringify(extracted.recipients),extracted.subject || null,extracted.bodyText || null,extracted.parseError ? "review" : "extracted",emailId).run();
    if (retryingReview) await env.DB.prepare("UPDATE ssx_contact_import_jobs SET status=?,contact_id=?,error_message=?,updated_at=? WHERE id=?").bind(status,contactId,extracted.parseError || null,now,importId).run();
  } else {
    await env.DB.prepare("INSERT INTO ssx_contact_emails (id,contact_id,direction,sender_name,sender_email,recipients_json,subject,received_at,body_text,original_msg_r2_key,original_file_name,original_sha256,original_size_bytes,extraction_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(emailId,contactId,"received",extracted.senderName || null,extracted.senderEmail || null,JSON.stringify(extracted.recipients),extracted.subject || null,now,extracted.bodyText || null,objectKey,fileName,sha,bytes.byteLength,extracted.parseError ? "review" : "extracted",now).run();
    await env.DB.prepare("INSERT INTO ssx_contact_import_jobs (id,original_file_name,original_sha256,status,contact_id,email_id,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(importId,fileName,sha,status,contactId,emailId,extracted.parseError || null,now,now).run();
  }
  let company: Record<string, unknown> | null = null;
  let facts: SignatureFacts = {};
  if (contactId && !extracted.parseError) {
    facts = signatureFacts(extracted.bodyText, extracted.senderName);
    const current = await env.DB.prepare("SELECT company_id,primary_phone,title FROM ssx_contacts WHERE id=?").bind(contactId).first<{company_id:string|null;primary_phone:string|null;title:string|null}>();
    if (facts.companyName) {
      company = await saveCompany(env, current?.company_id || null, {
        name: facts.companyName,
        website: facts.website,
        phone: facts.phone,
        tradeCategory: facts.tradeCategory,
        sourceContactId: contactId,
        sourceEmailId: emailId,
        sourceLocation: "Outlook .msg signature"
      }) as Record<string, unknown> | null;
      if (company?.id) {
        await env.DB.batch([
          env.DB.prepare("UPDATE ssx_contacts SET company_id=COALESCE(company_id,?),updated_at=? WHERE id=?").bind(String(company.id),now,contactId),
          env.DB.prepare("UPDATE ssx_contact_emails SET company_id=? WHERE id=?").bind(String(company.id),emailId),
          env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,emailId,"company_link",String(company.id),"Outlook .msg signature")
        ]);
      }
    }
    if (facts.phone || facts.title) {
      await env.DB.prepare("UPDATE ssx_contacts SET primary_phone=CASE WHEN primary_phone IS NULL OR trim(primary_phone)='' THEN ? ELSE primary_phone END,title=CASE WHEN title IS NULL OR trim(title)='' OR title GLOB '*[0-9]*' OR lower(title) GLOB 'o:*' OR lower(title) GLOB 'm:*' OR lower(title)='dale farrow' THEN ? ELSE title END,updated_at=? WHERE id=?").bind(facts.phone || null,facts.title || null,now,contactId).run();
      for (const [field, value] of Object.entries({ primary_phone: facts.phone, title: facts.title, trade_category: facts.tradeCategory })) if (value) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,emailId,field,value,"Outlook .msg signature").run();
    }
  }

  const action = requestedAction(extracted.subject, extracted.bodyText);
  if (contactId && action && !refreshingDuplicate) {
    const taskTitle = `Review email action request${extracted.subject ? `: ${extracted.subject.slice(0, 180)}` : ""}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ssx_contact_tasks (id,contact_id,email_id,title,description,priority,status) VALUES (?,?,?,?,?,'normal','open')").bind(id(),contactId,emailId,taskTitle,action),
      env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,emailId,"action_request",action,"Outlook .msg subject/body")
    ]);
  }
  let signatureLogoKey: string | null = null;
  for (const attachment of extracted.attachments) {
    const detectedImageType = imageContentType(attachment.content);
    const extension = detectedImageType === "image/png" ? ".png" : detectedImageType === "image/jpeg" ? ".jpg" : detectedImageType === "image/gif" ? ".gif" : detectedImageType === "image/webp" ? ".webp" : "";
    const rawName = attachment.fileName || "outlook-inline-attachment";
    const attachmentName = safeName(/\.[a-z0-9]{2,5}$/i.test(rawName) || !extension ? rawName : rawName + extension);
    const attachmentSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", attachment.content))).map(v => v.toString(16).padStart(2,"0")).join("");
    const attachmentKey = `contacts/${contactId || "unassigned"}/attachments/${attachmentSha}/${attachmentName}`;
    const contentType = detectedImageType || "application/octet-stream";
    await env.CONTACT_FILES.put(attachmentKey, attachment.content, { httpMetadata: { contentType }, customMetadata: { sha256: attachmentSha, emailId } });
    await env.DB.prepare("INSERT OR IGNORE INTO ssx_contact_attachments (id,email_id,file_name,content_type,r2_key,sha256,size_bytes) VALUES (?,?,?,?,?,?,?)").bind(id(),emailId,attachmentName,contentType,attachmentKey,attachmentSha,attachment.content.byteLength).run();
    if (!signatureLogoKey && detectedImageType) signatureLogoKey = attachmentKey;
  }
  if (contactId && company?.id && signatureLogoKey) {
    await env.DB.batch([
      env.DB.prepare("UPDATE ssx_companies SET logo_r2_key=COALESCE(logo_r2_key,?),updated_at=? WHERE id=?").bind(signatureLogoKey,now,String(company.id)),
      env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,emailId,"company_logo_r2_key",signatureLogoKey,"Outlook .msg signature image")
    ]);
  }
  if (contactId) for (const [field,value] of Object.entries({ sender_name: extracted.senderName, sender_email: extracted.senderEmail, subject: extracted.subject })) if (value) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,emailId,field,value,"Outlook .msg header").run();
  const projectName = contactId ? projectFromEmail(extracted.subject, fileName, extracted.bodyText) : null;
  const project = contactId && projectName ? await linkProject(env, contactId, { projectName, projectRole: "Email correspondence", isCurrent: true, sourceEmailId: emailId, sourceLocation: "Outlook .msg subject/body" }) : null;
  const contact = contactId ? await env.DB.prepare("SELECT id,display_name,primary_email,primary_phone FROM ssx_contacts WHERE id=?").bind(contactId).first() : null;
  return json({ id: importId, contactId, emailId, status, duplicate: refreshingDuplicate, retried: retryingReview, profileRefreshed: refreshingDuplicate, completion: { emailStored: true, contact, company: company ? { id: company.id, name: company.name, website: company.website, phone: company.phone, logoStored: Boolean(signatureLogoKey) } : null, project, daleTodoCreated: Boolean(action) }, message: extracted.parseError ? "Original .msg stored privately; parser needs review." : "Original .msg stored and source-supported contact facts recorded." }, retryingReview ? 200 : 201, await sessionHeaders(request, env));
}

function daleTodoPage() {
  return new Response("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Dale To Do | SSX</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#05080d;color:#e8f7ff;font:15px Arial,sans-serif;padding:36px}main{max-width:1200px;margin:auto}h1{letter-spacing:.08em;text-transform:uppercase;margin:0}p{color:#8daab8}.bar{display:flex;justify-content:space-between;align-items:center;margin:20px 0;padding:16px;border:1px solid #1d4158;background:#0a111a;border-radius:8px}.count{color:#18bdf4;font-weight:bold}.task{border:1px solid #1d4158;background:#0a111a;border-radius:8px;padding:16px;margin:12px 0}.task h2{font-size:17px;margin:0 0 8px}.meta{color:#8daab8;font-size:13px;margin-bottom:10px}.done{float:right;background:#0d4f75;border:1px solid #18bdf4;color:white;padding:8px 12px;border-radius:5px;font-weight:bold;cursor:pointer}.empty{padding:30px;border:1px solid #1d4158;border-radius:8px;color:#8daab8}</style></head><body><main><h1>Dale To Do</h1><p>Open items created from your imported emails. Refreshes live from the SSX Contact System.</p><div class=\"bar\"><span id=\"summary\">Loading your list…</span><button class=\"done\" onclick=\"load()\">Refresh</button></div><section id=\"list\"></section></main><script>const list=document.getElementById('list'),summary=document.getElementById('summary');async function load(){const r=await fetch('/contact-system/dale-todos/data');if(!r.ok){summary.textContent='Sign in through the Email Upload page first.';return}const d=await r.json();summary.innerHTML='<span class=\"count\">'+d.tasks.length+'</span> open item'+(d.tasks.length===1?'':'s')+' — daily 3:00 PM review list';list.innerHTML=d.tasks.length?d.tasks.map(t=>'<article class=\"task\"><button class=\"done\" onclick=\"complete(\\''+t.id+'\\')\">Complete</button><h2>'+esc(t.title)+'</h2><div class=\"meta\">'+esc(t.contact_name||'Unassigned contact')+(t.company_name?' · '+esc(t.company_name):'')+(t.subject?' · '+esc(t.subject):'')+'</div><div>'+esc(t.description||'')+'</div></article>').join(''):'<div class=\"empty\">No open Dale To Do items.</div>'}function esc(v){const d=document.createElement('div');d.textContent=v||'';return d.innerHTML}async function complete(id){await fetch('/contact-system/tasks/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'completed'})});load()}load();</script></body></html>", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function loginPage() {
  return new Response("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>SSX Contact System Sign In</title><style>:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05080d;color:#e8f7ff;font:15px Arial}main{width:min(460px,90vw);padding:28px;border:1px solid #1d4158;border-radius:8px;background:#0a111a}h1{margin:0 0 8px;letter-spacing:.08em;text-transform:uppercase}p{color:#8daab8}label{display:block;margin:18px 0 6px;color:#bfefff;font-size:11px;font-weight:bold;text-transform:uppercase}input,button{width:100%;box-sizing:border-box;padding:12px;border-radius:6px;border:1px solid #1d4158;background:#07111a;color:#e8f7ff}button{margin-top:16px;background:#0d4f75;border-color:#18bdf4;font-weight:bold;cursor:pointer}.status{margin-top:14px;color:#ffb5af}</style></head><body><main><h1>SSX Contact System</h1><p>Private access for Dale Farrow.</p><label for=\"code\">Sign-in code</label><input id=\"code\" type=\"password\" autocomplete=\"current-password\"><button id=\"signIn\">Sign In</button><div id=\"status\" class=\"status\"></div></main><script>document.getElementById('signIn').onclick=async()=>{const code=document.getElementById('code').value.trim(),status=document.getElementById('status');if(!code){status.textContent='Enter your sign-in code.';return}const r=await fetch('/contact-system/session',{method:'POST',headers:{Authorization:'Bearer '+code}});if(!r.ok){status.textContent='That sign-in code was not accepted.';return}location.href=location.pathname.includes('dale-todos')?'/contact-system/dale-todos':'/contact-system/upload'}</script></body></html>", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function uploadPage() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SSX Contact System Upload</title>
  <style>
    :root { color-scheme: dark; --bg:#05080d; --panel:#0a111a; --line:#1d4158; --blue:#18bdf4; --gold:#d8b24a; --text:#e8f7ff; --muted:#8daab8; --bad:#ff6a62; --good:#38d987; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; background:radial-gradient(circle at top, #102334 0, #05080d 42%, #020305 100%); color:var(--text); font:14px/1.45 Arial, sans-serif; padding:16px; }
    main { width:100%; min-height:calc(100vh - 32px); margin:0; border:1px solid var(--line); background:rgba(5,10,16,.92); border-radius:8px; box-shadow:0 18px 60px rgba(0,0,0,.45); padding:12px; display:grid; grid-template-columns:260px minmax(0,1fr); gap:14px; align-items:start; }
    .uploadPane { min-width:0; }
    @media (max-width:960px) { main { display:block; } .card { margin-top:18px !important; min-height:0 !important; } }
    h1 { margin:0 0 6px; font-size:22px; letter-spacing:.08em; text-transform:uppercase; color:#fff; }
    .sub { margin:0 0 18px; color:var(--muted); }
    label { display:block; margin:14px 0 6px; color:#bfefff; font-weight:700; letter-spacing:.04em; text-transform:uppercase; font-size:11px; }
    input, button { width:100%; border-radius:6px; border:1px solid var(--line); background:#07111a; color:var(--text); padding:11px 12px; font:inherit; }
    input[type=file] { display:none; }
    .drop { margin-top:8px; min-height:150px; display:grid; place-items:center; border:2px dashed #1d6e92; border-radius:8px; padding:32px 18px; text-align:center; color:#bfefff; cursor:pointer; background:#07111a; }
    .drop.over { border-color:#18bdf4; background:#0d2738; }
    button { margin-top:10px; border-color:var(--blue); background:linear-gradient(180deg, #0d4f75, #082739); color:#e9fbff; font-weight:800; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
    button:disabled { opacity:.55; cursor:not-allowed; }
    .copy { margin-top:8px; padding:8px 10px; font-size:12px; }
    .status { margin-top:10px; max-height:76px; overflow:auto; padding:10px; border:1px solid var(--line); border-radius:6px; background:#07111a; white-space:pre-wrap; min-height:42px; color:var(--muted); user-select:text; }
    .ok { border-color:rgba(56,217,135,.65); color:#c8ffe0; }
    .bad { border-color:rgba(255,106,98,.75); color:#ffd1cd; }
    .note { margin-top:10px; color:var(--gold); font-size:12px; }
    .card { display:block; min-height:calc(100vh - 56px); margin-top:0; padding:0; overflow:hidden; border:1px solid #18bdf4; border-radius:8px; background:#08131d; }
    .cardPreview { display:block; width:100%; height:calc(100vh - 56px); border:0; background:#05080d; }
    .card h2 { margin:0 0 12px; letter-spacing:.06em; text-transform:uppercase; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .field { padding:10px; border:1px solid #1d4158; border-radius:6px; background:#07111a; }
    .field b { display:block; color:#8daab8; font-size:11px; margin-bottom:4px; }
    .section { margin-top:14px; padding-top:12px; border-top:1px solid #1d4158; }
    .section li { margin:5px 0; color:#c8dbe4; }
    .cardPlaceholder { min-height:calc(100vh - 160px); padding:24px; }
    .cardTop { display:flex; justify-content:space-between; align-items:center; padding-bottom:18px; border-bottom:1px solid #1d4158; }
    .cardTop h2 { margin:0; }
    .badge { color:#38d987; border:1px solid #38d987; border-radius:999px; padding:5px 10px; font-size:11px; font-weight:700; }
    .cardColumns { display:grid; grid-template-columns:1.1fr .9fr; gap:18px; margin-top:18px; }
    .cardGroup { min-height:205px; padding:16px; border:1px solid #1d4158; border-radius:6px; background:#07111a; }
    .cardGroup b { color:#bfefff; font-size:11px; letter-spacing:.05em; }
    .blankLine { height:34px; margin-top:12px; border-bottom:1px solid #173244; color:#627e8d; font-size:12px; padding-top:12px; }
    .cardTemplate { min-height:calc(100vh - 96px); }
    .cardHeader { display:flex; justify-content:space-between; gap:18px; align-items:start; padding:0 0 18px; border-bottom:1px solid #1d4158; }
    .contactName { margin:2px 0 4px; font-size:34px; line-height:1.08; letter-spacing:.02em; text-transform:uppercase; color:#fff; }
    .cardKicker { color:#8daab8; font-size:11px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; }
    .templateGrid { display:grid; grid-template-columns:1.25fr .85fr; gap:16px; margin-top:16px; }
    .templatePanel { padding:16px; border:1px solid #1d4158; border-radius:7px; background:#07111a; }
    .templatePanel h3 { margin:0 0 12px; color:#bfefff; font-size:12px; letter-spacing:.07em; }
    .infoRows { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
    .info { min-height:58px; padding:10px; border:1px solid #173244; border-radius:5px; background:#09141e; }
    .info span { display:block; color:#8daab8; font-size:10px; font-weight:700; letter-spacing:.05em; margin-bottom:4px; }
    .info strong { display:block; font-size:14px; overflow-wrap:anywhere; }
    .wide { grid-column:1/-1; }
    .templateList { list-style:none; padding:0; margin:0; }
    .templateList li { padding:9px 0; border-top:1px solid #173244; color:#d5e9f2; }
    .templateList li:first-child { border-top:0; }
    .alert { color:#ffd37a; }
    @media (max-width:1100px) { .templateGrid { grid-template-columns:1fr; } .contactName { font-size:27px; } }
  </style>
</head>
<body>
  <main>
    <div class="uploadPane">
    <h1>SSX Contact System Upload</h1>
    <p class="sub">Upload an Outlook .msg file directly into the live Cloudflare Contact System.</p>

    <div id="signIn">
      <label for="token">One-time sign-in code</label>
      <input id="token" type="password" autocomplete="off" placeholder="Use the contact-system code one final time." />
      <p class="note">After this first upload, this page remembers a secure session for 30 days. The code itself is not saved on this computer.</p>
    </div>

    <label for="file">Drop Outlook Email Here</label>
    <input id="file" type="file" accept=".msg,application/vnd.ms-outlook" />
    <div id="dropZone" class="drop"><strong>DROP .MSG EMAIL HERE</strong><br><span id="fileLabel">or click to choose an Outlook email</span></div>

    <button id="upload">Upload Email And Create Contact</button>
    <div id="status" class="status">Waiting for .msg file.</div>
    <button id="copyResult" class="copy" hidden>Copy Result</button>
    <p class="note">Upload goes directly into the Cloudflare contact system and private D1/R2 storage.</p>
    </div>
    <section id="cardWindow" class="card" aria-label="Completed contact card preview"></section>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    const status = $('status');
    const upload = $('upload');
    const copyResult = $('copyResult');
    const tokenInput = $('token');
    const signIn = $('signIn');
    const fileInput = $('file');
    const dropZone = $('dropZone');
    const fileLabel = $('fileLabel');
    let selectedFile;
    function chooseFile(file) {
      if (!file) return;
      selectedFile = file;
      fileLabel.textContent = file.name + ' ready — click Upload Email And Create Contact.';
    }
    fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
    dropZone.addEventListener('click', () => fileInput.click());
    ['dragenter','dragover'].forEach(event => dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.add('over'); }));
    ['dragleave','drop'].forEach(event => dropZone.addEventListener(event, e => { e.preventDefault(); dropZone.classList.remove('over'); }));
    dropZone.addEventListener('drop', e => chooseFile(e.dataTransfer.files[0]));
    let signedIn = false;
    fetch('/contact-system/session').then(response => {
      signedIn = response.ok;
      if (signedIn) { signIn.hidden = true; setStatus('Signed in. Choose an Outlook .msg file to upload.', true); }
    });

    function hex(buffer) {
      return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    function setStatus(message, ok) {
      status.textContent = message;
      status.className = 'status ' + (ok === true ? 'ok' : ok === false ? 'bad' : '');
    }
    copyResult.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(status.textContent); copyResult.textContent = 'Copied'; setTimeout(() => copyResult.textContent = 'Copy Result', 1400); }
      catch { setStatus('Select the result text and press Ctrl+C to copy it.', false); }
    });
    const esc = value => { const el = document.createElement('div'); el.textContent = value || 'Not provided'; return el.innerHTML; };
    async function showContactCard(contactId) {
      if (!contactId) throw new Error('The email was saved, but no contact record was created.');
      const response = await fetch('/contact-system/contact-card-preview/' + encodeURIComponent(contactId), { cache: 'no-store' });
      if (!response.ok) {
        const message = await response.text();
        throw new Error('Saved contact card could not be rendered: ' + message);
      }
      const cardHtml = await response.text();
      if (!cardHtml.trim()) throw new Error('Saved contact card is not ready yet.');
      const cardUrl = URL.createObjectURL(new Blob([cardHtml], { type: 'text/html' }));
      $('cardWindow').innerHTML = '<iframe class="cardPreview" title="Saved SSX Contact Card" src="' + cardUrl + '"></iframe>';
    }

    upload.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      const file = selectedFile || fileInput.files[0];
      if (!signedIn && !token) return setStatus('Enter the one-time sign-in code for this first upload.', false);
      if (!file) return setStatus('Choose one .msg file first.', false);
      if (!file.name.toLowerCase().endsWith('.msg')) return setStatus('Only .msg files are accepted.', false);

      upload.disabled = true;
      try {
        setStatus('Reading file and calculating SHA-256...', null);
        const bytes = await file.arrayBuffer();
        const sha = hex(await crypto.subtle.digest('SHA-256', bytes));
        setStatus('Uploading directly to Cloudflare storage...', null);
        const response = await fetch('/contact-system/email-imports', {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            'Content-Type': 'application/vnd.ms-outlook',
            'X-SSX-File-Name': encodeURIComponent(file.name),
            'X-SSX-SHA256': sha, 'X-SSX-Refresh-Profile': '1'
          },
          body: bytes
        });
        const text = await response.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        if (!response.ok && response.status !== 409) throw new Error(JSON.stringify(data, null, 2));
        if (response.ok || response.status === 409) { signedIn = true; signIn.hidden = true; }
        const c = data.completion;
        const summary = c ? ['CONTACT CARD CREATED', 'NAME: ' + (c.contact ? c.contact.display_name : 'Needs review'), 'EMAIL: ' + (c.contact?.primary_email || 'Not found in email'), 'PHONE: ' + (c.contact?.primary_phone || 'Not found in email'), 'PROJECT: ' + (c.project ? c.project.project_name : 'Needs project review'), 'DALE TO DO: ' + (c.daleTodoCreated ? 'Created' : 'None found'), 'EMAIL STORED: YES'].join('\\n') : JSON.stringify(data, null, 2);
        setStatus((response.status === 409 && data.import?.status !== 'completed' ? 'ALREADY STORED' : 'COMPLETE') + '\\n\\n' + summary, true);
        copyResult.hidden = false;
        await showContactCard(data.completion?.contact?.id || data.contactId || data.import?.contact_id);
      } catch (error) {
        copyResult.hidden = true;
        setStatus('FAILED\\n\\n' + (error.message || error), false);
      } finally {
        upload.disabled = false;
      }
    });
  </script>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (path === "/contact-system/health" && request.method === "GET") {
      const companyColumns = await env.DB.prepare("PRAGMA table_info(ssx_companies)").all<{name:string}>();
      const names = new Set(companyColumns.results.map(column => column.name));
      const emrSchemaReady = names.has("emr_rating") && names.has("emr_effective_date");
      return json({ system:"SSX Contact System", storage:"Cloudflare D1 + private R2", mode:"source-only", aiEnrichment:false, importRetry:"sha-email-lookup-v2", approvedContactCardPreview:"server-rendered-from-saved-contact-record", viewerInitialState:"blank-until-contact-is-saved", cardRenderer:"direct-saved-record-template-fill-v2", uploadMode:"manual-click-only", emrSchemaReady, ready:emrSchemaReady, timestamp:new Date().toISOString() });
    }
    if (path === "/contact-system/login" && request.method === "GET") return loginPage();
    if (path === "/contact-system/session" && request.method === "POST") return request.headers.get("Authorization") === "Bearer " + env.CONTACT_SYSTEM_TOKEN ? json({ signedIn: true }, 200, await sessionHeaders(request, env)) : json({ signedIn: false }, 401);
    if (path === "/contact-system/session" && request.method === "GET") return await authorized(request, env) ? json({ signedIn: true }) : json({ signedIn: false }, 401);
    if (path === "/contact-system/upload" && request.method === "GET") return await authorized(request, env) ? uploadPage() : loginPage();
    if (path === "/contact-system/dale-todos" && request.method === "GET") return await authorized(request, env) ? daleTodoPage() : loginPage();
    const authError = await requireAuth(request, env); if (authError) return authError;
    if (path === "/contact-system/contact-card-template" && request.method === "GET") {
      try {
        const template = await fetch(masterContactCardTemplateUrl);
        if (!template.ok) throw new Error("Approved card template could not be loaded");
        const page = (await template.text()).replace("</head>", "<style>body{zoom:1!important;width:100%!important;overflow:hidden!important}</style></head>");
        return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
      } catch (error) {
        return json({ error: "Approved contact card template failed to load", detail: error instanceof Error ? error.message : String(error) }, 502);
      }
    }
    const cardPreviewMatch = path.match(/^\/contact-system\/contact-card-preview\/([^/]+)$/);
    if (cardPreviewMatch && request.method === "GET") {
      try {
        const contact = await env.DB.prepare("SELECT c.*,co.name AS company_name,co.website AS company_website,co.emr_rating AS company_emr_rating,co.emr_effective_date AS company_emr_effective_date, co.logo_r2_key AS company_logo_r2_key, co.trade_category AS company_trade_category FROM ssx_contacts c LEFT JOIN ssx_companies co ON co.id=c.company_id WHERE c.id=?").bind(cardPreviewMatch[1]).first<Record<string, unknown>>();
        if (!contact) return json({ error: "Contact not found" }, 404);
        const [projects, tasks, emails, logoAttachments, attachments] = await env.DB.batch([
          env.DB.prepare("SELECT project_name,project_role,is_current,source_email_id FROM ssx_contact_projects WHERE contact_id=? ORDER BY is_current DESC,linked_at DESC LIMIT 20").bind(cardPreviewMatch[1]),
          env.DB.prepare("SELECT title,status FROM ssx_contact_tasks WHERE contact_id=? ORDER BY created_at DESC LIMIT 20").bind(cardPreviewMatch[1]),
          env.DB.prepare("SELECT id,subject,sender_name,sender_email,received_at,original_file_name FROM ssx_contact_emails WHERE contact_id=? ORDER BY received_at DESC LIMIT 20").bind(cardPreviewMatch[1]),
          env.DB.prepare("SELECT a.id FROM ssx_contact_attachments a JOIN ssx_contact_emails e ON e.id=a.email_id WHERE e.contact_id=? AND a.r2_key=? LIMIT 1").bind(cardPreviewMatch[1], String(contact.company_logo_r2_key || "")),
          env.DB.prepare("SELECT a.id,a.file_name,a.content_type,a.size_bytes FROM ssx_contact_attachments a JOIN ssx_contact_emails e ON e.id=a.email_id WHERE e.contact_id=? ORDER BY a.created_at DESC LIMIT 20").bind(cardPreviewMatch[1])
        ]);
        const detail = { contact, projects: projects.results, tasks: tasks.results, emails: emails.results, cois: [], completeness: completeness(contact) };
        const template = await fetch(masterContactCardTemplateUrl);
        if (!template.ok) throw new Error("Approved card template could not be loaded");
        let page = await template.text();
        const projectRows = projects.results as Array<Record<string, unknown>>;
        const taskRows = tasks.results as Array<Record<string, unknown>>;
        const emailRows = emails.results as Array<Record<string, unknown>>;
        const latestEmail = emailRows[0] || {};
        const sourceProjectRows = projectRows.filter(project => project.source_email_id === latestEmail.id);
        const hasProject = sourceProjectRows.length > 0;
        const firstProject = sourceProjectRows[0]?.project_name || "No project link saved from this email";
        const projectRole = sourceProjectRows[0]?.project_role || "Source email did not identify a project";
        const firstTask = taskRows[0]?.title || "No Dale action found";
        const latestSubject = latestEmail.subject || latestEmail.original_file_name || "Stored Outlook source email";
        const receivedValue = typeof latestEmail.received_at === "string" ? latestEmail.received_at.replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Stored with this contact";
        const senderLabel = latestEmail.sender_name ? String(latestEmail.sender_name) + (latestEmail.sender_email ? " <" + String(latestEmail.sender_email) + ">" : "") : (latestEmail.sender_email ? String(latestEmail.sender_email) : "Sender not provided");
        const cois = detail.cois as Array<Record<string, unknown>>;
        const hasCoi = cois.length > 0;
        const cardsComplete = Number(detail.completeness.score || 0) >= 75;
        const values: Array<[string, unknown]> = [
          ["Avery Walsh", contact.display_name], ["Northstar Climate Systems", contact.company_name],
          ["avery.walsh@example.com", contact.primary_email], ["northstar.example", contact.company_website],
          ["Demo Contact Record", contact.primary_phone], ["Mechanical Supplier / Vendor", contact.title],
          ["Autograph by Marriott — Jericho, NY", firstProject], ["Jericho, NY 11753", projectRole],
          ["Hotel Development", hasProject ? "Saved from Outlook email" : "No source-backed project"],
          ["PROJECT IMAGE", hasProject ? "PROJECT LINK SAVED" : "NO PROJECT LINK"],
          ["View Project", hasProject ? "Saved Project Link" : "No Project Link"],
          ["Demo project inquiry — equipment budget help", latestSubject],
          ["Received: Jul 30, 2026 · 10:24 AM", "Received: " + receivedValue],
          ["From: Avery Walsh &lt;avery.walsh@example.com&gt;", "From: " + senderLabel],
          ["Re: Demo project inquiry", latestSubject], ["RE: Equipment information request", latestSubject], ["SCHEDULE MEETING", firstTask],
          ["REQUEST REFRIGERATOR SIZES", firstTask],
          ["58%", String(detail.completeness.score || 0) + "%"],
          ["PARTIAL<br>PROFILE", cardsComplete ? "PROFILE<br>ON FILE" : "PROFILE<br>NEEDS REVIEW"],
          ["INCOMPLETE", hasCoi ? "COI ON FILE" : "COI REVIEW"],
          ["ACTION REQUIRED", hasCoi ? "SOURCE-VERIFIED" : "ACTION REQUIRED"],
          ["MISSING: COI EXPIRATION", hasCoi ? "COI EXPIRATION: REVIEW CARD" : "MISSING: COI EXPIRATION"],
          ["MISSING: COI EMAIL", hasCoi ? "COI SOURCE EMAIL: ON FILE" : "MISSING: COI EMAIL"],
          ["MISSING: COI DOCUMENT", hasCoi ? "COI DOCUMENT: ON FILE" : "MISSING: COI DOCUMENT"],
          ["Not in Master List", "Server Contact Record"],
          ["Candidate for Review", "Saved in SSX Contact System"],
          ["No Duplicates Found", "Duplicate Review Recorded"],
          ["Checked: Jul 30, 12:10 PM", "Saved from Outlook email"]
        ];
        const replacements = new Map(values.map(([from, to]) => [from, escapeCardHtml(to)]));
        const profileLabels: Array<[string, string]> = [
          ["Email Verified", contact.primary_email ? "Email on file" : "Email missing"],
          ["Company Verified", contact.company_name ? "Company on file" : "Company missing"],
          ["Company Basic", contact.company_website || contact.company_name ? "Company detail on file" : "Company detail missing"],
          ["Contact Title", validTitle(contact.title) ? "Title on file" : "Title missing"],
          ["Trade Category", contact.company_trade_category ? "Trade: " + String(contact.company_trade_category) : "Trade category missing"],
          ["Member Status", "Member status not reviewed"],
          ["Logo Verified", contact.company_logo_r2_key ? "Source logo on file" : "Logo not provided"],
          ["VERIFIED PROFILE", "RESEARCH NOT RUN"],
          ["Online Presence Found", "No online research stored"],
          ["Industry Match", "Email-signature facts only"],
          ["Confidence Score", "Source-backed score"],
          ["92%", "—"],
          ["Contact linked to active project.", hasProject ? "Project link saved from this email." : "No project link found in this email."]
        ];
        for (const [from, to] of profileLabels) page = page.replaceAll(from, escapeCardHtml(to));
        const logoAttachment = (logoAttachments.results as Array<Record<string, unknown>>)[0];
        const logoUrl = logoAttachment?.id ? "/contact-system/files/" + String(logoAttachment.id) + "?inline=1" : "";
        const logoLabel = logoUrl ? "SOURCE LOGO ON FILE" : "NO SOURCE LOGO SAVED";
        const completenessRows = [
          ["Email", Boolean(contact.primary_email)],
          ["Company", Boolean(contact.company_name)],
          ["Website", Boolean(contact.company_website)],
          ["Title", validTitle(contact.title)],
          ["Trade category", Boolean(contact.company_trade_category)],
          ["Logo", Boolean(logoUrl)]
        ].map(([label, present]) => "<span class=\"" + (present ? "ok" : "bad") + "\">" + label + ": " + (present ? "on file" : "missing") + "</span>").join("");
        page = page.replace(/<div class="checks">[\s\S]*?<\/div>/, "<div class=\"checks\">" + completenessRows + "</div>");
        page = page.replace(/<div class="malkin">[\s\S]*?<\/div>/, "<div class=\"malkin\">" + (logoUrl ? "<img src=\"" + logoUrl + "\" alt=\"Company logo\">" : "<span>NO SOURCE LOGO SAVED</span>") + "</div>");
        const communicationSeen = new Set<string>();
        const historyEmails = emailRows.filter(email => {
          const key = normalize(String(email.sender_email || "") + "|" + String(email.subject || email.original_file_name || ""));
          if (communicationSeen.has(key)) return false;
          communicationSeen.add(key);
          return true;
        }).slice(0, 3);
        const communicationRows = historyEmails.map(email => {
          const subject = escapeCardHtml(email.subject || email.original_file_name || "Outlook email");
          const occurred = typeof email.received_at === "string" ? escapeCardHtml(email.received_at.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")) : "";
          return "<span><i>✉</i><b>" + subject + "</b><em>" + occurred + "</em></span>";
        }).join("");
        page = page.replace(/<section class="sub detail-card communication-card">[\s\S]*?<\/section>\n<section class="sub detail-card attachments-card">/, "<section class=\"sub detail-card communication-card\"><h3>Communication History</h3><div class=\"communication-list\">" + communicationRows + "</div></section>\n<section class=\"sub detail-card attachments-card\">");
        const attachmentRows = (attachments.results as Array<Record<string, unknown>>).slice(0, 6).map(attachment => {
          const name = escapeCardHtml(attachment.file_name || "Attachment");
          const type = String(attachment.content_type || "").includes("pdf") ? "PDF" : String(attachment.content_type || "").startsWith("image/") ? "IMG" : String(attachment.file_name || "").split(".").pop()?.toUpperCase().slice(0,4) || "FILE";
          return "<a class=\"file-tile\" href=\"/contact-system/files/" + encodeURIComponent(String(attachment.id)) + "\" target=\"_blank\" rel=\"noreferrer\"><b>" + escapeCardHtml(type) + "</b><span>" + name + "</span></a>";
        }).join("");
        page = page.replace(/<section class="sub detail-card attachments-card">[\s\S]*?<\/section>\n<\/div><\/article>/, "<section class=\"sub detail-card attachments-card\"><h3>Attachments <em>(" + String((attachments.results as Array<unknown>).length) + ")</em></h3><div class=\"attachment-list\">" + attachmentRows + "</div><span class=\"detail-button\">" + ((attachments.results as Array<unknown>).length ? "Saved from Outlook email" : "No email attachments") + "</span></section>\n</div></article>");
        const templateTokens = /Avery Walsh|Northstar Climate Systems|avery\.walsh@example\.com|northstar\.example|Demo Contact Record|Mechanical Supplier \/ Vendor|Autograph by Marriott — Jericho, NY|Jericho, NY 11753|Hotel Development|PROJECT IMAGE|View Project|Demo project inquiry — equipment budget help|Received: Jul 30, 2026 · 10:24 AM|From: Avery Walsh &lt;avery\.walsh@example\.com&gt;|Re: Demo project inquiry|RE: Equipment information request|SCHEDULE MEETING|REQUEST REFRIGERATOR SIZES|58%|PARTIAL<br>PROFILE|INCOMPLETE|ACTION REQUIRED|MISSING: COI EXPIRATION|MISSING: COI EMAIL|MISSING: COI DOCUMENT|Not in Master List|Candidate for Review|No Duplicates Found|Checked: Jul 30, 12:10 PM/g;
        page = page.replace(templateTokens, token => replacements.get(token) || token);
        page = page.replace("</head>", "<style>body{zoom:1!important;width:100%!important;overflow:hidden!important}.malkin{font-size:11px!important;color:#121518!important}.malkin>*{display:block!important}.malkin img{width:100%!important;height:100%!important;object-fit:contain!important}.malkin span{display:grid!important;place-items:center!important;width:100%!important;height:100%!important;text-align:center!important;font-weight:700!important}.malkin:before,.malkin:after{content:none!important}.project-photo-frame img{display:none!important}.project-photo-frame{background:#071017!important;display:grid!important;place-items:center!important;color:#8daab8!important;font-size:10px!important}.malkin{background-image:none!important;background-size:contain!important;background-repeat:no-repeat!important;background-position:center!important}.ring{background:conic-gradient(#e4ae24 0 " + String(detail.completeness.score || 0) + "%,#1c2931 " + String(detail.completeness.score || 0) + "% 100%)!important}.research .meter i{width:0!important}</style></head>");
        return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
      } catch (error) {
        return json({ error: "Saved contact card render failed", detail: error instanceof Error ? error.message : String(error) }, 502);
      }
    }
    if (path === "/contact-system/dale-todos/data" && request.method === "GET") {
      const tasks = await env.DB.prepare("SELECT t.id,t.title,t.description,t.priority,t.created_at,c.display_name AS contact_name,co.name AS company_name,e.subject FROM ssx_contact_tasks t LEFT JOIN ssx_contacts c ON c.id=t.contact_id LEFT JOIN ssx_companies co ON co.id=c.company_id LEFT JOIN ssx_contact_emails e ON e.id=t.email_id WHERE t.status='open' ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,t.created_at DESC").all();
      return json({ generatedAt: new Date().toISOString(), tasks: tasks.results });
    }
    if (path === "/contact-system/review-queue" && request.method === "GET") {
      const [imports, duplicates, incomplete, cois] = await env.DB.batch([
        env.DB.prepare("SELECT id,original_file_name,error_message,created_at FROM ssx_contact_import_jobs WHERE status='review' ORDER BY created_at DESC LIMIT 100"),
        env.DB.prepare("SELECT d.id,d.contact_id,c.display_name,d.possible_duplicate_contact_id,d.match_reason,d.created_at FROM ssx_contact_duplicate_reviews d JOIN ssx_contacts c ON c.id=d.contact_id WHERE d.status='open' ORDER BY d.created_at DESC LIMIT 100"),
        env.DB.prepare("SELECT c.id,c.display_name,c.primary_email,c.primary_phone,c.title,status FROM ssx_contacts c LEFT JOIN ssx_companies co ON co.id=c.company_id ORDER BY c.updated_at DESC LIMIT 250"),
        env.DB.prepare("SELECT c.id,c.contact_id,c.expiration_date,c.status,a.file_name FROM ssx_contact_cois c JOIN ssx_contact_attachments a ON a.id=c.attachment_id ORDER BY c.expiration_date ASC LIMIT 100")
      ]);
      const incompleteContacts = (incomplete.results as Array<Record<string, unknown>>).map(contact => ({ ...contact, completeness: completeness(contact) })).filter(contact => !(contact.completeness as {complete:boolean}).complete);
      const attentionCois = (cois.results as Array<Record<string, unknown>>).map(coi => ({ ...coi, calculated_status: coiStatus(typeof coi.expiration_date === "string" ? coi.expiration_date : null) })).filter(coi => coi.calculated_status === "expiring" || coi.calculated_status === "expired" || coi.calculated_status === "review");
      return json({ counts: { emailImports: imports.results.length, duplicateReviews: duplicates.results.length, incompleteContacts: incompleteContacts.length, cois: attentionCois.length }, emailImports: imports.results, duplicateReviews: duplicates.results, incompleteContacts, cois: attentionCois });
    }
    const duplicateReviewMatch = path.match(/^\/contact-system\/duplicate-reviews\/([^/]+)$/);
    if (duplicateReviewMatch && request.method === "PATCH") {
      const input = await request.json<Partial<DuplicateReviewUpdateInput>>();
      if (input.status !== "not_duplicate") return json({ error: "Only not_duplicate can be resolved here; contact merges require a separate reviewed workflow" }, 400);
      const review = await env.DB.prepare("SELECT id FROM ssx_contact_duplicate_reviews WHERE id=?").bind(duplicateReviewMatch[1]).first();
      if (!review) return json({ error: "Not found" }, 404);
      await env.DB.prepare("UPDATE ssx_contact_duplicate_reviews SET status='not_duplicate',resolved_at=? WHERE id=?").bind(new Date().toISOString(),duplicateReviewMatch[1]).run();
      return json(await env.DB.prepare("SELECT * FROM ssx_contact_duplicate_reviews WHERE id=?").bind(duplicateReviewMatch[1]).first());
    }
    if (path === "/contact-system/companies" && request.method === "GET") {
      return json({ companies: (await env.DB.prepare("SELECT id,name,website,phone,emr_rating,emr_effective_date,updated_at FROM ssx_companies ORDER BY name LIMIT 200").all()).results });
    }
    if (path === "/contact-system/companies" && request.method === "POST") {
      try { return json(await saveCompany(env, null, await request.json<CompanyInput>()), 201); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid company" }, 400); }
    }
    const companyMatch = path.match(/^\/contact-system\/companies\/([^/]+)$/);
    if (companyMatch && request.method === "GET") {
      const company = await env.DB.prepare("SELECT * FROM ssx_companies WHERE id=?").bind(companyMatch[1]).first();
      return company ? json(company) : json({ error: "Not found" }, 404);
    }
    if (companyMatch && request.method === "PATCH") {
      try { return json(await saveCompany(env, companyMatch[1], await request.json<CompanyInput>())); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid company" }, 400); }
    }
    if (path === "/contact-system/contacts" && request.method === "GET") {
      const q = url.searchParams.get("q")?.trim();
      const stmt = q ? env.DB.prepare("SELECT id,display_name,primary_email,primary_phone,title,status FROM ssx_contacts WHERE display_name LIKE ? OR primary_email LIKE ? ORDER BY display_name LIMIT 100").bind(`%${q}%`,`%${q}%`) : env.DB.prepare("SELECT id,display_name,primary_email,primary_phone,title,status FROM ssx_contacts ORDER BY display_name LIMIT 100");
      return json({ contacts:(await stmt.all()).results });
    }
    if (path === "/contact-system/contacts" && request.method === "POST") return json({ error: "Contacts are created only from imported Outlook emails" }, 405);
    const contactMatch = path.match(/^\/contact-system\/contacts\/([^/]+)$/);
    if (contactMatch && request.method === "GET") { const result = await getContact(env,contactMatch[1]); return result ? json(result) : json({error:"Not found"},404); }
    if (contactMatch && request.method === "PATCH") {
      const updates = await request.json<ContactUpdateInput>(); const current = await env.DB.prepare("SELECT * FROM ssx_contacts WHERE id=?").bind(contactMatch[1]).first<any>();
      if (!current) return json({error:"Not found"},404);
      const changed = ["displayName","firstName","lastName","email","phone","title","companyId"].some(key => updates[key as keyof ContactInput] !== undefined);
      if (changed && (!updates.sourceEmailId || !updates.sourceLocation?.trim())) return json({ error: "Contact facts require sourceEmailId and sourceLocation from an imported Outlook email" }, 400);
      if (changed) {
        const sourceEmail = await env.DB.prepare("SELECT id FROM ssx_contact_emails WHERE id=? AND contact_id=?").bind(updates.sourceEmailId,contactMatch[1]).first();
        if (!sourceEmail) return json({ error: "sourceEmailId must belong to this contact" }, 400);
      }
      const next = { displayName: updates.displayName ?? current.display_name, firstName: updates.firstName ?? current.first_name, lastName: updates.lastName ?? current.last_name, email: updates.email ?? current.primary_email, phone: updates.phone ?? current.primary_phone, title: updates.title ?? current.title, companyId: updates.companyId ?? current.company_id };
      await env.DB.prepare("UPDATE ssx_contacts SET company_id=?,first_name=?,last_name=?,display_name=?,normalized_name=?,primary_email=?,primary_phone=?,title=?,updated_at=? WHERE id=?").bind(next.companyId,next.firstName,next.lastName,next.displayName,normalize(next.displayName),next.email?.toLowerCase() || null,next.phone,next.title,new Date().toISOString(),contactMatch[1]).run();
      if (changed) for (const [field,value] of Object.entries({ display_name: updates.displayName, first_name: updates.firstName, last_name: updates.lastName, primary_email: updates.email, primary_phone: updates.phone, title: updates.title, company_id: updates.companyId })) if (value !== undefined) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactMatch[1],updates.sourceEmailId,field,value === null ? null : String(value),updates.sourceLocation!.trim()).run();
      return json(await getContact(env,contactMatch[1]));
    }
    const contactProjectsMatch = path.match(/^\/contact-system\/contacts\/([^/]+)\/projects$/);
    if (contactProjectsMatch && request.method === "POST") {
      try { return json(await linkProject(env, contactProjectsMatch[1], await request.json<ProjectLinkInput>()), 201); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid project link" }, 400); }
    }
    const contactCoisMatch = path.match(/^\/contact-system\/contacts\/([^/]+)\/cois$/);
    if (contactCoisMatch && request.method === "POST") {
      try { return json(await registerCoi(env, contactCoisMatch[1], await request.json<CoiInput>()), 201); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid COI" }, 400); }
    }
    const taskMatch = path.match(/^\/contact-system\/tasks\/([^/]+)$/);
    if (taskMatch && request.method === "PATCH") {
      const input = await request.json<Partial<TaskUpdateInput>>();
      if (!input.status || !["open", "completed", "dismissed"].includes(input.status)) return json({ error: "status must be open, completed, or dismissed" }, 400);
      const existing = await env.DB.prepare("SELECT id FROM ssx_contact_tasks WHERE id=?").bind(taskMatch[1]).first();
      if (!existing) return json({ error: "Not found" }, 404);
      const completedAt = input.status === "completed" ? new Date().toISOString() : null;
      await env.DB.prepare("UPDATE ssx_contact_tasks SET status=?,completed_at=? WHERE id=?").bind(input.status,completedAt,taskMatch[1]).run();
      return json(await env.DB.prepare("SELECT * FROM ssx_contact_tasks WHERE id=?").bind(taskMatch[1]).first());
    }
    const photoMatch = path.match(/^\/contact-system\/contacts\/([^/]+)\/photo$/);
    if (photoMatch && request.method === "POST") {
      const contact = await env.DB.prepare("SELECT id FROM ssx_contacts WHERE id=?").bind(photoMatch[1]).first();
      if (!contact) return json({ error: "Not found" }, 404);
      const contentType = request.headers.get("Content-Type")?.split(";")[0] || "";
      const extension = ({ "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp" } as Record<string,string>)[contentType];
      if (!extension) return json({ error: "Only JPEG, PNG, or WebP photos are accepted" }, 415);
      const bytes = await request.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) return json({ error: "Photo must be between 1 byte and 5 MB" }, 413);
      const photoSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2,"0")).join("");
      const photoKey = `contacts/${photoMatch[1]}/photos/${photoSha}.${extension}`;
      await env.CONTACT_FILES.put(photoKey, bytes, { httpMetadata: { contentType }, customMetadata: { sha256: photoSha, contactId: photoMatch[1] } });
      await env.DB.batch([
        env.DB.prepare("UPDATE ssx_contacts SET photo_r2_key=?,updated_at=? WHERE id=?").bind(photoKey,new Date().toISOString(),photoMatch[1]),
        env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,field_name,field_value,source_location) VALUES (?,?,?,?,?)").bind(id(),photoMatch[1],"photo_r2_key",photoKey,"Manual contact-photo upload")
      ]);
      return json({ contactId: photoMatch[1], photoKey }, 201);
    }
    if (path === "/contact-system/email-imports" && request.method === "POST") return importEmail(request,env);
    const importMatch = path.match(/^\/contact-system\/email-imports\/([^/]+)$/);
    if (importMatch && request.method === "GET") { const record = await env.DB.prepare("SELECT * FROM ssx_contact_import_jobs WHERE id=?").bind(importMatch[1]).first(); return record ? json(record) : json({error:"Not found"},404); }
    const fileMatch = path.match(/^\/contact-system\/files\/([^/]+)$/);
    if (fileMatch && request.method === "GET") {
      const attachment = await env.DB.prepare("SELECT file_name,content_type,r2_key FROM ssx_contact_attachments WHERE id=?").bind(fileMatch[1]).first<{file_name:string;content_type:string|null;r2_key:string}>();
      const email = attachment ? null : await env.DB.prepare("SELECT original_file_name AS file_name,original_msg_r2_key AS r2_key FROM ssx_contact_emails WHERE id=?").bind(fileMatch[1]).first<{file_name:string;r2_key:string}>();
      const file = attachment || email;
      if (!file) return json({ error: "Not found" }, 404);
      const object = await env.CONTACT_FILES.get(file.r2_key);
      if (!object) return json({ error: "Stored file is unavailable" }, 404);
      return new Response(object.body, { headers: {
        "Content-Type": attachment?.content_type || "application/vnd.ms-outlook",
        "Content-Disposition": url.searchParams.get("inline") === "1" ? `inline; filename="${safeName(file.file_name)}"` : `attachment; filename="${safeName(file.file_name)}"`,
        "Cache-Control": "private, no-store",
        ...corsHeaders
      }});
    }
    return json({ error: "Not found" }, 404);
  }
} satisfies ExportedHandler<Env>;
