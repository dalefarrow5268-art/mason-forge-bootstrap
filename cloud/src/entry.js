import foundation from "./index.js";
import runtime from "./worker.js";
import { connectorResponse } from "./connector.js";
import { mcpResponse } from "./mcp.js";
import { ensureRuntimeSchema } from "./ensure-schema.js";

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    let phase = "runtime-schema";

    try {
      await ensureRuntimeSchema(env);

      if (url.pathname === "/mcp") {
        phase = "mcp";
        const response = await mcpResponse(request, env);
        if (response) return response;
      }

      if (url.pathname === "/health" && request.method === "GET") {
        phase = "read-only-health";
        return await foundation.fetch(request, env, ctx);
      }

      if (url.pathname === "/api/connector/bootstrap" && request.method === "GET") {
        phase = "read-only-bootstrap";
        const response = await connectorResponse(request, env);
        if (response) {
          background(ctx, runtime.scheduled({ cron: "bootstrap-self-heal" }, env, ctx), "bootstrap self-heal");
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
    return runtime.queue(batch, env, ctx);
  },

  async scheduled(event, env, ctx) {
    return runtime.scheduled(event, env, ctx);
  },
};
