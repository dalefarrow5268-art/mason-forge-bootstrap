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
    env.DB.prepare(`DELETE FROM department_outputs
      WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM department_outputs GROUP BY task_id
      )`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS department_outputs_one_per_task
      ON department_outputs(task_id)`),
    env.DB.prepare(`UPDATE project_files
      SET review_status = 'NEEDS EXTRACTION', updated_at = datetime('now')
      WHERE extracted_text_key IS NULL
        AND review_status LIKE 'EXTRACTION FAILED: OpenAI 400: Invalid %file_data%'`),
  ]);

  ready = true;
}
