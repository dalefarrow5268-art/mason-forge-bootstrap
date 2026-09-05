# Phase Four — CSI section review

After a clean Phase Three division review (READY_FOR_ESTIMATE), create one Phase Four job per supported division. This is completion of the review, not a claim that the estimate has received divisions. Actual estimate delivery remains disconnected.

Review each division's cited source plans against a verified 2026 section catalog. Retain exact six-digit section numbers, formatted XX XX XX, canonical section titles, sheet references and scope evidence. A returned code must exist in the catalog and its first two digits must equal the parent division.

## No empty estimate entries
See PROJECT_PHASE_RULES.md. Never add catalog-only sections or unused headings. Only supported sections enter the outbox. An empty review produces zero estimate entries. Ambiguous or incomplete review stays in review records, not as placeholder estimate scope. Repeated queue delivery does not duplicate a section.

## Catalog connection
phase_four_catalogs stores edition 2026, source_reference and verified_at. phase_four_sections stores edition, division_code, exact code and title. Load the complete authoritative catalog before marking it verified. No production catalog has been loaded; jobs therefore wait in WAITING_STANDARD. Test catalog values are test-only fixtures.

## Outputs
Section Review.json is registered under SSX Project Holding Folder/Phase Four Section Review/<project> - <submission ID>/<division number>/, containing sections grouped inside that division and per-sheet evidence. Originals remain intact.

Clean results enter phase_four_estimate_outbox with a stable submission/section key and a parent_outbox_id referencing the Phase Three division. Status is WAITING_ESTIMATE_CONNECTION, not delivered. The future writer must bind the exact estimate, ensure its parent division has been written, preserve prices and user edits, upsert once, then record confirmed delivery. No endpoint or credentials are guessed. The BASK estimate URL has not been resolved to an editable Site in this workspace.

## Limits and recovery
Existing scheduler checks every 15 minutes; queue completion also advances work. Leases recover after 20 minutes; failed reviews retry up to five persisted attempts. Unsupported, unreadable or uncertain plans are flagged. The inherited per-file review limit is 20 MiB. A division catalog above 180,000 serialized characters is held for smaller review batches rather than silently truncated. Model-declared coverage is not an independent completeness certification. No Phase Five transition is defined.

Test: node scripts/test-phase-four.mjs. Covers catalog gating, cross-division rejection, no empty entries, evidence grouping, correct parent ID and duplicate protection with mocked review responses. This is not a live estimate-delivery test.
