PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  domain TEXT,
  website TEXT,
  linkedin TEXT,
  logo_url TEXT,
  source TEXT NOT NULL DEFAULT 'PROJECT INTAKE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_domain_unique
  ON companies(domain) WHERE domain IS NOT NULL AND domain <> '';

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  title TEXT,
  role TEXT,
  trade TEXT,
  website TEXT,
  linkedin TEXT,
  logo_url TEXT,
  bidder_status TEXT,
  source TEXT NOT NULL DEFAULT 'PROJECT INTAKE',
  completeness_score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique
  ON contacts(email) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER,
  name TEXT NOT NULL UNIQUE,
  project_number TEXT,
  location TEXT,
  client TEXT,
  status TEXT NOT NULL DEFAULT 'INTAKE',
  review_status TEXT NOT NULL DEFAULT 'NEEDS REVIEW',
  source TEXT NOT NULL DEFAULT 'CLOUD INTAKE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_identity_cards (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  verification_status TEXT NOT NULL DEFAULT 'AWAITING INTAKE',
  official_name TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  address_line1 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  county TEXT,
  parcel_or_strap TEXT,
  municipality TEXT,
  project_type TEXT,
  owner_name TEXT,
  developer_name TEXT,
  general_contractor_name TEXT,
  general_contractor_license TEXT,
  architect_name TEXT,
  civil_engineer_name TEXT,
  title_company_name TEXT,
  permit_numbers_json TEXT NOT NULL DEFAULT '[]',
  project_stage TEXT,
  intake_json TEXT NOT NULL DEFAULT '{}',
  source_register_json TEXT NOT NULL DEFAULT '[]',
  conflicts_json TEXT NOT NULL DEFAULT '[]',
  intake_submitted_at TEXT,
  verified_at TEXT,
  verified_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  revision TEXT,
  document_date TEXT,
  review_status TEXT NOT NULL DEFAULT 'NEEDS REVIEW',
  extracted_text_key TEXT,
  source_class TEXT NOT NULL DEFAULT 'PROJECT FILE',
  uploaded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_files_project_id
  ON project_files(project_id, review_status);

CREATE TABLE IF NOT EXISTS ai_employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  title TEXT NOT NULL,
  supervisor_id TEXT,
  job_description_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS department_tasks (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES ai_employees(id),
  department TEXT NOT NULL,
  workstream TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK(status IN ('QUEUED','RUNNING','BLOCKED','COMPLETED','FAILED','CANCELED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  source_file_ids_json TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  heartbeat_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS department_tasks_queue
  ON department_tasks(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS department_tasks_project
  ON department_tasks(project_id, department, status);

CREATE TABLE IF NOT EXISTS department_outputs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES department_tasks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES ai_employees(id),
  output_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  r2_key TEXT,
  evidence_register_json TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL DEFAULT 'UNASSESSED',
  human_review_status TEXT NOT NULL DEFAULT 'REQUIRED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES department_tasks(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS task_events_task ON task_events(task_id, created_at);

CREATE TABLE IF NOT EXISTS project_risk_profiles (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  profile_status TEXT NOT NULL DEFAULT 'UNASSESSED',
  overall_rating TEXT NOT NULL DEFAULT 'UNASSESSED',
  overall_score INTEGER NOT NULL DEFAULT 100,
  categories_json TEXT NOT NULL DEFAULT '[]',
  controls_json TEXT NOT NULL DEFAULT '[]',
  evidence_notes_json TEXT NOT NULL DEFAULT '[]',
  executive_summary TEXT,
  recommended_decision TEXT NOT NULL DEFAULT 'PENDING EVIDENCE',
  client_decision TEXT NOT NULL DEFAULT 'PENDING',
  assessed_at TEXT,
  assessed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_risk_parties (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  company_name TEXT,
  identity_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  overall_rating TEXT NOT NULL DEFAULT 'UNASSESSED',
  overall_score INTEGER NOT NULL DEFAULT 100,
  risk_notes_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  controls_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_risk_parties_project
  ON project_risk_parties(project_id, role, name);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES department_tasks(id) ON DELETE SET NULL,
  workstream TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'INFORMATIONAL',
  confidence TEXT NOT NULL DEFAULT 'UNASSESSED',
  status TEXT NOT NULL DEFAULT 'OPEN',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  recommended_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS findings_project
  ON findings(project_id, severity, status);

CREATE TABLE IF NOT EXISTS rfi_register (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_task_id TEXT REFERENCES department_tasks(id) ON DELETE SET NULL,
  rfi_number TEXT,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  reason TEXT,
  plan_references_json TEXT NOT NULL DEFAULT '[]',
  spec_references_json TEXT NOT NULL DEFAULT '[]',
  cost_exposure_cents INTEGER,
  schedule_exposure_days INTEGER,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  human_approval_status TEXT NOT NULL DEFAULT 'REQUIRED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS takeoff_items (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_task_id TEXT REFERENCES department_tasks(id) ON DELETE SET NULL,
  trade TEXT NOT NULL,
  csi_division TEXT,
  scope_group TEXT,
  item TEXT NOT NULL,
  material TEXT,
  quantity REAL,
  unit TEXT,
  plan_reference TEXT,
  detail_reference TEXT,
  measurement_method TEXT,
  assumption TEXT,
  confidence TEXT NOT NULL DEFAULT 'UNASSESSED',
  human_review_status TEXT NOT NULL DEFAULT 'REQUIRED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS takeoff_items_project
  ON takeoff_items(project_id, trade, scope_group);

CREATE TABLE IF NOT EXISTS project_outcome_ledgers (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  outcome_status TEXT NOT NULL DEFAULT 'OPEN PROJECT',
  contract_value_cents INTEGER,
  final_revenue_cents INTEGER,
  final_cost_cents INTEGER,
  unpaid_balance_cents INTEGER,
  average_payment_days REAL,
  planned_duration_days INTEGER,
  actual_duration_days INTEGER,
  delay_days INTEGER,
  approved_change_cents INTEGER,
  unrecovered_change_cents INTEGER,
  lien_event_count INTEGER NOT NULL DEFAULT 0,
  claim_event_count INTEGER NOT NULL DEFAULT 0,
  safety_incident_count INTEGER NOT NULL DEFAULT 0,
  inspection_failure_count INTEGER NOT NULL DEFAULT 0,
  outcome_notes_json TEXT NOT NULL DEFAULT '[]',
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS human_approvals (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES department_tasks(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  requested_by_employee_id TEXT,
  description TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING',
  decided_by TEXT,
  decided_at TEXT,
  decision_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO ai_employees
  (id, name, department, title, supervisor_id, job_description_json, status, created_at, updated_at)
VALUES
  ('peter-files', 'Peter Files', 'Project File Department', 'Senior Project File Manager', NULL,
   '["Organize project files","Detect duplicates","Build document register","Track revisions","Create searchable files","Maintain Project Brain"]',
   'AVAILABLE', datetime('now'), datetime('now')),
  ('mason-holmes', 'Mason Holmes', 'Project Investigation Department', 'Chief Project Investigator', NULL,
   '["Find RFIs","Find conflicts","Find missing information","Compare plans and specifications","Identify risk","Track unresolved issues","Direct public-record and due-diligence research"]',
   'AVAILABLE', datetime('now'), datetime('now')),
  ('tommy-takeoff', 'Tommy Takeoff', 'Project Takeoff Department', 'Senior Quantity Surveyor', NULL,
   '["Measure drawings","Produce detailed quantity takeoffs","Build scopes","Create estimate sheets","Update quantities after revisions","Cite plan and detail references"]',
   'AVAILABLE', datetime('now'), datetime('now')),
  ('carol-contacts', 'Carol Contacts', 'Project Contact Department', 'Director of Project Relationships', NULL,
   '["Build project contact database","Find subcontractors","Track bidder status","Maintain relationships","Organize distribution lists"]',
   'AVAILABLE', datetime('now'), datetime('now')),
  ('eddie-email', 'Eddie Email', 'Project Communications Department', 'Project Communications Coordinator', NULL,
   '["Draft bid invitations","Create follow-ups","Manage bidder communications","Track responses","Prepare RFIs and clarification emails"]',
   'AVAILABLE', datetime('now'), datetime('now'));
