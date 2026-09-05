# Automatic review workers: Phases 7–13

The existing Cloudflare queue and 15-minute scheduler now call every implemented phase. A completed queue message also runs the scheduling sweep, so ordinary handoffs do not wait for a browser or chat session. Workers save progress in D1 and source-linked artifacts in R2. Duplicate messages are claimed atomically; stale work is recovered after 20 minutes; tasks stop for review after five failed attempts. These are logical workers sharing the existing maximum of five concurrent queue consumers, not thirteen continuously running servers.

| Phase | Worker output | Advancement condition |
| --- | --- | --- |
| 7 | Content screening of the whole reviewed inventory; detailed report findings, author recommendations, separate draft Mason recommendations | All files screened, report content reviewed without coverage issues |
| 8 | One task per actual PDF page or drawing image; sheet register; cited broken chains and draft RFIs; cross-sheet reference reconciliation | All drawing pages reviewed; open RFIs retained for correction |
| 9 | Detailed candidate takeoff traces by scope, size, viewport and units | Independent source verification and geometry/scale checks recorded; exclusions resolved |
| 10 | Original-source comparison against scope, takeoff, report analysis and memory; coverage checks | All original files reviewed; findings passed to Phase 11 |
| 11 | Source-supported short-scope corrections, a second source check, before/after audit; external questions held | All findings resolved with evidence |
| 12 | Content-hashed, immutable scope-and-takeoff estimate version, excluding empty sections | Verified quantities for all included scopes; no unresolved issues |
| 13 | Draft trade bid packages pinned to the estimate version; automatic trade matching against the existing SSX contact directory | Draft preparation finishes; recipient qualification, dates and sending approval are separate |

## Important operating limits

- This deployment is not proof of a live Bradenton run. A sealed submission, verified CSI 2026 catalogs and the exact BASK estimate integration remain outstanding prerequisites.
- Phase 9's model outputs are candidates, not verified measurements. An authenticated independent source review must supply the original source hash, reviewer and evidence. Two independent dimension anchors spanning different directions must agree within 1%; traces must lie within the calibrated viewport. NTS scaled measurements are rejected. Counts use distinct markers. Length/area/volume are calculated from geometry, not accepted from model-supplied totals. This is a deliberate review gate, not unattended precision takeoff.
- Files above 20 MiB or truncated text still require splitting for model review. PDF page splitting in Phase 8 occurs only after earlier review phases; it does not solve earlier phases' large-file limits.
- Phase 11 automatically corrects only source-supported scope wording. Quantity, geometry, pricing and engineering decisions are not silently rewritten; unresolved cases stay visible.
- Phase 12 finalizes scope and quantities; pricing is NOT_PRICED. Delivery stays WAITING_ESTIMATE_CONNECTION. No writes to a different BASK estimate are substituted.
- Directory matches are UNVERIFIED until service area, capacity, availability and contact details are checked. No email or invitation sending function is present. New external subcontractor discovery is not implemented.

## Operator API

All routes require the existing full Mason API bearer token. Never place it in client-side code. The read-only dashboard token is not authorized to mutate these records.

- GET `/api/project-phases/<submission>` — saved phase states, blocked tasks and open findings.
- POST `/api/project-phases/<submission>/takeoffs` — add a source-cited corrective measurement candidate for an existing scope and drawing task. Independent verification remains required.
- POST `/api/project-phases/<submission>/takeoffs/<id>/verify` — independent source evidence and hash, reviewer, and optional corrected geometry; server calculates quantity and audits the change.
- POST `/api/project-phases/<submission>/issues/<id>/resolve` — reviewer, resolution and source evidence.
- POST `/api/project-phases/<submission>/retry` — phase 7–13 and reason, after correcting the cause. Completed work is retained.
- POST `/api/project-phases/<submission>/candidates` — company, section code, contact and sourced qualifications; verified status is explicit. Refreshes prepared packages without sending.

After verification or resolution, the queue sweep resumes eligible work automatically. Finalized estimate inputs are frozen; a new submission revision is required for changes.

## Verification

`node scripts/test-completion-pipeline.mjs` uses SQLite, in-memory R2, a real two-page PDF and mocked model responses. It exercises phase ordering, physical page inventory, source citations, invalid scale/dimension rejection, duplicate scheduling, the independent verification gate, authenticated writes, correction/recheck, estimate versioning, automatic directory matching and unsent bid packages. These tests validate orchestration and checks; they do not validate a model's real drawing interpretation or a Bradenton estimate.
