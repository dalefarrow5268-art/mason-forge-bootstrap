import MsgReader, { type FieldsData } from "@kenjiuno/msgreader";

export type ExtractedMsg = {
  senderName?: string;
  senderEmail?: string;
  subject?: string;
  bodyText?: string;
  recipients: Array<{ name?: string; email?: string; type?: string }>;
  attachments: Array<{ fileName: string; content: Uint8Array }>;
  parseError?: string;
};

const email = (value?: string) => {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
};

// A few Outlook variants can be read by the browser/Node build of msgreader but
// fail inside the Workers runtime.  The original file is still preserved, and
// these fields are plainly embedded as UTF-16 MAPI strings, so retain a narrow
// fallback for the header/body information needed to create the contact card.
function fallbackExtract(bytes: ArrayBuffer, reason: string): ExtractedMsg {
  const text = new TextDecoder("utf-16le").decode(bytes).replace(/\u0000/g, " ");
  const addresses = [...new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])]
    .map(value => value.toLowerCase())
    .filter(value => !/\.prod\.outlook\.com$/i.test(value));
  const senderEmail = addresses[0];
  if (!senderEmail) return { recipients: [], attachments: [], parseError: reason };
  const escapedEmail = senderEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const senderMatch = text.match(new RegExp(`([A-Z][a-z]+(?:\\s+[A-Z][a-z.'-]+){1,3})\\s+SMTP\\s+${escapedEmail}`, "i"));
  const subjectMatch = text.match(/IPM\.Note[\s\S]{0,300}?([\x20-\x7E]{4,180})\s+__substg/i);
  const bodyStart = text.search(/\b(?:Hello|Hi|Good morning|Good afternoon)\b/i);
  const bodyText = bodyStart >= 0 ? text.slice(bodyStart, bodyStart + 16000).replace(/__substg[\s\S]*$/, "").trim() : undefined;
  return {
    senderName: senderMatch?.[1]?.trim(),
    senderEmail,
    subject: subjectMatch?.[1]?.trim(),
    bodyText,
    recipients: addresses.slice(1).map(value => ({ email: value, type: "to" })),
    attachments: []
  };
}

function htmlToText(value?: string) {
  if (!value) return "";
  return value
    .replace(/<\/(?:p|div|tr|li|h[1-6])\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_, hex, decimal) => String.fromCharCode(parseInt(hex || decimal, hex ? 16 : 10)))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function messageBodyText(fields: FieldsData) {
  const html = fields.bodyHtml || (fields.html ? new TextDecoder().decode(fields.html) : "");
  const parts = [fields.body?.trim(), htmlToText(html)].filter(Boolean);
  return [...new Set(parts)].join("\n\n").trim() || undefined;
}

export function extractOutlookMsg(bytes: ArrayBuffer): ExtractedMsg {
  let fields: FieldsData;
  try { fields = new MsgReader(bytes).getFileData(); }
  catch (error) { return fallbackExtract(bytes, error instanceof Error ? error.message : "Unable to parse Outlook message"); }
  if (fields.error) return fallbackExtract(bytes, fields.error);
  return {
    senderName: fields.senderName?.trim() || undefined,
    senderEmail: email(fields.senderEmail),
    subject: fields.subject?.trim() || undefined,
    bodyText: messageBodyText(fields),
    recipients: (fields.recipients || []).map(recipient => ({ name: recipient.name?.trim() || undefined, email: email(recipient.email), type: recipient.recipType })).filter(recipient => recipient.name || recipient.email),
    // Only true Outlook attachment objects are retained. Scanning arbitrary
    // .msg bytes for image signatures created false image attachments.
    attachments: (fields.attachments || []).flatMap((attachment, index) => {
      try {
        const data = new MsgReader(bytes).getAttachment(attachment);
        return data.content ? [{ fileName: data.fileName || `outlook-attachment-${index + 1}`, content: data.content }] : [];
      } catch { return []; }
    })
  };
}
