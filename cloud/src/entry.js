import {intakeDashboardRoute} from './intake-progress.js';
import { projectPhaseRoute } from './project-phase-api.js';
import { dashboardRequest } from "./dashboard-auth.js";
import foundation from "./index.js";
import runtime from "./worker.js";
import { connectorResponse } from "./connector.js";
import { mcpResponse } from "./mcp.js";
import { downloadGrantResponse, isOAuthDiscoveryPath, oauthResponse } from "./oauth.js";
import { ensureRuntimeSchema } from "./ensure-schema.js";
import { recoverQueuedDepartmentTasks } from "./queued-task-recovery.js";
import { ensureAllProjectContinuity } from "./project-continuity.js";
import { uploadGrantResponse } from "./upload-grants.js";
import { webFileSystemRoute } from "./web-file-system.js";
import { projectCenterIntake } from "./project-center-intake.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function background(ctx, promise, label) {
  if (!ctx?.waitUntil) return;
  ctx.waitUntil(Promise.resolve(promise).catch((error) => {
    console.error(`Mason Forge background ${label} failed`, error);
  }));
}

async function selfHeal(env, ctx, trigger) {
  await recoverQueuedDepartmentTasks(env);
  await runtime.scheduled({ cron: trigger }, env, ctx);
  await ensureAllProjectContinuity(env);
}

export default {
  async fetch(request, env, ctx) {
    const intakeDashboard = await intakeDashboardRoute(request, env);
    if (intakeDashboard) return intakeDashboard;
    request = await dashboardRequest(request, env);
    const url = new URL(request.url);
    let phase = "runtime-schema";

    try {
      if (url.pathname === '/api/project-center/intake') return await projectCenterIntake(request, env);
      if (isOAuthDiscoveryPath(url.pathname)) {
        phase = "oauth-discovery";
        return await oauthResponse(request, env);
      }

      // MCP initialization and tools/list are stateless. Handle them before D1
      // schema maintenance so ChatGPT can always discover the connector actions.
      if (url.pathname === "/mcp") {
        phase = "mcp";
        const response = await mcpResponse(request, env);
        if (response) return response;
      }

      await ensureRuntimeSchema(env);
      const projectPhases = await projectPhaseRoute(request, env);
      if (projectPhases) return projectPhases;

      phase = "oauth";
      const oauth = await oauthResponse(request, env);
      if (oauth) return oauth;

      phase = "download";
      const download = await downloadGrantResponse(request, env);
      if (download) return download;

      phase = "upload";
      const upload = await uploadGrantResponse(request, env);
      if (upload) return upload;

      phase = "ssx-web-file-system";
      const fileSystem = await webFileSystemRoute(request, env);
      if (fileSystem) return fileSystem;

      if (url.pathname === "/health" && request.method === "GET") {
        phase = "read-only-health";
        const response = await foundation.fetch(request, env, ctx);
        background(ctx, selfHeal(env, ctx, "health-self-heal"), "health self-heal");
        return response;
      }

      if (url.pathname === "/api/connector/bootstrap" && request.method === "GET") {
        phase = "read-only-bootstrap";
        const response = await connectorResponse(request, env);
        if (response) {
          background(ctx, selfHeal(env, ctx, "bootstrap-self-heal"), "bootstrap self-heal");
          return response;
        }
      }

      phase = "runtime-route";
      return await runtime.fetch(request, env, ctx);
    } catch (error) {
      console.error(`Mason Forge ${phase} failed`, error);
      return json({
        status: "degraded",
        operationalReady: false,
        service: env.SYSTEM_NAME || "Mason Forge Cloud",
        environment: env.ENVIRONMENT || "unknown",
        releaseId: env.RELEASE_ID || "unknown",
        phase,
        error: String(error?.message || error).slice(0, 1000),
        checkedAt: new Date().toISOString(),
      }, 500);
    }
  },

  async queue(batch, env, ctx) {
    const result = await runtime.queue(batch, env, ctx);
    await ensureAllProjectContinuity(env);
    return result;
  },

  async scheduled(event, env, ctx) {
    await recoverQueuedDepartmentTasks(env);
    const result = await runtime.scheduled(event, env, ctx);
    await ensureAllProjectContinuity(env);
    return result;
  },
};
