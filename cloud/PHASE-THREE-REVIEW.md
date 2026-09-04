# Phase Three — CSI division review

Runs automatically after a Phase Two job reaches COMPLETE. NEEDS_REVIEW does not advance. Uses the existing 15-minute scheduler and queue consumer, with durable leases, five persisted attempts and original preservation.

## Current deployment state
Review and estimate-outbox code is implemented. Production has no verified 2026 catalog loaded and no estimate writer connected. Consequently a completed Phase Two submission waits in WAITING_STANDARD. Nothing has been added to the user's BASK estimate.

The supplied URL https://bask-downtown-bradenton-estimate.dalemoongate.chatgpt.site/ was not resolvable to an editable Site in the selected workspace. Do not substitute the separately listed Bask Estimating System or a Plan Viewer. Resolve the exact target and its data model before connecting an estimate writer.

## Authoritative catalog input
Load the user's verified MasterFormat 2026 division-level data into phase_three_divisions (edition, two-digit code, exact title), then register its source_reference and verified_at in phase_three_catalogs for edition 2026. Load the complete catalog before marking it verified. No catalog has been inferred from older editions or seeded from model knowledge. Snapshot the verified catalog with each job.

CSI confirms the 2026 release here: https://www.csiresources.org/standards/masterformat2026
Official data-access reference: https://theconstructionstandard.com/masterformat-2026-pdf-download

## Plan review
Only unarchived Plans-classified working copies in the completed Phase Two submission are reviewed. A plan may support several divisions. The model must identify scope, division number, sheet and source evidence, and declare partial/unreadable coverage. All returned numbers must exist in the supplied catalog; invalid codes, low-confidence assignments or incomplete coverage produce NEEDS_REVIEW. Canonical titles come from the catalog, not model text. No six-digit section codes, quantities, rates or prices are invented.

The inherited content review limit is 20 MiB per input. Larger/unreadable inputs are flagged, not silently considered reviewed. Model-declared coverage and evidence require the same care as other model extraction; this is not an engineering completeness certification.

## Outputs and estimate connection
Division Review.json is registered under SSX Project Holding Folder/Phase Three Division Review/<project> - <submission ID>/. It contains grouped division numbers/titles and per-sheet scope evidence. Failed/uncertain results do not create estimate outbox entries.

A clean result creates one durable outbox row per submission/division with edition and evidence pointer. Rows remain WAITING_ESTIMATE_CONNECTION. They are not estimate line items and do not claim delivery. The future writer must bind an exact target estimate ID, upsert by stable submission/division key, preserve existing costs and user edits, and mark delivery only after successful target confirmation. Never choose a target from a name similarity or send to an arbitrary URL. No webhook credentials or external writer is configured.

No Phase Four transition is defined.

Validation: node scripts/test-phase-three.mjs. Fixtures use test-only catalog entries and a mocked review service. Tests cover the edition gate, upstream completion, duplicate queue protection, invalid-code rejection, source report and unique outbox entries. They do not establish live estimate delivery or verify an actual 2026 catalog.
