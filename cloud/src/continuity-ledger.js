const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function response(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function readContinuity(scopeType, scopeId, env) {
  const head = await env.DB.prepare(`
    SELECT * FROM continuity_heads WHERE scope_type = ? AND scope_id = ?
  `).bind(scopeType, scopeId).first();
  if (!head) return response({ error: "Continuity state not found." }, 404);

  const checkpoints = await env.DB.prepare(`
    SELECT id, version, summary, verification_status, source, actor, previous_checkpoint_id, created_at
    FROM continuity_checkpoints
    WHERE scope_type = ? AND scope_id = ?
    ORDER BY version DESC LIMIT 25
  `).bind(scopeType, scopeId).all();

  return response({
    scopeType,
    scopeId,
    checkpointId: head.checkpoint_id,
    version: head.version,
    summary: head.summary,
    verificationStatus: head.verification_status,
    source: head.source,
    state: parseJson(head.state_json, {}),
    createdAt: head.created_at,
    updatedAt: head.updated_at,
    history: checkpoints.results || [],
  });
}

export async function writeContinuity(request, scopeType, scopeId, env) {
  const body = await request.json();
  if (!body.summary?.trim()) return response({ error: "summary is required." }, 400);
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
    return response({ error: "state must be a JSON object." }, 400);
  }

  const existing = await env.DB.prepare(`
    SELECT * FROM continuity_heads WHERE scope_type = ? AND scope_id = ?
  `).bind(scopeType, scopeId).first();

  const timestamp = now();
  const checkpointId = id("checkpoint");
  const version = Number(existing?.version || 0) + 1;
  const actor = body.actor?.trim() || "MASON FORGE";
  const source = body.source?.trim() || "MASON FORGE CLOUD";
  const verificationStatus = body.verificationStatus?.trim() || "UNVERIFIED";
  const stateJson = JSON.stringify(body.state);

  const statements = [
    env.DB.prepare(`
      INSERT INTO continuity_checkpoints
        (id, scope_type, scope_id, version, summary, state_json, verification_status,
         source, actor, previous_checkpoint_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      checkpointId, scopeType, scopeId, version, body.summary.trim(), stateJson,
      verificationStatus, source, actor, existing?.checkpoint_id || null, timestamp,
    ),
    env.DB.prepare(`
      INSERT INTO continuity_heads
        (scope_type, scope_id, checkpoint_id, state_json, summary, verification_status,
         source, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        checkpoint_id = excluded.checkpoint_id,
        state_json = excluded.state_json,
        summary = excluded.summary,
        verification_status = excluded.verification_status,
        source = excluded.source,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).bind(
      scopeType, scopeId, checkpointId, stateJson, body.summary.trim(), verificationStatus,
      source, version, existing?.created_at || timestamp, timestamp,
    ),
  ];

  for (const fact of body.facts || []) {
    if (!fact?.key) continue;
    statements.push(env.DB.prepare(`
      INSERT INTO continuity_facts
        (id, checkpoint_id, scope_type, scope_id, fact_key, fact_json, confidence,
         source_refs_json, supersedes_fact_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id("fact"), checkpointId, scopeType, scopeId, String(fact.key),
      JSON.stringify(fact.value ?? null), fact.confidence || "UNASSESSED",
      JSON.stringify(fact.sourceRefs || []), fact.supersedesFactId || null, timestamp,
    ));
  }

  await env.DB.batch(statements);
  return response({
    checkpointId,
    scopeType,
    scopeId,
    version,
    verificationStatus,
    summary: body.summary.trim(),
    createdAt: timestamp,
  }, 201);
}

export async function listContinuityScopes(env) {
  const result = await env.DB.prepare(`
    SELECT scope_type, scope_id, checkpoint_id, version, summary, verification_status,
           source, created_at, updated_at
    FROM continuity_heads ORDER BY updated_at DESC LIMIT 100
  `).all();
  return response({ scopes: result.results || [] });
}
