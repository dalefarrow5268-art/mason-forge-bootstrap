const READ_SCOPE = "mason.read";
const WRITE_SCOPE = "mason.write";
const SUPPORTED_SCOPES = [READ_SCOPE, WRITE_SCOPE];
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTHORIZATION_CODE_TTL_SECONDS = 5 * 60;
const DOWNLOAD_GRANT_TTL_SECONDS = 10 * 60;
const allowedClientHosts = ["chatgpt.com", "openai.com"];
const cimdCache = new Map();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      ...headers,
    },
  });
}

function oauthError(error, description, status = 400) {
  return json({ error, error_description: description }, status);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(prefix) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}_${base64Url(bytes)}`;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

async function secretsEqual(left, right) {
  if (!left || !right) return false;
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  if (leftHash.length !== rightHash.length) return false;
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
}

function canonicalResource(origin) {
  return `${origin}/mcp`;
}

function issuer(origin) {
  return origin;
}

function isAllowedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return allowedClientHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function validateRedirectUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isAllowedHost(url.hostname);
  } catch {
    return false;
  }
}

function normalizeClientMetadata(value) {
  if (!value || !Array.isArray(value.redirect_uris) || !value.redirect_uris.length) return null;
  const redirectUris = [...new Set(value.redirect_uris.map(String))];
  if (!redirectUris.every(validateRedirectUri)) return null;
  const tokenMethod = value.token_endpoint_auth_method
    || value.token_endpoint_auth_methods_supported?.find((method) => method === "none")
    || "none";
  if (tokenMethod !== "none") return null;
  return {
    clientName: String(value.client_name || value.application_name || "ChatGPT"),
    redirectUris,
    tokenEndpointAuthMethod: "none",
  };
}

async function readRegisteredClient(clientId, env) {
  const row = await env.DB.prepare(`
    SELECT client_id, client_name, redirect_uris_json, token_endpoint_auth_method
    FROM mcp_oauth_clients WHERE client_id = ?
  `).bind(clientId).first();
  if (!row) return null;
  let redirectUris;
  try { redirectUris = JSON.parse(row.redirect_uris_json); }
  catch { return null; }
  return normalizeClientMetadata({
    client_name: row.client_name,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: row.token_endpoint_auth_method,
  });
}

async function readCimdClient(clientId) {
  if (cimdCache.has(clientId)) return cimdCache.get(clientId);
  let url;
  try { url = new URL(clientId); }
  catch { return null; }
  if (url.protocol !== "https:" || !isAllowedHost(url.hostname)) return null;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    // Cloudflare Workers supports "follow" and "manual", but not "error".
    // Keep redirects visible so client metadata cannot silently change hosts.
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (response.status >= 300 && response.status < 400) return null;
  if (!response.ok) return null;
  const metadata = await response.json();
  if (metadata.client_id && metadata.client_id !== clientId) return null;
  const normalized = normalizeClientMetadata(metadata);
  if (normalized) cimdCache.set(clientId, normalized);
  return normalized;
}

async function resolveClient(clientId, env) {
  if (!clientId) return null;
  if (clientId.startsWith("https://")) return readCimdClient(clientId);
  return readRegisteredClient(clientId, env);
}

function parseScope(value) {
  const requested = String(value || READ_SCOPE).split(/\s+/).filter(Boolean);
  if (!requested.length || requested.some((scope) => !SUPPORTED_SCOPES.includes(scope))) return null;
  return [...new Set(requested)].join(" ");
}

function validPkceChallenge(value) {
  return /^[A-Za-z0-9_-]{43,128}$/.test(String(value || ""));
}

function validCodeVerifier(value) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(String(value || ""));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hidden(name, value) {
  if (value == null || value === "") return "";
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function authorizationPage(parameters, client, errorMessage = "") {
  const redirectHost = new URL(parameters.redirect_uri).hostname;
  const canWrite = String(parameters.scope || "").split(/\s+/).includes(WRITE_SCOPE);
  const accessLabel = canWrite ? "read and controlled file-upload access" : "read-only access";
  const capabilityText = canWrite
    ? "This connection can read all Mason Forge projects and create duplicate-protected, size/hash-verified project-file uploads. It cannot overwrite or delete project files."
    : "This connection can read project files, extracted text, tasks, outputs, findings, evidence, RFIs, contacts, and continuity. It cannot modify Mason Forge data.";
  const fields = [
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    "resource",
  ].map((name) => hidden(name, parameters[name])).join("");
  const error = errorMessage ? `<p class="error">${escapeHtml(errorMessage)}</p>` : "";

  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect Mason Forge</title>
  <style>
    :root{color-scheme:dark}body{margin:0;background:#101416;color:#f5f1e8;font:16px system-ui,sans-serif}
    main{max-width:520px;margin:8vh auto;padding:32px;background:#1b2226;border:1px solid #3b494f;border-radius:16px}
    h1{margin-top:0}p{line-height:1.5;color:#cbd4d7}.meta{padding:12px;background:#121719;border-radius:8px}
    label{display:block;margin:22px 0 8px;font-weight:650}input[type=password]{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;border:1px solid #65767d;background:#0e1214;color:#fff}
    button{width:100%;margin-top:20px;padding:13px;border:0;border-radius:8px;background:#d79a45;color:#18120b;font-weight:750;cursor:pointer}
    .error{color:#ffada8}.fine{font-size:13px;color:#94a3a8}
  </style>
</head>
<body>
  <main>
    <h1>Connect Mason Forge</h1>
    <p>Authorize ${accessLabel} to all verified Mason Forge projects.</p>
    <div class="meta"><strong>${escapeHtml(client.clientName)}</strong><br><span class="fine">Return to ${escapeHtml(redirectHost)}</span></div>
    ${error}
    <form method="post" action="/oauth/authorize">
      ${fields}
      <label for="passphrase">Mason Forge connector passphrase</label>
      <input id="passphrase" name="passphrase" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Authorize ${accessLabel}</button>
    </form>
    <p class="fine">${capabilityText}</p>
  </main>
</body>
</html>`, {
    status: errorMessage ? 401 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

async function authorizationParameters(request) {
  if (request.method === "GET") return Object.fromEntries(new URL(request.url).searchParams);
  if (request.method !== "POST") return null;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) return null;
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

async function validateAuthorizationRequest(parameters, env, origin) {
  if (!parameters) return { error: "invalid_request", description: "Unsupported authorization request." };
  if (parameters.response_type !== "code") return { error: "unsupported_response_type", description: "Only authorization code is supported." };
  if (parameters.code_challenge_method !== "S256" || !validPkceChallenge(parameters.code_challenge)) {
    return { error: "invalid_request", description: "PKCE with an S256 code challenge is required." };
  }
  if (parameters.resource !== canonicalResource(origin)) {
    return { error: "invalid_target", description: "The protected resource is invalid." };
  }
  const scope = parseScope(parameters.scope);
  if (!scope) return { error: "invalid_scope", description: "Supported scopes are mason.read and mason.write." };
  const client = await resolveClient(parameters.client_id, env);
  if (!client) return { error: "unauthorized_client", description: "The OAuth client is not registered or trusted." };
  if (!client.redirectUris.includes(parameters.redirect_uri)) {
    return { error: "invalid_request", description: "The redirect URI is not registered for this client." };
  }
  return { client, scope };
}

async function authorize(request, env, origin) {
  const parameters = await authorizationParameters(request);
  const validation = await validateAuthorizationRequest(parameters, env, origin);
  if (validation.error) return oauthError(validation.error, validation.description);
  if (request.method === "GET") return authorizationPage(parameters, validation.client);

  const configuredPassphrase = env.MASON_CONNECTOR_PASSWORD || env.MASON_API_TOKEN;
  if (!configuredPassphrase) return oauthError("server_error", "Connector authorization is not configured.", 503);
  if (!(await secretsEqual(parameters.passphrase, configuredPassphrase))) {
    return authorizationPage(parameters, validation.client, "The connector passphrase was not accepted.");
  }

  const code = randomToken("mfc");
  const codeHash = await sha256(code);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO mcp_oauth_codes
      (code_hash, client_id, redirect_uri, code_challenge, scope, resource, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    codeHash,
    parameters.client_id,
    parameters.redirect_uri,
    parameters.code_challenge,
    validation.scope,
    parameters.resource,
    expiresAt,
    createdAt,
  ).run();

  const redirect = new URL(parameters.redirect_uri);
  redirect.searchParams.set("code", code);
  if (parameters.state) redirect.searchParams.set("state", parameters.state);
  return Response.redirect(redirect.toString(), 302);
}

async function registerClient(request, env) {
  if (request.method !== "POST") return oauthError("invalid_request", "Use POST to register an OAuth client.", 405);
  let body;
  try { body = await request.json(); }
  catch { return oauthError("invalid_client_metadata", "The client metadata must be valid JSON."); }

  const client = normalizeClientMetadata(body);
  if (!client) {
    return oauthError(
      "invalid_redirect_uri",
      "At least one HTTPS ChatGPT or OpenAI redirect URI and token_endpoint_auth_method=none are required.",
    );
  }
  const clientId = randomToken("mfdcr");
  const createdAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO mcp_oauth_clients
      (client_id, client_name, redirect_uris_json, token_endpoint_auth_method, created_at)
    VALUES (?, ?, ?, 'none', ?)
  `).bind(clientId, client.clientName, JSON.stringify(client.redirectUris), createdAt).run();

  return json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, 201);
}

async function issueTokens(env, { clientId, scope, resource }) {
  const accessToken = randomToken("mfat");
  const refreshToken = randomToken("mfrt");
  const createdAt = new Date().toISOString();
  const accessExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString();
  const [accessHash, refreshHash] = await Promise.all([sha256(accessToken), sha256(refreshToken)]);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO mcp_oauth_tokens
        (token_hash, token_kind, client_id, scope, resource, expires_at, created_at)
      VALUES (?, 'access', ?, ?, ?, ?, ?)
    `).bind(accessHash, clientId, scope, resource, accessExpiresAt, createdAt),
    env.DB.prepare(`
      INSERT INTO mcp_oauth_tokens
        (token_hash, token_kind, client_id, scope, resource, expires_at, created_at)
      VALUES (?, 'refresh', ?, ?, ?, ?, ?)
    `).bind(refreshHash, clientId, scope, resource, refreshExpiresAt, createdAt),
  ]);

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope,
    resource,
  };
}

async function exchangeAuthorizationCode(parameters, env, origin) {
  if (!parameters.client_id || !parameters.code || !parameters.redirect_uri || !validCodeVerifier(parameters.code_verifier)) {
    return oauthError("invalid_request", "client_id, code, redirect_uri, and a PKCE code_verifier are required.");
  }
  if (parameters.resource !== canonicalResource(origin)) {
    return oauthError("invalid_target", "The protected resource is invalid.");
  }

  const codeHash = await sha256(parameters.code);
  const row = await env.DB.prepare(`
    SELECT code_hash, client_id, redirect_uri, code_challenge, scope, resource
    FROM mcp_oauth_codes
    WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
  `).bind(codeHash, new Date().toISOString()).first();
  if (!row
    || row.client_id !== parameters.client_id
    || row.redirect_uri !== parameters.redirect_uri
    || row.resource !== parameters.resource
    || (await sha256(parameters.code_verifier)) !== row.code_challenge) {
    return oauthError("invalid_grant", "The authorization code is invalid or expired.");
  }

  const used = await env.DB.prepare(`
    UPDATE mcp_oauth_codes SET used_at = ?
    WHERE code_hash = ? AND used_at IS NULL
  `).bind(new Date().toISOString(), codeHash).run();
  if (Number(used.meta?.changes || 0) !== 1) {
    return oauthError("invalid_grant", "The authorization code has already been used.");
  }
  return json(await issueTokens(env, {
    clientId: row.client_id,
    scope: row.scope,
    resource: row.resource,
  }));
}

async function exchangeRefreshToken(parameters, env, origin) {
  if (!parameters.client_id || !parameters.refresh_token) {
    return oauthError("invalid_request", "client_id and refresh_token are required.");
  }
  if (parameters.resource !== canonicalResource(origin)) {
    return oauthError("invalid_target", "The protected resource is invalid.");
  }

  const refreshHash = await sha256(parameters.refresh_token);
  const row = await env.DB.prepare(`
    SELECT token_hash, client_id, scope, resource
    FROM mcp_oauth_tokens
    WHERE token_hash = ? AND token_kind = 'refresh' AND revoked_at IS NULL AND expires_at > ?
  `).bind(refreshHash, new Date().toISOString()).first();
  if (!row || row.client_id !== parameters.client_id || row.resource !== parameters.resource) {
    return oauthError("invalid_grant", "The refresh token is invalid or expired.");
  }

  const revoked = await env.DB.prepare(`
    UPDATE mcp_oauth_tokens SET revoked_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  `).bind(new Date().toISOString(), refreshHash).run();
  if (Number(revoked.meta?.changes || 0) !== 1) {
    return oauthError("invalid_grant", "The refresh token has already been used.");
  }
  return json(await issueTokens(env, {
    clientId: row.client_id,
    scope: row.scope,
    resource: row.resource,
  }));
}

async function token(request, env, origin) {
  if (request.method !== "POST") return oauthError("invalid_request", "Use POST to exchange OAuth tokens.", 405);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", "Token requests must use application/x-www-form-urlencoded.");
  }
  const parameters = Object.fromEntries(new URLSearchParams(await request.text()));
  if (parameters.grant_type === "authorization_code") {
    return exchangeAuthorizationCode(parameters, env, origin);
  }
  if (parameters.grant_type === "refresh_token") {
    return exchangeRefreshToken(parameters, env, origin);
  }
  return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
}

function protectedResourceMetadata(origin) {
  return json({
    resource: canonicalResource(origin),
    authorization_servers: [issuer(origin)],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/dalefarrow5268-art/mason-forge-bootstrap",
  });
}

function authorizationServerMetadata(origin) {
  return json({
    issuer: issuer(origin),
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    client_id_metadata_document_supported: true,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: SUPPORTED_SCOPES,
  });
}

export function isOAuthDiscoveryPath(pathname) {
  return pathname === "/.well-known/oauth-protected-resource"
    || pathname === "/.well-known/oauth-protected-resource/mcp"
    || pathname === "/.well-known/oauth-authorization-server"
    || pathname === "/.well-known/openid-configuration";
}

export async function oauthResponse(request, env) {
  const url = new URL(request.url);
  const origin = url.origin;
  if (url.pathname === "/.well-known/oauth-protected-resource"
    || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
    return request.method === "GET" ? protectedResourceMetadata(origin) : oauthError("invalid_request", "Method not allowed.", 405);
  }
  if (url.pathname === "/.well-known/oauth-authorization-server"
    || url.pathname === "/.well-known/openid-configuration") {
    return request.method === "GET" ? authorizationServerMetadata(origin) : oauthError("invalid_request", "Method not allowed.", 405);
  }
  if (url.pathname === "/oauth/register") return registerClient(request, env);
  if (url.pathname === "/oauth/authorize") return authorize(request, env, origin);
  if (url.pathname === "/oauth/token") return token(request, env, origin);
  return null;
}

export function mcpAuthChallenge(origin, scope = READ_SCOPE) {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="${scope}"`;
}

export async function authorizeMcpRequest(request, env, requiredScope = READ_SCOPE) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  const tokenValue = header.slice("Bearer ".length).trim();
  if (!tokenValue) return false;
  if (env.MASON_API_TOKEN && await secretsEqual(tokenValue, env.MASON_API_TOKEN)) return true;

  const tokenHash = await sha256(tokenValue);
  const row = await env.DB.prepare(`
    SELECT scope, resource FROM mcp_oauth_tokens
    WHERE token_hash = ? AND token_kind = 'access' AND revoked_at IS NULL AND expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  return Boolean(
    row
    && row.resource === canonicalResource(new URL(request.url).origin)
    && String(row.scope || "").split(/\s+/).includes(requiredScope),
  );
}

export async function createDownloadGrant(env, origin, projectId, fileId) {
  const file = await env.DB.prepare(`
    SELECT id, project_id, r2_key, file_name, relative_path, file_type, size_bytes, sha256, revision, document_date
    FROM project_files WHERE id = ? AND project_id = ?
  `).bind(fileId, projectId).first();
  if (!file) throw new Error("Project file not found.");

  const token = randomToken("mfdl");
  const tokenHash = await sha256(token);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DOWNLOAD_GRANT_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare(`
    INSERT INTO mcp_download_grants
      (token_hash, project_id, file_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tokenHash, projectId, fileId, expiresAt, createdAt).run();

  return {
    file,
    expiresAt,
    url: `${origin}/api/download/${encodeURIComponent(token)}`,
  };
}

export async function downloadGrantResponse(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/download\/([^/]+)$/);
  if (!match) return null;
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { allow: "GET" });

  const tokenHash = await sha256(decodeURIComponent(match[1]));
  const row = await env.DB.prepare(`
    SELECT g.project_id, g.file_id, f.r2_key, f.file_name, f.file_type, f.size_bytes
    FROM mcp_download_grants g
    JOIN project_files f ON f.id = g.file_id AND f.project_id = g.project_id
    WHERE g.token_hash = ? AND g.revoked_at IS NULL AND g.expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!row) return json({ error: "This download link is invalid or expired." }, 404);

  const object = await env.PROJECT_FILES.get(row.r2_key);
  if (!object) return json({ error: "The source file is missing from project storage." }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type") && row.file_type) headers.set("content-type", row.file_type);
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
  headers.set("cache-control", "private, no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}
