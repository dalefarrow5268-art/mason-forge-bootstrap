import { connectorResponse } from "./connector.js";
import { authorizeMcpRequest, createDownloadGrant, mcpAuthChallenge } from "./oauth.js";

const protocolVersion = "2025-06-18";

const tools = [
  ["get_system_state", "Retrieve the verified Mason Forge system state and project summaries.", {}],
  ["list_project_files", "List every registered file in a project.", { projectId: { type: "integer", enum: [4, 5], description: "4 = Fairfield Inn Tampa; 5 = StudioRes Estero" } }],
  ["get_project_file", "Retrieve one project file's metadata and extracted text/evidence.", { projectId: { type: "integer", enum: [4, 5] }, fileId: { type: "integer" } }],
  ["get_project_file_source", "Create a short-lived download link for one original project file.", { projectId: { type: "integer", enum: [4, 5] }, fileId: { type: "integer" } }],
  ["get_project_status", "Retrieve a consolidated project status summary.", { projectId: { type: "integer", enum: [4, 5] } }],
  ["get_project_tasks", "Retrieve department tasks and task events.", { projectId: { type: "integer", enum: [4, 5] } }],
  ["get_project_outputs", "Retrieve completed department outputs and evidence registers.", { projectId: { type: "integer", enum: [4, 5] } }],
  ["get_project_findings", "Retrieve project findings and evidence.", { projectId: { type: "integer", enum: [4, 5] } }],
  ["get_project_evidence", "Retrieve extraction status, evidence batches, and routed files.", { projectId: { type: "integer", enum: [4, 5] } }],
  ["get_project_rfis", "Retrieve the project RFI register.", { projectId: { type: "integer", enum: [4, 5] } }],
  ["get_project_contacts", "Retrieve project identity, parties, and available contacts.", { projectId: { type: "integer", enum: [4, 5] } }],
  ["get_project_continuity", "Retrieve project Continuity Ledger state and history.", { projectId: { type: "integer", enum: [4, 5] } }],
].map(([name, description, properties]) => ({
  name,
  title: description,
  description,
  inputSchema: {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  securitySchemes: [{ type: "oauth2", scopes: ["mason.read"] }],
  _meta: { securitySchemes: [{ type: "oauth2", scopes: ["mason.read"] }] },
}));

function jsonRpc(id, result, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function rpcError(id, code, message, status = 400) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function allowedOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "openai.com" || host.endsWith(".openai.com");
  } catch {
    return false;
  }
}

function routeForTool(name, args = {}) {
  const projectId = Number(args.projectId);
  const fileId = Number(args.fileId);
  switch (name) {
    case "get_system_state": return "/api/connector/bootstrap";
    case "list_project_files": return `/api/projects/${projectId}/files`;
    case "get_project_file": return `/api/projects/${projectId}/files/${fileId}`;
    case "get_project_status": return `/api/projects/${projectId}/status`;
    case "get_project_tasks": return `/api/projects/${projectId}/tasks`;
    case "get_project_outputs": return `/api/projects/${projectId}/outputs`;
    case "get_project_findings": return `/api/projects/${projectId}/findings`;
    case "get_project_evidence": return `/api/projects/${projectId}/evidence`;
    case "get_project_rfis": return `/api/projects/${projectId}/rfis`;
    case "get_project_contacts": return `/api/projects/${projectId}/contacts`;
    case "get_project_continuity": return `/api/projects/${projectId}/continuity`;
    default: return null;
  }
}

async function callConnectorTool(name, args, request, env) {
  if ("projectId" in (args || {}) && ![4, 5].includes(Number(args.projectId))) {
    throw new Error("Only Fairfield project 4 and Estero project 5 are available through this connector.");
  }
  if (name === "get_project_file_source") {
    const projectId = Number(args.projectId);
    const fileId = Number(args.fileId);
    if (!Number.isSafeInteger(fileId) || fileId < 1) throw new Error("fileId must be a positive integer.");
    const grant = await createDownloadGrant(env, new URL(request.url).origin, projectId, fileId);
    return {
      content: [
        {
          type: "resource_link",
          uri: grant.url,
          name: grant.file.file_name,
          title: grant.file.relative_path || grant.file.file_name,
          mimeType: grant.file.file_type || "application/octet-stream",
          size: Number(grant.file.size_bytes || 0),
        },
        {
          type: "text",
          text: JSON.stringify({
            projectId,
            fileId,
            fileName: grant.file.file_name,
            relativePath: grant.file.relative_path,
            fileType: grant.file.file_type,
            sizeBytes: Number(grant.file.size_bytes || 0),
            sha256: grant.file.sha256 || null,
            revision: grant.file.revision || null,
            documentDate: grant.file.document_date || null,
            downloadExpiresAt: grant.expiresAt,
          }, null, 2),
        },
      ],
    };
  }
  const route = routeForTool(name, args);
  if (!route) throw new Error(`Unknown tool: ${name}`);
  const synthetic = new Request(`${new URL(request.url).origin}${route}`, {
    method: "GET",
    headers: { authorization: `Bearer ${env.MASON_API_TOKEN}` },
  });
  const response = await connectorResponse(synthetic, env);
  if (!response) throw new Error(`No connector route for ${route}`);
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 2000));
  return { content: [{ type: "text", text }] };
}

export async function mcpResponse(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp") return null;
  if (!allowedOrigin(request)) return rpcError(null, -32000, "Origin not allowed.", 403);
  if (request.method === "GET") {
    return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
  }
  if (request.method !== "POST") return rpcError(null, -32600, "Method not allowed.", 405);

  let message;
  try { message = await request.json(); }
  catch { return rpcError(null, -32700, "Parse error."); }

  const { id = null, method, params = {} } = message || {};
  if (method === "initialize") {
    return jsonRpc(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "Mason Forge", version: "1.0.0" },
      instructions: "Read-only access to Mason Forge Fairfield project 4 and Estero project 5. Retrieve continuity and evidence before drawing conclusions.",
    });
  }
  if (method === "notifications/initialized") return new Response(null, { status: 202 });
  if (method === "ping") return jsonRpc(id, {});
  if (method === "tools/list") return jsonRpc(id, { tools });
  if (method === "tools/call") {
    const name = params?.name;
    if (!(await authorizeMcpRequest(request, env))) {
      const challenge = mcpAuthChallenge(url.origin);
      return jsonRpc(id, {
        content: [{ type: "text", text: "Connect Mason Forge to authorize read-only project access." }],
        isError: true,
        _meta: { "mcp/www_authenticate": [challenge] },
      });
    }
    try {
      const result = await callConnectorTool(name, params?.arguments || {}, request, env);
      return jsonRpc(id, { ...result, isError: false });
    } catch (error) {
      return jsonRpc(id, { content: [{ type: "text", text: String(error?.message || error) }], isError: true });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}
