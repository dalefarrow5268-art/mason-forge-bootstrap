# Phase Two — Project Information

Runs on the existing Cloudflare scheduler/queue without an open chat. Phase Two follows Phase One and does not send work to a later phase.

## Admission
The future project handoff system must insert a closed submission manifest in phase_project_submissions: unique id, project_id, project_name, source_file_ids_json (complete list of original file IDs), and sealed_at (timestamp). Leave checked_at null. Use a new submission ID for later revisions; do not change a closed manifest.

This explicit end-of-submission marker prevents a partially uploaded project from advancing. Merely finding one completed ZIP does not prove the entire project has arrived. The handoff UI/system remains unimplemented, as requested. No current project has been enrolled automatically.

Every listed source must exist, be unarchived, belong to the declared project, reside in Phase One, have a COMPLETE Phase One job without inventory errors, and have at least one item. Every item must be SORTED with an available, unarchived working copy. NEEDS_REVIEW blocks admission. Staff resolving Phase One must update its actual review records; renaming a folder alone does not resolve a review item.

## Review
One durable task per working-copy file extracts explicit source facts for:
- Who: owners, clients, GC, designers and contacts.
- What: project type, scope and deliverables.
- Where: site, address and jurisdiction.
- When: bid dates, milestones and schedules, preserving the meaning of dates.
- Why: stated purpose and owner objectives.

Every included fact carries a source file ID/path, excerpt and page/sheet/section locator. Evidence is model-extracted, not independently verified. Instructions contained in source documents are treated as untrusted content.

Missing questions, extraction limitations and differing statements for the same named field are flagged. Differences are possible conflicts, not automatic declarations that one source is wrong. No dates, parties or purposes are guessed.

## Outputs
Project Information.json is registered under:
SSX Project Holding Folder/Phase Two Project Information/<project name> - <submission ID>/

Originals and Phase One copies stay intact. Advancement is a workflow transition, not destructive relocation. Per-file evidence JSON is retained under projects/<project ID>/phase-two/ in R2 and its key is included in the report. The project report includes up to 100 findings per question and explicitly counts omitted findings; full per-file evidence remains retained. Review currently supports the document extractor's formats and 20 MiB per-file limit. Up to 30 findings per file are extracted; this is a project-information brief, not an exhaustive transcription.

Unanswered questions, limitations, possible conflicts or failed files produce NEEDS_REVIEW, not a clean COMPLETE result. No Phase Three transition exists.

## Recovery
Stable item IDs prevent duplicate tasks. Leases recover after 20 minutes. Failed content requests retry up to five persisted attempts, then flag the source for review. Scheduler checks run every 15 minutes and queue completions also advance work. Blocks are revisited fairly so one project does not starve later submissions.

Test: node scripts/test-phase-two.mjs
