import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const execFileAsync = promisify(execFile);

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

async function runGit(repositoryPath, args) {
  const result = await execFileAsync(
    "git",
    ["-C", repositoryPath, ...args],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }
  );

  return result.stdout.trim();
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

function parseGitStatus(output) {
  if (!output) {
    return [];
  }

  return output.split(/\r?\n/).map((line) => {
    const indexStatus = line.charAt(0);
    const workingTreeStatus = line.charAt(1);
    const file = line.slice(3).trim();

    return {
      file,
      indexStatus:
        indexStatus === " " ? "Unchanged" : indexStatus,
      workingTreeStatus:
        workingTreeStatus === " " ? "Unchanged" : workingTreeStatus,
    };
  });
}

function parseCommitHistory(output) {
  if (!output) {
    return [];
  }

  return output
    .split("\u001e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, message, author, createdAt] =
        record.split("\u001f");

      return {
        hash,
        message,
        author,
        createdAt,
      };
    });
}

async function inspectGitRepository(repositoryPath) {
  const resolvedPath = path.resolve(repositoryPath);
  const stats = await fs.stat(resolvedPath);

  if (!stats.isDirectory()) {
    throw new Error("The selected repository path is not a directory.");
  }

  const insideWorkTree = await runGit(resolvedPath, [
    "rev-parse",
    "--is-inside-work-tree",
  ]);

  if (insideWorkTree !== "true") {
    throw new Error("The selected folder is not inside a Git repository.");
  }

  const repositoryRoot = await runGit(resolvedPath, [
    "rev-parse",
    "--show-toplevel",
  ]);

  const branch = await runGit(resolvedPath, [
    "branch",
    "--show-current",
  ]);

  const statusOutput = await runGit(repositoryRoot, [
    "status",
    "--short",
  ]);

  let remote = "";

  try {
    remote = await runGit(repositoryRoot, [
      "remote",
      "get-url",
      "origin",
    ]);
  } catch {
    remote = "";
  }

  let headCommit = null;
  let recentCommits = [];

  try {
    const headOutput = await runGit(repositoryRoot, [
      "log",
      "-1",
      "--format=%h%x1f%s%x1f%an%x1f%cI",
    ]);

    const [headHash, headMessage, headAuthor, headCreatedAt] =
      headOutput.split("\u001f");

    headCommit = {
      hash: headHash,
      message: headMessage,
      author: headAuthor,
      createdAt: headCreatedAt,
    };

    const historyOutput = await runGit(repositoryRoot, [
      "log",
      "-10",
      "--format=%h%x1f%s%x1f%an%x1f%cI%x1e",
    ]);

    recentCommits = parseCommitHistory(historyOutput);
  } catch {
    headCommit = null;
    recentCommits = [];
  }

  return {
    path: repositoryRoot,
    name: path.basename(repositoryRoot),
    status: "Connected",
    branch: branch || "Detached HEAD",
    remote,
    headCommit,
    changes: parseGitStatus(statusOutput),
    recentCommits,
    inspectedAt: new Date().toISOString(),
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

      server.middlewares.use(
        "/api/git/repository/inspect",
        async (request, response) => {
          if (request.method !== "POST") {
            sendJson(response, 405, {
              error: "Method not allowed.",
            });
            return;
          }

          try {
            const body = await readJsonBody(request);
            const repositoryPath =
              typeof body.repositoryPath === "string"
                ? body.repositoryPath.trim()
                : "";

            if (!repositoryPath) {
              sendJson(response, 400, {
                error: "A repository path is required.",
              });
              return;
            }

            const repository =
              await inspectGitRepository(repositoryPath);

            sendJson(response, 200, {
              repository,
            });
          } catch (error) {
            sendJson(response, 400, {
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to inspect the Git repository.",
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