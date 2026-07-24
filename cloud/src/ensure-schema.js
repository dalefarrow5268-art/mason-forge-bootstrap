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
  ]);
  ready = true;
}
