-- SSX Contact System v1 for Cloudflare D1 (SQLite).
-- This migration is additive. It must be applied to the existing Mason Forge D1
-- database; it does not alter project-system tables.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ssx_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  website TEXT,
  phone TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  logo_r2_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ssx_contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES ssx_companies(id) ON DELETE SET NULL,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  primary_email TEXT UNIQUE COLLATE NOCASE,
  primary_phone TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','review')),
  photo_r2_key TEXT,
  source_confidence REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ssx_contacts_company_idx ON ssx_contacts(company_id);
CREATE INDEX IF NOT EXISTS ssx_contacts_name_idx ON ssx_contacts(normalized_name);

CREATE TABLE IF NOT EXISTS ssx_contact_emails (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES ssx_contacts(id) ON DELETE SET NULL,
  company_id TEXT REFERENCES ssx_companies(id) ON DELETE SET NULL,
  internet_message_id TEXT,
  direction TEXT NOT NULL DEFAULT 'received' CHECK (direction IN ('received','sent','unknown')),
  sender_name TEXT,
  sender_email TEXT,
  recipients_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT,
  sent_at TEXT,
  received_at TEXT,
  body_text TEXT,
  body_html_r2_key TEXT,
  original_msg_r2_key TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  original_sha256 TEXT NOT NULL UNIQUE,
  original_size_bytes INTEGER NOT NULL,
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending','extracted','review','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ssx_contact_emails_contact_idx ON ssx_contact_emails(contact_id, received_at DESC);
CREATE INDEX IF NOT EXISTS ssx_contact_emails_sender_idx ON ssx_contact_emails(sender_email COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS ssx_contact_attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL REFERENCES ssx_contact_emails(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT,
  r2_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email_id, sha256)
);

CREATE TABLE IF NOT EXISTS ssx_contact_communications (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES ssx_contacts(id) ON DELETE CASCADE,
  email_id TEXT REFERENCES ssx_contact_emails(id) ON DELETE SET NULL,
  communication_type TEXT NOT NULL DEFAULT 'email',
  summary TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ssx_contact_tasks (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES ssx_contacts(id) ON DELETE CASCADE,
  email_id TEXT REFERENCES ssx_contact_emails(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','dismissed')),
  due_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ssx_contact_projects (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES ssx_contacts(id) ON DELETE CASCADE,
  project_id INTEGER,
  project_name TEXT NOT NULL,
  project_role TEXT,
  project_image_r2_key TEXT,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ssx_contact_evidence (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES ssx_contacts(id) ON DELETE CASCADE,
  email_id TEXT REFERENCES ssx_contact_emails(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value TEXT,
  source_location TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ssx_contact_duplicate_reviews (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES ssx_contacts(id) ON DELETE CASCADE,
  possible_duplicate_contact_id TEXT NOT NULL REFERENCES ssx_contacts(id) ON DELETE CASCADE,
  match_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','not_duplicate')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  UNIQUE(contact_id, possible_duplicate_contact_id)
);

CREATE TABLE IF NOT EXISTS ssx_contact_import_jobs (
  id TEXT PRIMARY KEY,
  original_file_name TEXT NOT NULL,
  original_sha256 TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','stored','extracted','matched','completed','review','failed')),
  contact_id TEXT REFERENCES ssx_contacts(id) ON DELETE SET NULL,
  email_id TEXT REFERENCES ssx_contact_emails(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
