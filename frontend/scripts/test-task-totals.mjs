import assert from "node:assert/strict";
import { normalizeTaskTotals } from "../src/services/taskTotals.js";

assert.deepEqual(
  normalizeTaskTotals([
    { status: "COMPLETED", count: 82 },
    { status: "QUEUED", count: "37" },
  ]),
  { COMPLETED: 82, QUEUED: 37 },
);

assert.deepEqual(
  normalizeTaskTotals({ COMPLETED: 82, QUEUED: 37, RUNNING: 1 }),
  { COMPLETED: 82, QUEUED: 37, RUNNING: 1 },
);

assert.deepEqual(normalizeTaskTotals(null), {});

console.log("Dashboard task totals normalization passed.");
