-- COI tracking remains source-only: the original certificate stays in private R2
-- as an attachment of the imported Outlook email.
CREATE TABLE IF NOT EXISTS ssx_contact_cois (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES ssx_contacts(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL REFERENCES ssx_contact_emails(id) ON DELETE RESTRICT,
  attachment_id TEXT NOT NULL REFERENCES ssx_contact_attachments(id) ON DELETE RESTRICT,
  insurer_name TEXT,
  policy_number TEXT,
  effective_date TEXT,
  expiration_date TEXT,
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('current','expiring','expired','review')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attachment_id)
);
CREATE INDEX IF NOT EXISTS ssx_contact_cois_contact_idx ON ssx_contact_cois(contact_id, expiration_date);
