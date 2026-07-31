import { extractOutlookMsg } from "./msg-extractor";

export interface Env {
  DB: D1Database;
  CONTACT_FILES: R2Bucket;
  CONTACT_SYSTEM_TOKEN: string;
}

type ContactInput = { displayName: string; firstName?: string; lastName?: string; email?: string; phone?: string; title?: string; companyId?: string };
type ContactUpdateInput = Partial<ContactInput> & { sourceEmailId?: string; sourceLocation?: string };
type CompanyInput = { name?: string; website?: string | null; phone?: string | null; emrRating?: number | null; emrEffectiveDate?: string | null; sourceContactId?: string; sourceEmailId?: string; sourceLocation?: string };
type ProjectLinkInput = { projectName: string; projectId?: number | null; projectRole?: string | null; isCurrent?: boolean; sourceEmailId: string; sourceLocation: string };
type TaskUpdateInput = { status: "open" | "completed" | "dismissed" };
type CoiInput = { attachmentId: string; insurerName?: string | null; policyNumber?: string | null; effectiveDate?: string | null; expirationDate?: string | null; notes?: string | null; sourceLocation: string };
type DuplicateReviewUpdateInput = { status: "not_duplicate" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,X-SSX-File-Name,X-SSX-SHA256",
  "Access-Control-Max-Age": "86400"
};
const noStoreHeaders = { "Cache-Control": "no-store", ...corsHeaders };
const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers: { ...noStoreHeaders, ...headers } });
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160);
const decodeFileHeader = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
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
  const fields = [
    ["Contact name", record.display_name], ["Email", record.primary_email], ["Phone", record.primary_phone],
    ["Title", record.title], ["Company", record.company_name], ["Company website", record.company_website],
    ["EMR rating", record.company_emr_rating], ["Contact photo", record.photo_r2_key]
  ] as const;
  const present = fields.filter(([, value]) => value !== null && value !== undefined && value !== "").length;
  return { score: Math.round((present / fields.length) * 100), complete: present === fields.length, missing: fields.filter(([, value]) => value === null || value === undefined || value === "").map(([name]) => name) };
}

async function getContact(env: Env, contactId: string) {
  const contact = await env.DB.prepare(`SELECT c.*, co.name AS company_name, co.website AS company_website, co.emr_rating AS company_emr_rating, co.emr_effective_date AS company_emr_effective_date FROM ssx_contacts c LEFT JOIN ssx_companies co ON co.id=c.company_id WHERE c.id=?`).bind(contactId).first();
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
  const hasSourcedFact = input.website !== undefined || input.phone !== undefined || input.emrRating !== undefined || input.emrEffectiveDate !== undefined;
  if (hasSourcedFact && (!input.sourceContactId || !input.sourceEmailId || !input.sourceLocation?.trim())) throw new Error("Company facts require sourceContactId, sourceEmailId, and sourceLocation from an imported Outlook email");
  if (input.emrRating !== undefined && input.emrRating !== null && (!Number.isFinite(input.emrRating) || input.emrRating < 0 || input.emrRating > 100)) throw new Error("emrRating must be between 0 and 100");
  const now = new Date().toISOString();
  let record = companyId ? await env.DB.prepare("SELECT * FROM ssx_companies WHERE id=?").bind(companyId).first<any>() : null;
  if (!record) {
    if (!input.name?.trim()) throw new Error("name is required for a new company");
    const existing = await env.DB.prepare("SELECT * FROM ssx_companies WHERE normalized_name=?").bind(normalize(input.name)).first<any>();
    if (existing) record = existing;
    else {
      record = { id: id(), name: input.name.trim(), normalized_name: normalize(input.name), website: null, phone: null, emr_rating: null, emr_effective_date: null };
      await env.DB.prepare("INSERT INTO ssx_companies (id,name,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(record.id,record.name,record.normalized_name,now,now).run();
    }
  }
  const next = { name: input.name?.trim() ?? record.name, website: input.website === undefined ? record.website : cleanWebsite(input.website), phone: input.phone === undefined ? record.phone : input.phone?.trim() || null, emrRating: input.emrRating === undefined ? record.emr_rating : input.emrRating, emrEffectiveDate: input.emrEffectiveDate === undefined ? record.emr_effective_date : input.emrEffectiveDate || null };
  await env.DB.prepare("UPDATE ssx_companies SET name=?,normalized_name=?,website=?,phone=?,emr_rating=?,emr_effective_date=?,updated_at=? WHERE id=?").bind(next.name,normalize(next.name),next.website,next.phone,next.emrRating,next.emrEffectiveDate,now,record.id).run();
  if (hasSourcedFact) for (const [field, value] of Object.entries({ company_name: input.name, company_website: input.website, company_phone: input.phone, emr_rating: input.emrRating, emr_effective_date: input.emrEffectiveDate })) if (value !== undefined) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),input.sourceContactId,input.sourceEmailId,field,value === null ? null : String(value),input.sourceLocation!.trim()).run();
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
  if (existing) await env.DB.prepare("UPDATE ssx_contact_projects SET project_role=?,is_current=?,linked_at=? WHERE id=?").bind(input.projectRole?.trim() || null,input.isCurrent === false ? 0 : 1,now,linkId).run();
  else await env.DB.prepare("INSERT INTO ssx_contact_projects (id,contact_id,project_id,project_name,project_role,is_current,linked_at) VALUES (?,?,?,?,?,?,?)").bind(linkId,contactId,projectId,input.projectName.trim(),input.projectRole?.trim() || null,input.isCurrent === false ? 0 : 1,now).run();
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

async function importEmail(request: Request, env: Env) {
  const fileName = safeName(decodeFileHeader(request.headers.get("X-SSX-File-Name") || "email.msg"));
  const sha = (request.headers.get("X-SSX-SHA256") || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) return json({ error: "A valid X-SSX-SHA256 header is required" }, 400);
  if (!fileName.toLowerCase().endsWith(".msg")) return json({ error: "Only .msg files are accepted" }, 415);
  const duplicate = await env.DB.prepare("SELECT id, contact_id, email_id, status FROM ssx_contact_import_jobs WHERE original_sha256=?").bind(sha).first<{id:string;contact_id:string|null;email_id:string|null;status:string}>();
  const existingEmail = duplicate ? await env.DB.prepare("SELECT id FROM ssx_contact_emails WHERE original_sha256=?").bind(sha).first<{id:string}>() : null;
  const retryingReview = Boolean(duplicate && duplicate.status === "review" && !duplicate.contact_id && existingEmail);
  if (duplicate && !retryingReview) return json({ duplicate: true, import: duplicate }, 409, await sessionHeaders(request, env));
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) return json({ error: "Email must be between 1 byte and 50 MB" }, 413);
  const computed = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2,"0")).join("");
  if (computed !== sha) return json({ error: "SHA-256 does not match uploaded bytes" }, 400);
  const importId = duplicate?.id || id(); const now = new Date().toISOString();
  const extracted = extractOutlookMsg(bytes);
  let contactId: string | null = null;
  if (!extracted.parseError && extracted.senderEmail) {
    const exact = await env.DB.prepare("SELECT id FROM ssx_contacts WHERE primary_email=?").bind(extracted.senderEmail).first<{id:string}>();
    if (exact) contactId = exact.id;
    else if (extracted.senderName) contactId = (await createContact(env, { displayName: extracted.senderName, email: extracted.senderEmail }, "Outlook .msg sender header")).id;
  }
  const objectKey = `contacts/${contactId || "unassigned"}/emails/${sha}/${fileName}`;
  await env.CONTACT_FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/vnd.ms-outlook" }, customMetadata: { sha256: sha, importId } });
  const emailId = existingEmail?.id || id(); const status = extracted.parseError ? "review" : (contactId ? "completed" : "review");
  if (retryingReview) {
    await env.DB.prepare("UPDATE ssx_contact_emails SET contact_id=?,sender_name=?,sender_email=?,recipients_json=?,subject=?,body_text=?,extraction_status=? WHERE id=?").bind(contactId,extracted.senderName || null,extracted.senderEmail || null,JSON.stringify(extracted.recipients),extracted.subject || null,extracted.bodyText || null,extracted.parseError ? "review" : "extracted",emailId).run();
    await env.DB.prepare("UPDATE ssx_contact_import_jobs SET status=?,contact_id=?,error_message=?,updated_at=? WHERE id=?").bind(status,contactId,extracted.parseError || null,now,importId).run();
  } else {
    await env.DB.prepare("INSERT INTO ssx_contact_emails (id,contact_id,direction,sender_name,sender_email,recipients_json,subject,received_at,body_text,original_msg_r2_key,original_file_name,original_sha256,original_size_bytes,extraction_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(emailId,contactId,"received",extracted.senderName || null,extracted.senderEmail || null,JSON.stringify(extracted.recipients),extracted.subject || null,now,extracted.bodyText || null,objectKey,fileName,sha,bytes.byteLength,extracted.parseError ? "review" : "extracted",now).run();
    await env.DB.prepare("INSERT INTO ssx_contact_import_jobs (id,original_file_name,original_sha256,status,contact_id,email_id,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(importId,fileName,sha,status,contactId,emailId,extracted.parseError || null,now,now).run();
  }
  const action = requestedAction(extracted.subject, extracted.bodyText);
  if (contactId && action) {
    const taskTitle = `Review email action request${extracted.subject ? `: ${extracted.subject.slice(0, 180)}` : ""}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO ssx_contact_tasks (id,contact_id,email_id,title,description,priority,status) VALUES (?,?,?,?,?,'normal','open')").bind(id(),contactId,emailId,taskTitle,action),
      env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,emailId,"action_request",action,"Outlook .msg subject/body")
    ]);
  }
  for (const attachment of extracted.attachments) {
    const attachmentName = safeName(attachment.fileName || "attachment.bin");
    const attachmentSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", attachment.content))).map(v => v.toString(16).padStart(2,"0")).join("");
    const attachmentKey = `contacts/${contactId || "unassigned"}/attachments/${attachmentSha}/${attachmentName}`;
    await env.CONTACT_FILES.put(attachmentKey, attachment.content, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: { sha256: attachmentSha, emailId } });
    await env.DB.prepare("INSERT INTO ssx_contact_attachments (id,email_id,file_name,content_type,r2_key,sha256,size_bytes) VALUES (?,?,?,?,?,?,?)").bind(id(),emailId,attachmentName,"application/octet-stream",attachmentKey,attachmentSha,attachment.content.byteLength).run();
  }
  if (contactId) for (const [field,value] of Object.entries({ sender_name: extracted.senderName, sender_email: extracted.senderEmail, subject: extracted.subject })) if (value) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,email_id,field_name,field_value,source_location) VALUES (?,?,?,?,?,?)").bind(id(),contactId,emailId,field,value,"Outlook .msg header").run();
  const projectName = contactId ? projectFromEmail(extracted.subject, fileName, extracted.bodyText) : null;
  const project = contactId && projectName ? await linkProject(env, contactId, { projectName, projectRole: "Email correspondence", isCurrent: true, sourceEmailId: emailId, sourceLocation: "Outlook .msg subject/body" }) : null;
  const contact = contactId ? await env.DB.prepare("SELECT id,display_name,primary_email,primary_phone FROM ssx_contacts WHERE id=?").bind(contactId).first() : null;
  return json({ id: importId, contactId, emailId, status, duplicate: false, retried: retryingReview, completion: { emailStored: true, contact, project, daleTodoCreated: Boolean(action) }, message: extracted.parseError ? "Original .msg stored privately; parser needs review." : "Original .msg stored and source-supported contact facts recorded." }, retryingReview ? 200 : 201, await sessionHeaders(request, env));
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
    <section id="cardWindow" class="card">
      <div class="cardTop"><h2>Saved Contact Card</h2><span class="badge">READY FOR EMAIL</span></div>
      <div class="cardColumns">
        <div class="cardGroup"><b>CONTACT IDENTITY</b><div class="blankLine">Name will appear here</div><div class="blankLine">Company</div><div class="blankLine">Email</div><div class="blankLine">Phone</div></div>
        <div class="cardGroup"><b>PROJECT &amp; ACTIONS</b><div class="blankLine">Project link</div><div class="blankLine">Dale To Do</div><div class="blankLine">Source email stored</div></div>
        <div class="cardGroup"><b>COMPANY PROFILE</b><div class="blankLine">Website</div><div class="blankLine">EMR Rating</div><div class="blankLine">Company risk / notes</div></div>
        <div class="cardGroup"><b>EMAIL &amp; EVIDENCE</b><div class="blankLine">Original .msg file</div><div class="blankLine">Attachments</div><div class="blankLine">Source-backed facts</div></div>
      </div>
    </section>
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
      fileLabel.textContent = file.name + ' uploading…';
      setTimeout(() => upload.click(), 0);
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
      if (!contactId) return;
      $('cardWindow').innerHTML = '<iframe class="cardPreview" title="Saved SSX Contact Card" src="/contact-system/contact-card-preview/' + encodeURIComponent(contactId) + '"></iframe>';
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
            'X-SSX-SHA256': sha
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
    if (path === "/contact-system/health" && request.method === "GET") return json({ system:"SSX Contact System", storage:"Cloudflare D1 + private R2", mode:"source-only", aiEnrichment:false, importRetry:"sha-email-lookup-v2", ready:true, timestamp:new Date().toISOString() });
    if (path === "/contact-system/login" && request.method === "GET") return loginPage();
    if (path === "/contact-system/session" && request.method === "POST") return request.headers.get("Authorization") === "Bearer " + env.CONTACT_SYSTEM_TOKEN ? json({ signedIn: true }, 200, await sessionHeaders(request, env)) : json({ signedIn: false }, 401);
    if (path === "/contact-system/session" && request.method === "GET") return await authorized(request, env) ? json({ signedIn: true }) : json({ signedIn: false }, 401);
    if (path === "/contact-system/upload" && request.method === "GET") return await authorized(request, env) ? uploadPage() : loginPage();
    if (path === "/contact-system/dale-todos" && request.method === "GET") return await authorized(request, env) ? daleTodoPage() : loginPage();
    const authError = await requireAuth(request, env); if (authError) return authError;
    const cardPreviewMatch = path.match(/^\/contact-system\/contact-card-preview\/([^/]+)$/);
    if (cardPreviewMatch && request.method === "GET") {
      const detail = await getContact(env, cardPreviewMatch[1]);
      if (!detail) return json({ error: "Contact not found" }, 404);
      try {
        const template = await fetch(masterContactCardTemplateUrl);
        if (!template.ok) throw new Error("Approved card template could not be loaded");
        let page = await template.text();
        const contact = detail.contact as Record<string, unknown>;
        const projects = detail.projects as Array<Record<string, unknown>>;
        const tasks = detail.tasks as Array<Record<string, unknown>>;
        const emails = detail.emails as Array<Record<string, unknown>>;
        const firstProject = projects[0]?.project_name || "Project review needed";
        const firstTask = tasks[0]?.title || "No Dale action found";
        const latestSubject = emails[0]?.subject || emails[0]?.original_file_name || "Stored Outlook source email";
        const values: Array<[string, unknown]> = [
          ["Avery Walsh", contact.display_name], ["Northstar Climate Systems", contact.company_name],
          ["avery.walsh@example.com", contact.primary_email], ["northstar.example", contact.company_website],
          ["Demo Contact Record", contact.primary_phone], ["Mechanical Supplier / Vendor", contact.title],
          ["Autograph by Marriott — Jericho, NY", firstProject], ["Re: Demo project inquiry", latestSubject],
          ["RE: Equipment information request", latestSubject], ["SCHEDULE MEETING", firstTask],
          ["REQUEST REFRIGERATOR SIZES", firstTask]
        ];
        for (const [from, to] of values) page = page.split(from).join(escapeCardHtml(to));
        page = page.replace("</head>", "<style>body{zoom:.72!important;width:138.89%!important;overflow:hidden!important}</style></head>");
        return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
      } catch (error) {
        return json({ error: "Contact card preview failed", detail: error instanceof Error ? error.message : String(error) }, 502);
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
        "Content-Disposition": `attachment; filename="${safeName(file.file_name)}"`,
        "Cache-Control": "private, no-store",
        ...corsHeaders
      }});
    }
    return json({ error: "Not found" }, 404);
  }
} satisfies ExportedHandler<Env>;
