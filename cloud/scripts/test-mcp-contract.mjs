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
import { uploadGrantResponse } from "../src/upload-grants.js";

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
    return {
      success: true,
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
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
    document_date TEXT,
    review_status TEXT,
    source_class TEXT,
    uploaded_at TEXT,
    updated_at TEXT,
    archived_at TEXT,
    archived_from_status TEXT
  );
  CREATE TABLE project_folders (id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, folder_path TEXT NOT NULL, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, folder_path));
  CREATE TABLE fulfillment_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventory_number TEXT UNIQUE,
    project_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    parent_inventory_number TEXT,
    csi_code TEXT,
    folder_path TEXT,
    source_file_id INTEGER,
    description TEXT,
    metadata_json TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor TEXT, action TEXT, entity_type TEXT, entity_id TEXT, before_json TEXT, after_json TEXT, created_at TEXT);
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
  CREATE TABLE mcp_upload_grants (
    token_hash TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    file_id INTEGER NOT NULL,
    expected_size INTEGER NOT NULL,
    expected_sha256 TEXT NOT NULL,
    content_type TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL
  );
  INSERT INTO projects (id, name) VALUES (4, 'Fairfield Inn Tampa');
  INSERT INTO project_files
    (id, project_id, r2_key, file_name, relative_path, file_type, size_bytes, sha256, revision, document_date)
  VALUES
    (10, 4, 'projects/4/source/10/test.txt', 'test.txt', 'docs/test.txt', 'text/plain', 12, 'abc123', 'A', '2026-07-24');
`);

const sourceText = "Mason Forge";
const r2Objects = new Map([["projects/4/source/10/test.txt", {
  body: sourceText,
  contentType: "text/plain",
}]]);
const env = {
  DB: new D1Database(database),
  MASON_API_TOKEN: "test-secret",
  PROJECT_FILES: {
    async get(key) {
      if (!r2Objects.has(key)) return null;
      const stored = r2Objects.get(key);
      return {
        body: stored.body,
        httpEtag: '"test-etag"',
        writeHttpMetadata(headers) {
          headers.set("content-type", stored.contentType);
        },
      };
    },
    async put(key, bytes, options = {}) {
      r2Objects.set(key, {
        body: new Uint8Array(bytes),
        contentType: options.httpMetadata?.contentType || "application/octet-stream",
      });
    },
  },
  DEPARTMENT_QUEUE: { async send() {} },
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

const originalFetch = globalThis.fetch;
let cimdRedirectMode = null;
globalThis.fetch = async (_url, options = {}) => {
  cimdRedirectMode = options.redirect;
  return new Response(JSON.stringify({
    client_id: "https://chatgpt.com/.well-known/oauth-client/mason-forge-test",
    client_name: "ChatGPT Mason Forge CIMD test",
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const cimdAuthorizationPage = await oauthResponse(
  new Request(`${origin}/oauth/authorize?${new URLSearchParams({
    ...authorizationParameters,
    client_id: "https://chatgpt.com/.well-known/oauth-client/mason-forge-test",
  })}`),
  env,
);
globalThis.fetch = originalFetch;
assert.equal(cimdAuthorizationPage.status, 200);
assert.equal(cimdRedirectMode, "manual");

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
  code,
  code_verifier: verifier,
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

const refresh = await oauthResponse(new Request(`${origin}/oauth/token`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  }),
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
assert.equal(listedTools.length, 26);
assert.ok(listedTools.some((tool) => tool.name === "list_projects"));
assert.ok(listedTools.some((tool) => tool.name === "get_project_file_source"));
assert.ok(listedTools.some((tool) => tool.name === "reconcile_project_files"));
assert.ok(listedTools.some((tool) => tool.name === "create_project_folder"));
assert.ok(listedTools.some((tool) => tool.name === "archive_project_file"));
assert.ok(listedTools.some((tool) => tool.name === "restore_project_file"));
assert.ok(listedTools.some((tool) => tool.name === "list_fulfillment_inventory"));
assert.ok(listedTools.some((tool) => tool.name === "get_fulfillment_item"));
assert.ok(listedTools.some((tool) => tool.name === "register_fulfillment_item"));
const registerInventoryTool = listedTools.find((tool) => tool.name === "register_fulfillment_item");
assert.deepEqual(registerInventoryTool.inputSchema.required, ["projectId", "itemType", "itemName"]);
assert.equal(registerInventoryTool.annotations.readOnlyHint, false);
const uploadTool = listedTools.find((tool) => tool.name === "create_project_file_upload");
assert.ok(uploadTool);
assert.deepEqual(uploadTool.securitySchemes[0].scopes, ["mason.read", "mason.write"]);
assert.equal(uploadTool.annotations.readOnlyHint, false);
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

const uploadBytes = new TextEncoder().encode("photo report");
const uploadSha = createHash("sha256").update(uploadBytes).digest("hex");
const uploadRpc = await rpc({
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: {
    name: "create_project_file_upload",
    arguments: {
      projectId: 4,
      fileName: "photo-report.pdf",
      relativePath: "03 - Reports/photo-report.pdf",
      contentType: "application/pdf",
      sizeBytes: uploadBytes.byteLength,
      sha256: uploadSha,
    },
  },
}, "test-secret");
const uploadGrantResult = (await uploadRpc.json()).result;
assert.equal(uploadGrantResult.isError, false);
const uploadGrant = JSON.parse(uploadGrantResult.content[0].text);
assert.equal(uploadGrant.duplicate, false);
assert.match(uploadGrant.uploadUrl, /^https:\/\/mason\.example\/api\/uploads\/mful_/);
const uploaded = await uploadGrantResponse(new Request(uploadGrant.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "application/pdf", "content-length": String(uploadBytes.byteLength) },
  body: uploadBytes,
}), env);
assert.equal(uploaded.status, 201);
const uploadedBody = await uploaded.json();
assert.equal(uploadedBody.uploaded, true);
assert.equal(uploadedBody.sha256, uploadSha);
assert.equal(r2Objects.has(uploadedBody.r2Key), true);
assert.equal(database.prepare("SELECT review_status FROM project_files WHERE id=?").get(uploadedBody.fileId).review_status, "EXTRACTION QUEUED");

const duplicateRpc = await rpc({
  jsonrpc: "2.0",
  id: 6,
  method: "tools/call",
  params: {
    name: "create_project_file_upload",
    arguments: {
      projectId: 4,
      fileName: "photo-report-copy.pdf",
      relativePath: "03 - Reports/photo-report-copy.pdf",
      contentType: "application/pdf",
      sizeBytes: uploadBytes.byteLength,
      sha256: uploadSha,
    },
  },
}, "test-secret");
const duplicateResult = JSON.parse((await duplicateRpc.json()).result.content[0].text);
assert.equal(duplicateResult.duplicate, true);

const inventoryRpc = await rpc({
  jsonrpc: "2.0",
  id: 7,
  method: "tools/call",
  params: {
    name: "register_fulfillment_item",
    arguments: {
      projectId: 4,
      itemType: "ACT",
      itemName: "Place slab-on-grade concrete",
      csiCode: "03 30 00",
      sourceFileId: 10,
      metadata: { duration: 1, durationUnit: "day" },
    },
  },
}, "test-secret");
const inventoryResult = (await inventoryRpc.json()).result;
assert.equal(inventoryResult.isError, false);
const registeredInventory = JSON.parse(inventoryResult.content[0].text);
assert.match(registeredInventory.item.inventoryNumber, /^SFC-ACT-[0-9]{6}$/);
assert.equal(registeredInventory.item.csiCode, "03 30 00");
assert.equal(registeredInventory.item.sourceFileId, 10);

const duplicateInventoryRpc = await rpc({
  jsonrpc: "2.0",
  id: 8,
  method: "tools/call",
  params: {
    name: "register_fulfillment_item",
    arguments: {
      projectId: 4,
      itemType: "ACT",
      itemName: "Place slab-on-grade concrete",
      csiCode: "03 30 00",
      sourceFileId: 10,
    },
  },
}, "test-secret");
const duplicateInventory = JSON.parse((await duplicateInventoryRpc.json()).result.content[0].text);
assert.equal(duplicateInventory.duplicate, true);
assert.equal(duplicateInventory.item.inventoryNumber, registeredInventory.item.inventoryNumber);

const listInventoryRpc = await rpc({
  jsonrpc: "2.0",
  id: 9,
  method: "tools/call",
  params: { name: "list_fulfillment_inventory", arguments: { projectId: 4, itemType: "ACT" } },
}, refreshedTokens.access_token);
const listedInventory = JSON.parse((await listInventoryRpc.json()).result.content[0].text);
assert.equal(listedInventory.count, 1);
assert.equal(listedInventory.items[0].inventoryNumber, registeredInventory.item.inventoryNumber);

console.log(JSON.stringify({
  success: true,
  oauth: "authorization_code_pkce_and_refresh",
  toolCount: listedTools.length,
  sourceDownload: true,
  projectDiscovery: true,
  controlledUploadGrant: true,
  uploadVerified: true,
  duplicateProtection: true,
  fulfillmentInventory: true,
  permanentSfcNumbers: true,
}, null, 2));
