-- SSX Contact System v1
-- Source-only phase: store facts from uploaded emails and attachments.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL,
  website text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text DEFAULT 'US',
  logo_blob_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX companies_normalized_name_uq ON companies(normalized_name);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  first_name text,
  middle_name text,
  last_name text,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  primary_email text,
  primary_phone text,
  title text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','review')),
  photo_blob_key text,
  source_confidence numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contacts_primary_email_uq ON contacts(lower(primary_email)) WHERE primary_email IS NOT NULL;
CREATE INDEX contacts_company_idx ON contacts(company_id);
CREATE INDEX contacts_normalized_name_idx ON contacts(normalized_name);

CREATE TABLE contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  internet_message_id text,
  conversation_id text,
  direction text NOT NULL DEFAULT 'received' CHECK (direction IN ('received','sent','unknown')),
  sender_name text,
  sender_email text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  sent_at timestamptz,
  received_at timestamptz,
  body_text text,
  body_html_blob_key text,
  original_msg_blob_key text NOT NULL,
  original_file_name text NOT NULL,
  original_sha256 text NOT NULL,
  original_size_bytes bigint NOT NULL,
  extraction_status text NOT NULL DEFAULT 'pending' CHECK (extraction_status IN ('pending','extracted','review','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contact_emails_sha256_uq ON contact_emails(original_sha256);
CREATE INDEX contact_emails_contact_idx ON contact_emails(contact_id, received_at DESC);
CREATE INDEX contact_emails_sender_idx ON contact_emails(lower(sender_email));

CREATE TABLE contact_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid NOT NULL REFERENCES contact_emails(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text,
  blob_key text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(email_id, sha256)
);

CREATE TABLE contact_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email_id uuid REFERENCES contact_emails(id) ON DELETE SET NULL,
  communication_type text NOT NULL DEFAULT 'email',
  summary text,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contact_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email_id uuid REFERENCES contact_emails(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','dismissed')),
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE contact_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  project_name text NOT NULL,
  project_external_id text,
  project_role text,
  project_image_blob_key text,
  is_current boolean NOT NULL DEFAULT true,
  linked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contact_coi_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete','requested','received','expired','complete')),
  expiration_date date,
  coi_email text,
  document_blob_key text,
  source_email_id uuid REFERENCES contact_emails(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contact_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  email_id uuid REFERENCES contact_emails(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_value text,
  source_location text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE contact_duplicate_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  possible_duplicate_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  match_reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','merged','not_duplicate')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE contact_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_file_name text NOT NULL,
  original_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','stored','extracted','matched','completed','review','failed')),
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email_id uuid REFERENCES contact_emails(id) ON DELETE SET NULL,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
