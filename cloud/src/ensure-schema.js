let ready = false;

export async function ensureRuntimeSchema(env) {
  if (ready) return;

  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS continuity_heads (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      state_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
      source TEXT NOT NULL DEFAULT 'MASON FORGE CLOUD',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS continuity_checkpoints (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      summary TEXT NOT NULL,
      state_json TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
      source TEXT NOT NULL DEFAULT 'MASON FORGE CLOUD',
      actor TEXT NOT NULL,
      previous_checkpoint_id TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS continuity_checkpoint_version
      ON continuity_checkpoints(scope_type, scope_id, version)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS continuity_checkpoint_scope
      ON continuity_checkpoints(scope_type, scope_id, created_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS continuity_facts (
      id TEXT PRIMARY KEY,
      checkpoint_id TEXT NOT NULL REFERENCES continuity_checkpoints(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      fact_key TEXT NOT NULL,
      fact_json TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'UNASSESSED',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      supersedes_fact_id TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS continuity_facts_scope
      ON continuity_facts(scope_type, scope_id, fact_key, created_at DESC)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS evidence_batches (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      batch_key TEXT NOT NULL UNIQUE,
      file_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ROUTED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS evidence_batches_project
      ON evidence_batches(project_id, created_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS evidence_batch_files (
      batch_id TEXT NOT NULL REFERENCES evidence_batches(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (batch_id, file_id),
      UNIQUE (file_id)
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS evidence_batch_files_project
      ON evidence_batch_files(project_id, file_id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      redirect_uris_json TEXT NOT NULL,
      token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS mcp_oauth_codes_expiry
      ON mcp_oauth_codes(expires_at, used_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      token_kind TEXT NOT NULL,
      client_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      resource TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_expiry
      ON mcp_oauth_tokens(token_kind, expires_at, revoked_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_download_grants (
      token_hash TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS mcp_download_grants_expiry
      ON mcp_download_grants(expires_at, revoked_at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS mcp_upload_grants (
      token_hash TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      file_id INTEGER NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
      expected_size INTEGER NOT NULL,
      expected_sha256 TEXT NOT NULL,
      content_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'READY',
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS mcp_upload_grants_expiry
      ON mcp_upload_grants(expires_at, status)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS extraction_review_queue (
      file_id INTEGER PRIMARY KEY REFERENCES project_files(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      review_type TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS extraction_review_queue_project
      ON extraction_review_queue(project_id, status, review_type)`),
    env.DB.prepare(`INSERT OR IGNORE INTO extraction_review_queue
      (file_id, project_id, review_type, source_kind, reason, status, created_at, updated_at)
      SELECT id, project_id, 'VISUAL', 'IMAGE',
        'Image evidence requires visual verification.', 'PENDING', datetime('now'), datetime('now')
      FROM project_files
      WHERE extracted_text_key IS NOT NULL
        AND (
          lower(file_name) GLOB '*.jpeg' OR lower(file_name) GLOB '*.jpg'
          OR lower(file_name) GLOB '*.png' OR lower(file_name) GLOB '*.webp'
          OR lower(file_name) GLOB '*.gif'
        )`),
    env.DB.prepare(`UPDATE project_files
      SET review_status = 'EXTRACTED - VISUAL REVIEW REQUIRED: IMAGE', updated_at = datetime('now')
      WHERE extracted_text_key IS NOT NULL
        AND review_status = 'EXTRACTED - NEEDS HUMAN REVIEW'
        AND (
          lower(file_name) GLOB '*.jpeg' OR lower(file_name) GLOB '*.jpg'
          OR lower(file_name) GLOB '*.png' OR lower(file_name) GLOB '*.webp'
          OR lower(file_name) GLOB '*.gif'
        )`),
    env.DB.prepare(`DELETE FROM department_outputs
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM department_outputs GROUP BY task_id
      )`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS department_outputs_one_per_task
      ON department_outputs(task_id)`),
    env.DB.prepare(`UPDATE project_files
      SET review_status = 'NEEDS EXTRACTION', updated_at = datetime('now')
      WHERE extracted_text_key IS NULL
        AND instr(review_status, 'EXTRACTION FAILED: OpenAI 400: Invalid') = 1
        AND instr(review_status, 'file_data') > 0`),
    env.DB.prepare(`UPDATE project_files
      SET review_status = 'NEEDS EXTRACTION', updated_at = datetime('now')
      WHERE extracted_text_key IS NULL
        AND instr(review_status, 'EXTRACTION FAILED: OpenAI 400: Mutually exclusive parameters:') = 1
        AND instr(review_status, 'file_id') > 0
        AND instr(review_status, 'filename') > 0`),
  ]);

  ready = true;
}
