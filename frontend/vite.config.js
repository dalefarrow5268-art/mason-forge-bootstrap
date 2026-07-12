import fs from "node:fs/promises";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_WORKSPACE =
  "C:\\MasonForge\\Code\\mason-forge-bootstrap\\frontend";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");

  return body ? JSON.parse(body) : {};
}

async function inspectWorkspace(workspaceFolder) {
  const resolvedFolder = path.resolve(workspaceFolder);
  const stats = await fs.stat(resolvedFolder);

  if (!stats.isDirectory()) {
    throw new Error("The selected workspace path is not a directory.");
  }

  const entries = await fs.readdir(resolvedFolder, {
    withFileTypes: true,
  });

  const packageJsonPath = path.join(resolvedFolder, "package.json");
  const gitFolderPath = path.join(resolvedFolder, ".git");

  let packageJson = null;
  let hasGitRepository = false;

  try {
    const packageJsonContents = await fs.readFile(packageJsonPath, "utf8");
    packageJson = JSON.parse(packageJsonContents);
  } catch {
    packageJson = null;
  }

  try {
    const gitStats = await fs.stat(gitFolderPath);
    hasGitRepository = gitStats.isDirectory();
  } catch {
    hasGitRepository = false;
  }

  return {
    folder: resolvedFolder,
    name: path.basename(resolvedFolder),
    status: "Connected",
    connectedAt: new Date().toISOString(),
    hasPackageJson: Boolean(packageJson),
    packageName: packageJson?.name ?? null,
    packageVersion: packageJson?.version ?? null,
    hasGitRepository,
    itemCount: entries.length,
  };
}

function localWorkspaceBridge() {
  return {
    name: "mason-forge-local-workspace-bridge",

    configureServer(server) {
      server.middlewares.use(
        "/api/vscode/workspace/default",
        async (request, response) => {
          if (request.method !== "GET") {
            sendJson(response, 405, {
              error: "Method not allowed.",
            });
            return;
          }

          try {
            const workspace = await inspectWorkspace(DEFAULT_WORKSPACE);

            sendJson(response, 200, {
              workspace,
            });
          } catch (error) {
            sendJson(response, 500, {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to inspect the default workspace.",
            });
          }
        }
      );

      server.middlewares.use(
        "/api/vscode/workspace/connect",
        async (request, response) => {
          if (request.method !== "POST") {
            sendJson(response, 405, {
              error: "Method not allowed.",
            });
            return;
          }

          try {
            const body = await readJsonBody(request);
            const workspaceFolder =
              typeof body.workspaceFolder === "string"
                ? body.workspaceFolder.trim()
                : "";

            if (!workspaceFolder) {
              sendJson(response, 400, {
                error: "A workspace folder is required.",
              });
              return;
            }

            const workspace = await inspectWorkspace(workspaceFolder);

            sendJson(response, 200, {
              workspace,
            });
          } catch (error) {
            sendJson(response, 400, {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to connect to the workspace.",
            });
          }
        }
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), localWorkspaceBridge()],

  server: {
    host: "0.0.0.0",
    port: 5173,
    open: true,
  },

  preview: {
    host: "0.0.0.0",
    port: 4173,
  },

  build: {
    sourcemap: true,
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
  },
});