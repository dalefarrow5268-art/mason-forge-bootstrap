# Phases Five and Six

Phase Five runs after every division has a clean Phase Four section review. It converts the cited section evidence into individual short scope lines, retaining original file and sheet references. No unused sections, guessed quantities or prices are added. Results and estimate outbox rows commit together. Duplicate queue deliveries are harmless; stale tasks are recovered and failed tasks stop after five attempts.

Phase Six starts after all section scope jobs are ready. It reviews every file in the Phase Two inventory, including files not represented in the estimate, and writes cited memory records under `projects/<project>/Mason Project Brain/<submission>/files/`. The manifest links file memory, scope output and project information. Original objects remain untouched. This is an R2 object prefix, not a newly attached user-interface folder. Cross-document reconciliation belongs to subsequent review phases; Phase Six records per-file facts and internal conflicts.

A completed memory inventory does NOT mean an estimate was delivered. Scope rows retain WAITING_ESTIMATE_CONNECTION until an actual estimate integration acknowledges them. Text truncation, missing sources and files over 20 MiB stop complete-review status. Large-file ingestion and full-content model review are distinct limits.

## Verification

`node scripts/test-phase-six.mjs` exercises Phases Two through Six using SQLite, fake R2 and a mocked model. It verifies predecessor gates, source references, unsupported/empty entries, duplicate messages, pending delivery and missing-source rejection. This does not prove model accuracy or a real Bradenton run.

## Remaining implementation

Phases Seven through Thirteen remain to be implemented: report analysis, sheet-by-sheet broken chains/RFIs, scale-verified takeoff, independent review, corrections, finalization, and draft bid packages/subsourcing. No bid invitations are sent by these modules.

The existing sealed-submission entry, verified CSI 2026 catalog and BASK estimate connection are still prerequisites for a real end-to-end project run. Do not represent the code deployment as completion of those prerequisites.
