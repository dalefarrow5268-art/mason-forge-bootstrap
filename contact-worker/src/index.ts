import { extractOutlookMsg } from "./msg-extractor";

export interface Env {
  DB: D1Database;
  CONTACT_FILES: R2Bucket;
  CONTACT_SYSTEM_TOKEN: string;
}

type ContactInput = { displayName: string; firstName?: string; lastName?: string; email?: string; phone?: string; title?: string; companyId?: string };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160);

function authorized(request: Request, env: Env) {
  return Boolean(env.CONTACT_SYSTEM_TOKEN) && request.headers.get("Authorization") === `Bearer ${env.CONTACT_SYSTEM_TOKEN}`;
}
function requireAuth(request: Request, env: Env) { return authorized(request, env) ? null : json({ error: "Unauthorized" }, 401); }

async function getContact(env: Env, contactId: string) {
  const contact = await env.DB.prepare(`SELECT c.*, co.name AS company_name FROM ssx_contacts c LEFT JOIN ssx_companies co ON co.id=c.company_id WHERE c.id=?`).bind(contactId).first();
  if (!contact) return null;
  const [emails, tasks, projects, evidence] = await env.DB.batch([
    env.DB.prepare("SELECT id, subject, sender_name, sender_email, received_at, extraction_status FROM ssx_contact_emails WHERE contact_id=? ORDER BY received_at DESC").bind(contactId),
    env.DB.prepare("SELECT * FROM ssx_contact_tasks WHERE contact_id=? ORDER BY created_at DESC").bind(contactId),
    env.DB.prepare("SELECT * FROM ssx_contact_projects WHERE contact_id=? ORDER BY is_current DESC, linked_at DESC").bind(contactId),
    env.DB.prepare("SELECT field_name, field_value, source_location FROM ssx_contact_evidence WHERE contact_id=? ORDER BY created_at DESC").bind(contactId)
  ]);
  return { contact, emails: emails.results, tasks: tasks.results, projects: projects.results, evidence: evidence.results };
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
  await env.DB.prepare(`INSERT INTO ssx_contacts (id,company_id,first_name,last_name,display_name,normalized_name,primary_email,primary_phone,title,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(contactId,input.companyId || null,input.firstName || null,input.lastName || null,input.displayName.trim(),normalize(input.displayName),email,input.phone || null,input.title || null,now,now).run();
  for (const [field, value] of Object.entries({ display_name: input.displayName, primary_email: email, primary_phone: input.phone, title: input.title })) {
    if (value) await env.DB.prepare("INSERT INTO ssx_contact_evidence (id,contact_id,field_name,field_value,source_location) VALUES (?,?,?,?,?)").bind(id(),contactId,field,String(value),source).run();
  }
  return { id: contactId, created: true };
}

function requestedAction(subject?: string, body?: string) {
  const source = `${subject || ""}\n${body || ""}`.trim();
  if (!source || !/\b(please|could you|can you|need you to|let me know|reply|send|provide|review|confirm)\b/i.test(source)) return null;
  return source.replace(/\s+/g, " ").slice(0, 800);
}

async function importEmail(request: Request, env: Env) {
  const fileName = safeName(request.headers.get("X-SSX-File-Name") || "email.msg");
  const sha = (request.headers.get("X-SSX-SHA256") || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) return json({ error: "A valid X-SSX-SHA256 header is required" }, 400);
  if (!fileName.toLowerCase().endsWith(".msg")) return json({ error: "Only .msg files are accepted" }, 415);
  const duplicate = await env.DB.prepare("SELECT id, contact_id, status FROM ssx_contact_import_jobs WHERE original_sha256=?").bind(sha).first();
  if (duplicate) return json({ duplicate: true, import: duplicate }, 409);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) return json({ error: "Email must be between 1 byte and 50 MB" }, 413);
  const computed = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(v => v.toString(16).padStart(2,"0")).join("");
  if (computed !== sha) return json({ error: "SHA-256 does not match uploaded bytes" }, 400);
  const importId = id(); const now = new Date().toISOString();
  const extracted = extractOutlookMsg(bytes);
  let contactId: string | null = null;
  if (!extracted.parseError && extracted.senderEmail) {
    const exact = await env.DB.prepare("SELECT id FROM ssx_contacts WHERE primary_email=?").bind(extracted.senderEmail).first<{id:string}>();
    if (exact) contactId = exact.id;
    else if (extracted.senderName) contactId = (await createContact(env, { displayName: extracted.senderName, email: extracted.senderEmail }, "Outlook .msg sender header")).id;
  }
  const objectKey = `contacts/${contactId || "unassigned"}/emails/${sha}/${fileName}`;
  await env.CONTACT_FILES.put(objectKey, bytes, { httpMetadata: { contentType: "application/vnd.ms-outlook" }, customMetadata: { sha256: sha, importId } });
  const emailId = id(); const status = extracted.parseError ? "review" : (contactId ? "completed" : "review");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ssx_contact_import_jobs (id,original_file_name,original_sha256,status,contact_id,email_id,error_message,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(importId,fileName,sha,status,contactId,emailId,extracted.parseError || null,now,now),
    env.DB.prepare("INSERT INTO ssx_contact_emails (id,contact_id,direction,sender_name,sender_email,recipients_json,subject,received_at,body_text,original_msg_r2_key,original_file_name,original_sha256,original_size_bytes,extraction_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(emailId,contactId,"received",extracted.senderName || null,extracted.senderEmail || null,JSON.stringify(extracted.recipients),extracted.subject || null,now,extracted.bodyText || null,objectKey,fileName,sha,bytes.byteLength,extracted.parseError ? "review" : "extracted",now)
  ]);
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
  return json({ id: importId, contactId, emailId, status, duplicate: false, message: extracted.parseError ? "Original .msg stored privately; parser needs review." : "Original .msg stored and source-supported contact facts recorded." }, 201);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/contact-system/health" && request.method === "GET") return json({ system:"SSX Contact System", storage:"Cloudflare D1 + private R2", mode:"source-only", aiEnrichment:false, ready:true, timestamp:new Date().toISOString() });
    const authError = requireAuth(request, env); if (authError) return authError;
    if (path === "/contact-system/contacts" && request.method === "GET") {
      const q = url.searchParams.get("q")?.trim();
      const stmt = q ? env.DB.prepare("SELECT id,display_name,primary_email,primary_phone,title,status FROM ssx_contacts WHERE display_name LIKE ? OR primary_email LIKE ? ORDER BY display_name LIMIT 100").bind(`%${q}%`,`%${q}%`) : env.DB.prepare("SELECT id,display_name,primary_email,primary_phone,title,status FROM ssx_contacts ORDER BY display_name LIMIT 100");
      return json({ contacts:(await stmt.all()).results });
    }
    if (path === "/contact-system/contacts" && request.method === "POST") {
      try { return json(await createContact(env, await request.json<ContactInput>()), 201); } catch (error) { return json({ error: error instanceof Error ? error.message : "Invalid contact" },400); }
    }
    const contactMatch = path.match(/^\/contact-system\/contacts\/([^/]+)$/);
    if (contactMatch && request.method === "GET") { const result = await getContact(env,contactMatch[1]); return result ? json(result) : json({error:"Not found"},404); }
    if (contactMatch && request.method === "PATCH") {
      const updates = await request.json<Partial<ContactInput>>(); const current = await env.DB.prepare("SELECT * FROM ssx_contacts WHERE id=?").bind(contactMatch[1]).first<any>();
      if (!current) return json({error:"Not found"},404);
      const next = { displayName: updates.displayName ?? current.display_name, firstName: updates.firstName ?? current.first_name, lastName: updates.lastName ?? current.last_name, email: updates.email ?? current.primary_email, phone: updates.phone ?? current.primary_phone, title: updates.title ?? current.title, companyId: updates.companyId ?? current.company_id };
      await env.DB.prepare("UPDATE ssx_contacts SET company_id=?,first_name=?,last_name=?,display_name=?,normalized_name=?,primary_email=?,primary_phone=?,title=?,updated_at=? WHERE id=?").bind(next.companyId,next.firstName,next.lastName,next.displayName,normalize(next.displayName),next.email?.toLowerCase() || null,next.phone,next.title,new Date().toISOString(),contactMatch[1]).run();
      return json(await getContact(env,contactMatch[1]));
    }
    if (path === "/contact-system/email-imports" && request.method === "POST") return importEmail(request,env);
    const importMatch = path.match(/^\/contact-system\/email-imports\/([^/]+)$/);
    if (importMatch && request.method === "GET") { const record = await env.DB.prepare("SELECT * FROM ssx_contact_import_jobs WHERE id=?").bind(importMatch[1]).first(); return record ? json(record) : json({error:"Not found"},404); }
    return json({ error: "Not found" }, 404);
  }
} satisfies ExportedHandler<Env>;
