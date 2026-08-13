import { connectorResponse } from "./connector.js";
import { authorizeMcpRequest, createDownloadGrant, mcpAuthChallenge } from "./oauth.js";
import { createProjectUploadGrant } from "./upload-grants.js";
import { manageProjectFiles } from "./file-manager.js";
import { manageFulfillmentInventory } from "./fulfillment-inventory.js";

const supportedProtocolVersions = ["2025-06-18", "2025-03-26"];

function negotiateProtocolVersion(requested) {
  return supportedProtocolVersions.includes(requested) ? requested : supportedProtocolVersions[0];
}

const projectId = { type: "integer", minimum: 1, description: "Mason Forge project ID returned by list_projects." };
const toolDefinitions = [
  ["get_system_state", "Retrieve the verified Mason Forge system state and project summaries.", {}, true],
  ["list_projects", "List every Mason Forge project and its current file/task counts.", {}, true],
  ["list_project_files", "List every registered file in a project.", { projectId }, true],
  ["reconcile_project_files", "Verify every project file database record against R2 and report conservative cleanup candidates.", { projectId }, true],
  ["get_project_file", "Retrieve one project file's metadata and extracted text/evidence.", { projectId, fileId: { type: "integer", minimum: 1 } }, true],
  ["get_project_file_source", "Create a short-lived download link for one original project file.", { projectId, fileId: { type: "integer", minimum: 1 } }, true],
  ["get_project_status", "Retrieve a consolidated project status summary.", { projectId }, true],
  ["get_project_tasks", "Retrieve department tasks and task events.", { projectId }, true],
  ["get_project_outputs", "Retrieve completed department outputs and evidence registers.", { projectId }, true],
  ["get_project_findings", "Retrieve project findings and evidence.", { projectId }, true],
  ["get_project_evidence", "Retrieve extraction status, evidence batches, and routed files.", { projectId }, true],
  ["get_project_rfis", "Retrieve the project RFI register.", { projectId }, true],
  ["get_project_contacts", "Retrieve project identity, parties, and available contacts.", { projectId }, true],
  ["get_project_continuity", "Retrieve project Continuity Ledger state and history.", { projectId }, true],
  ["list_project_folders", "List the virtual folder inventory for a project, including archived folders.", { projectId }, true],
  ["create_project_folder", "Create a recoverable virtual folder inside a project.", { projectId, folderPath: { type: "string", minLength: 1, maxLength: 500 } }, false],
  ["rename_project_file", "Rename or move a project file by changing its indexed project-relative path; the protected R2 object is not deleted.", { projectId, fileId: { type: "integer", minimum: 1 }, relativePath: { type: "string", minLength: 1, maxLength: 500 } }, false],
  ["rename_project_folder", "Rename or move a virtual folder and all indexed descendants without deleting stored objects.", { projectId, folderPath: { type: "string", minLength: 1, maxLength: 500 }, newFolderPath: { type: "string", minLength: 1, maxLength: 500 } }, false],
  ["archive_project_file", "Remove a file from active project views by archiving it; the original R2 object remains recoverable.", { projectId, fileId: { type: "integer", minimum: 1 } }, false],
  ["restore_project_file", "Restore an archived project file to active project views.", { projectId, fileId: { type: "integer", minimum: 1 } }, false],
  ["archive_project_folder", "Archive a folder and all indexed descendants; no stored objects are deleted.", { projectId, folderPath: { type: "string", minLength: 1, maxLength: 500 } }, false],
  ["restore_project_folder", "Restore an archived folder and its indexed descendants.", { projectId, folderPath: { type: "string", minLength: 1, maxLength: 500 } }, false],
  ["list_fulfillment_inventory", "List permanent SSX Fulfillment Center inventory records and their SFC numbers.", {
    projectId,
    itemType: { type: "string", enum: ["FDR", "DIV", "SEC", "ACT", "EST", "ASM", "CAL", "HOL", "WTH", "HAZ", "INS", "TST", "SAF", "TRN", "DLV", "LAB", "EQP", "MAT", "MUN", "HRS", "DOC", "TMP", "WRK"] },
    status: { type: "string", enum: ["ACTIVE", "ARCHIVED", "ALL"] },
  }, true, ["projectId"]],
  ["get_fulfillment_item", "Retrieve one SSX Fulfillment Center inventory record by permanent SFC number.", {
    projectId,
    inventoryNumber: { type: "string", pattern: "^SFC-[A-Z]{3}-[0-9]{6}$" },
  }, true, ["projectId", "inventoryNumber"]],
  ["register_fulfillment_item", "Register an item and automatically issue its permanent, never-reused SFC inventory number.", {
    projectId,
    itemType: { type: "string", enum: ["FDR", "DIV", "SEC", "ACT", "EST", "ASM", "CAL", "HOL", "WTH", "HAZ", "INS", "TST", "SAF", "TRN", "DLV", "LAB", "EQP", "MAT", "MUN", "HRS", "DOC", "TMP", "WRK"] },
    itemName: { type: "string", minLength: 1, maxLength: 240 },
    parentInventoryNumber: { type: "string", pattern: "^SFC-[A-Z]{3}-[0-9]{6}$" },
    csiCode: { type: "string", minLength: 1, maxLength: 40 },
    folderPath: { type: "string", minLength: 1, maxLength: 500 },
    sourceFileId: { type: "integer", minimum: 1 },
    description: { type: "string", minLength: 1, maxLength: 4000 },
    metadata: { type: "object", additionalProperties: true },
  }, false, ["projectId", "itemType", "itemName"]],
  ["create_project_file_upload", "Create a one-time, duplicate-protected upload grant for a verified project file.", {
    projectId,
    fileName: { type: "string", minLength: 1, maxLength: 240 },
    relativePath: { type: "string", minLength: 1, maxLength: 500 },
    contentType: { type: "string", minLength: 1, maxLength: 160 },
    sizeBytes: { type: "integer", minimum: 1, maximum: 26214400 },
    sha256: { type: "string", pattern: "^[A-Fa-f0-9]{64}$" },
  }, false],
];

const tools = toolDefinitions.map(([name, description, properties, readOnly, required = Object.keys(properties)]) => {
  const scopes = readOnly ? ["mason.read"] : ["mason.read", "mason.write"];
  return {
    name,
    title: description,
    description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
    },
    securitySchemes: [{ type: "oauth2", scopes }],
    _meta: { securitySchemes: [{ type: "oauth2", scopes }] },
  };
});

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
    case "list_projects": return "/api/connector/bootstrap";
    case "list_project_files": return `/api/projects/${projectId}/files`;
    case "reconcile_project_files": return `/api/projects/${projectId}/file-reconciliation`;
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
  if ("projectId" in (args || {}) && (!Number.isSafeInteger(Number(args.projectId)) || Number(args.projectId) < 1)) {
    throw new Error("projectId must be a positive integer returned by list_projects.");
  }
  if (["list_project_folders", "create_project_folder", "rename_project_file", "rename_project_folder", "archive_project_file", "restore_project_file", "archive_project_folder", "restore_project_folder"].includes(name)) {
    return { content: [{ type: "text", text: JSON.stringify(await manageProjectFiles(name, args, env), null, 2) }] };
  }
  if (["list_fulfillment_inventory", "get_fulfillment_item", "register_fulfillment_item"].includes(name)) {
    return { content: [{ type: "text", text: JSON.stringify(await manageFulfillmentInventory(name, args, env), null, 2) }] };
  }
  if (name === "create_project_file_upload") {
    const grant = await createProjectUploadGrant(env, new URL(request.url).origin, args);
    return { content: [{ type: "text", text: JSON.stringify(grant, null, 2) }] };
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
      protocolVersion: negotiateProtocolVersion(params?.protocolVersion),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "Mason Forge", version: "1.0.0" },
      instructions: "Authenticated access to Mason Forge projects, R2-backed files, continuity, evidence, and the SSX Fulfillment Center. Discover project IDs first. File writes require mason.write. SFC inventory numbers are permanent and never reused. Uploads are size/hash verified. Folder, rename, move, archive, and restore operations are audited and never permanently delete R2 objects.",
    });
  }
  if (method === "notifications/initialized") return new Response(null, { status: 202 });
  if (method === "ping") return jsonRpc(id, {});
  if (method === "tools/list") return jsonRpc(id, { tools });
  if (method === "tools/call") {
    const name = params?.name;
    const definition = toolDefinitions.find(([toolName]) => toolName === name);
    if (!definition) return jsonRpc(id, { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true });
    const requiredScope = definition[3] ? "mason.read" : "mason.write";
    if (!(await authorizeMcpRequest(request, env, requiredScope))) {
      const challenge = mcpAuthChallenge(url.origin, requiredScope);
      return jsonRpc(id, {
        content: [{ type: "text", text: `Connect Mason Forge to authorize ${requiredScope} access.` }],
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
