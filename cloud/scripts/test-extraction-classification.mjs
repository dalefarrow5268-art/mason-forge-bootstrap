import assert from "node:assert/strict";
import { failureClassification, sourceKind } from "../src/document-extractor.js";

assert.equal(sourceKind({ file_name: "photo.jpeg" }), "IMAGE");
assert.equal(sourceKind({ file_name: "plans.pdf" }, { documentType: "Architectural drawing" }), "DRAWING");
assert.equal(sourceKind({ file_name: "permit.pdf" }, { extractionLimitations: ["Scanned document; OCR was required."] }), "SCAN");
assert.equal(sourceKind({ file_name: "schedule.csv" }), "DOCUMENT");

assert.deepEqual(
  failureClassification({ file_name: "model.dwg" }, new Error("Unsupported extraction format.")),
  {
    sourceKind: "UNSUPPORTED FORMAT",
    reviewType: "MANUAL",
    reason: "Unsupported .dwg format. Unsupported extraction format.",
  },
);
assert.equal(
  failureClassification({ file_name: "damaged.pdf" }, new Error("Corrupted PDF cannot be read.")).sourceKind,
  "CORRUPTED FILE",
);

console.log("Extraction classification and review routing passed.");
