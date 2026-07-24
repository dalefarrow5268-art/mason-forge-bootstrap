import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mcpResponse } from "../src/mcp.js";
import {
  authorizeMcpRequest,
  createDownloadGrant,
  downloadGrantResponse,
  oauthResponse,
} from "../src/oauth.js";

class D1Statement {
  constructor(database, sql, parameters = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters) {
    return new D1Statement(this.database, this.sql, parameters);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.parameters) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.parameters);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }
}

const database = new DatabaseSync(":memory:");
database.exec(`
  CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE project_files (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    file_type TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT,
    revision TEXT,
    document_date TEXT
  );
  CREATE TABLE mcp_oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    redirect_uris_json TEXT NOT NULL,
    token_endpoint_auth_method TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE mcp_oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE mcp_oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    token_kind TEXT NOT NULL,
    client_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    resource TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE mcp_download_grants (
    token_hash TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL
  );
  INSERT INTO projects (id, name) VALUES (4, 'Fairfield Inn Tampa');
  INSERT INTO project_files
    (id, project_id, r2_key, file_name, relative_path, file_type, size_bytes, sha256, revision, document_date)
  VALUES
    (10, 4, 'projects/4/source/10/test.txt', 'test.txt', 'docs/test.txt', 'text/plain', 12, 'abc123', 'A', '2026-07-24');
`);

const sourceText = "Mason Forge";
const env = {
  DB: new D1Database(database),
  MASON_API_TOKEN: "test-secret",
  PROJECT_FILES: {
    async get(key) {
      if (key !== "projects/4/source/10/test.txt") return null;
      return {
        body: sourceText,
        httpEtag: '"test-etag"',
        writeHttpMetadata(headers) {
          headers.set("content-type", "text/plain");
        },
      };
    },
  },
};
const origin = "https://mason.example";
const resource = `${origin}/mcp`;
const redirectUri = "https://chatgpt.com/connector/oauth/test";
const formRequest = (url, values) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values),
});

const protectedMetadata = await oauthResponse(
  new Request(`${origin}/.well-known/oauth-protected-resource`),
  env,
);
assert.equal(protectedMetadata.status, 200);
assert.equal((await protectedMetadata.json()).resource, resource);

const registration = await oauthResponse(new Request(`${origin}/oauth/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "ChatGPT Mason Forge test",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
  }),
}), env);
assert.equal(registration.status, 201);
const registeredClient = await registration.json();
assert.match(registeredClient.client_id, /^mfdcr_/);

const verifier = "mason-forge-pkce-verifier-abcdefghijklmnopqrstuvwxyz";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorizationParameters = {
  response_type: "code",
  client_id: registeredClient.client_id,
  redirect_uri: redirectUri,
  scope: "mason.read",
  state: "state-1",
  code_challenge: challenge,
  code_challenge_method: "S256",
  resource,
};

const authorizationPage = await oauthResponse(
  new Request(`${origin}/oauth/authorize?${new URLSearchParams(authorizationParameters)}`),
  env,
);
assert.equal(authorizationPage.status, 200);
assert.match(await authorizationPage.text(), /Authorize read-only access/);

const authorization = await oauthResponse(formRequest(`${origin}/oauth/authorize`, {
  ...authorizationParameters,
  passphrase: "test-secret",
}), env);
assert.equal(authorization.status, 302);
const callback = new URL(authorization.headers.get("location"));
assert.equal(callback.origin + callback.pathname, redirectUri);
assert.equal(callback.searchParams.get("state"), "state-1");
const code = callback.searchParams.get("code");
assert.match(code, /^mfc_/);

const exchangeParameters = {
  grant_type: "authorization_code",
  client_id: registeredClient.client_id,
  code,
  redirect_uri: redirectUri,
  code_verifier: verifier,
  resource,
};
const exchange = await oauthResponse(formRequest(`${origin}/oauth/token`, exchangeParameters), env);
assert.equal(exchange.status, 200);
const tokens = await exchange.json();
assert.match(tokens.access_token, /^mfat_/);
assert.match(tokens.refresh_token, /^mfrt_/);

const authorized = await authorizeMcpRequest(new Request(resource, {
  headers: { authorization: `Bearer ${tokens.access_token}` },
}), env);
assert.equal(authorized, true);

const replay = await oauthResponse(formRequest(`${origin}/oauth/token`, exchangeParameters), env);
assert.equal(replay.status, 400);
assert.equal((await replay.json()).error, "invalid_grant");

const refresh = await oauthResponse(formRequest(`${origin}/oauth/token`, {
  grant_type: "refresh_token",
  client_id: registeredClient.client_id,
  refresh_token: tokens.refresh_token,
  resource,
}), env);
assert.equal(refresh.status, 200);
const refreshedTokens = await refresh.json();
assert.notEqual(refreshedTokens.refresh_token, tokens.refresh_token);

const grant = await createDownloadGrant(env, origin, 4, 10);
assert.match(grant.url, /^https:\/\/mason\.example\/api\/download\/mfdl_/);
const download = await downloadGrantResponse(new Request(grant.url), env);
assert.equal(download.status, 200);
assert.equal(await download.text(), sourceText);

const rpc = async (payload, token = null) => mcpResponse(new Request(resource, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    origin: "https://chatgpt.com",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(payload),
}), env);

const initialize = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
assert.equal((await initialize.json()).result.serverInfo.name, "Mason Forge");

const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const listedTools = (await listed.json()).result.tools;
assert.equal(listedTools.length, 12);
assert.ok(listedTools.some((tool) => tool.name === "get_project_file_source"));
assert.ok(listedTools.every((tool) => tool.securitySchemes[0].type === "oauth2"));

const denied = await rpc({
  jsonrpc: "2.0",
  id: 3,
  method: "tools/call",
  params: { name: "get_project_file_source", arguments: { projectId: 4, fileId: 10 } },
});
assert.ok((await denied.json()).result._meta["mcp/www_authenticate"]);

const sourceTool = await rpc({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: { name: "get_project_file_source", arguments: { projectId: 4, fileId: 10 } },
}, refreshedTokens.access_token);
const sourceResult = (await sourceTool.json()).result;
assert.equal(sourceResult.isError, false);
assert.equal(sourceResult.content[0].type, "resource_link");
assert.equal(sourceResult.content[0].name, "test.txt");

console.log(JSON.stringify({
  success: true,
  oauth: "authorization_code_pkce_and_refresh",
  toolCount: listedTools.length,
  sourceDownload: true,
}, null, 2));
