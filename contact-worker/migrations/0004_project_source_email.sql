-- A project link must be traceable to the exact Outlook email that created it.
ALTER TABLE ssx_contact_projects ADD COLUMN source_email_id TEXT REFERENCES ssx_contact_emails(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ssx_contact_projects_source_email_idx ON ssx_contact_projects(source_email_id);
