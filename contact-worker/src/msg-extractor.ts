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
    attachments: embeddedImages(bytes)
  };
}

function embeddedImages(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  const images: Array<{ fileName: string; content: Uint8Array }> = [];
  const push = (extension: string, start: number, end: number) => {
    if (end <= start || end - start > 3 * 1024 * 1024 || images.length >= 4) return;
    images.push({ fileName: `outlook-embedded-image-${images.length + 1}.${extension}`, content: data.slice(start, end) });
  };
  for (let i = 0; i < data.length - 12 && images.length < 4; i++) {
    // PNG: signature through IEND chunk.
    if (data[i]===137 && data[i+1]===80 && data[i+2]===78 && data[i+3]===71 && data[i+4]===13 && data[i+5]===10 && data[i+6]===26 && data[i+7]===10) {
      for (let j=i+8; j < Math.min(data.length - 8, i + 3 * 1024 * 1024); j++) if (data[j]===73 && data[j+1]===69 && data[j+2]===78 && data[j+3]===68 && data[j+4]===174 && data[j+5]===66 && data[j+6]===96 && data[j+7]===130) { push("png", i, j + 8); i = j + 7; break; }
    }
    // JPEG: start through EOI marker.
    else if (data[i]===255 && data[i+1]===216 && data[i+2]===255) {
      for (let j=i+3; j < Math.min(data.length - 1, i + 3 * 1024 * 1024); j++) if (data[j]===255 && data[j+1]===217) { push("jpg", i, j + 2); i = j + 1; break; }
    }
    // GIF: header through trailer byte.
    else if (data[i]===71 && data[i+1]===73 && data[i+2]===70 && data[i+3]===56 && (data[i+4]===55 || data[i+4]===57) && data[i+5]===97) {
      for (let j=i+13; j < Math.min(data.length, i + 3 * 1024 * 1024); j++) if (data[j]===59) { push("gif", i, j + 1); i = j; break; }
    }
  }
  return images;
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
    bodyText: fields.body?.trim() || undefined,
    recipients: (fields.recipients || []).map(recipient => ({ name: recipient.name?.trim() || undefined, email: email(recipient.email), type: recipient.recipType })).filter(recipient => recipient.name || recipient.email)
    ,attachments: (() => {
      const normal = (fields.attachments || []).flatMap((attachment, index) => {
        try {
          const data = new MsgReader(bytes).getAttachment(attachment);
          return data.content ? [{ fileName: data.fileName || `outlook-inline-${index + 1}`, content: data.content }] : [];
        } catch { return []; }
      });
      const seen = new Set(normal.map(item => Array.from(item.content.slice(0, 24)).join(",")));
      return [...normal, ...embeddedImages(bytes).filter(item => {
        const key = Array.from(item.content.slice(0, 24)).join(",");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })];
    })()
  };
}
