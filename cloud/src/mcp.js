import { connectorResponse } from "./connector.js";

const protocolVersion = "2025-06-18";

const tools = [
  ["get_system_state", "Retrieve the verified Mason Forge system state and project summaries.", {}],
  ["list_project_files", "List every registered file in a project.", { projectId: { type: "integer", enum: [4, 5], description: "4 = Fairfield Inn Tampa; 5 = StudioRes Estero" } }],
  ["get_project_file", "Retrieve one project file's metadata and extracted text/evidence.", { projectId: { type: "integer", enum: [4, 5] }, fileId: { type: "integer" } }],
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

function authorized(request, env) {
  return Boolean(env.MASON_API_TOKEN) && request.headers.get("authorization") === `Bearer ${env.MASON_API_TOKEN}`;
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
  const route = routeForTool(name, args);
  if (!route) throw new Error(`Unknown tool: ${name}`);
  if ("projectId" in (args || {}) && ![4, 5].includes(Number(args.projectId))) {
    throw new Error("Only Fairfield project 4 and Estero project 5 are available through this connector.");
  }
  const synthetic = new Request(`${new URL(request.url).origin}${route}`, {
    method: "GET",
    headers: { authorization: `Bearer ${env.MASON_API_TOKEN}` },
  });
  const response = await connectorResponse(synthetic, env);
  if (!response) throw new Error(`No connector route for ${route}`);
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 2000));
  return text;
}

export async function mcpResponse(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp") return null;
  if (!allowedOrigin(request)) return rpcError(null, -32000, "Origin not allowed.", 403);
  if (!authorized(request, env)) return rpcError(null, -32001, "Unauthorized.", 401);
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
    try {
      const text = await callConnectorTool(name, params?.arguments || {}, request, env);
      return jsonRpc(id, { content: [{ type: "text", text }], isError: false });
    } catch (error) {
      return jsonRpc(id, { content: [{ type: "text", text: String(error?.message || error) }], isError: true });
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}
