import assert from "node:assert/strict";
import { connectorResponse } from "../src/connector.js";
const file = { id: 478, project_id: 2, r2_key: "projects/2/source/478/README.md" };
let present = false;
const env = {
  MASON_API_TOKEN: "test-only",
  DB: { prepare() { return { bind() { return { async first() { return file; } }; } }; } },
  PROJECT_FILES: { async head(key) { assert.equal(key, file.r2_key); return present ? { key } : null; } },
};
const request = () => new Request("https://test.invalid/api/projects/2/files/478", { headers: { authorization: "Bearer test-only" } });
assert.equal((await (await connectorResponse(request(), env)).json()).sourceAvailable, false);
present = true;
assert.equal((await (await connectorResponse(request(), env)).json()).sourceAvailable, true);
assert.equal((await connectorResponse(new Request("https://test.invalid/api/projects/2/files/478"), env)).status, 401);
console.log("Source availability reports actual storage existence; authentication remains enforced.");
