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

export function extractOutlookMsg(bytes: ArrayBuffer): ExtractedMsg {
  let fields: FieldsData;
  try { fields = new MsgReader(bytes).getFileData(); }
  catch (error) { return { recipients: [], attachments: [], parseError: error instanceof Error ? error.message : "Unable to parse Outlook message" }; }
  if (fields.error) return { recipients: [], attachments: [], parseError: fields.error };
  return {
    senderName: fields.senderName?.trim() || undefined,
    senderEmail: email(fields.senderEmail),
    subject: fields.subject?.trim() || undefined,
    bodyText: fields.body?.trim() || undefined,
    recipients: (fields.recipients || []).map(recipient => ({ name: recipient.name?.trim() || undefined, email: email(recipient.email), type: recipient.recipType })).filter(recipient => recipient.name || recipient.email)
    ,attachments: (fields.attachments || []).flatMap(attachment => {
      try { const data = new MsgReader(bytes).getAttachment(attachment); return data.fileName && data.content ? [{ fileName: data.fileName, content: data.content }] : []; }
      catch { return []; }
    })
  };
}
