# SSX Contact System

## Phase 1 rule

Store and display only information proven by an uploaded email or its attachments. Missing fields remain missing. AI research and inferred enrichment are disabled until Dale explicitly enables a later phase.

## Intake workflow

1. Dale downloads an Outlook email as a `.msg` file at work.
2. Dale uploads the file in ChatGPT.
3. Mason calculates SHA-256 before storage.
4. The original email is stored in private object storage.
5. The email is parsed without altering the original.
6. Sender identity is matched by normalized email first, then reviewed name/company candidates.
7. The existing contact is updated or a new contact is created.
8. Attachments, communication history, evidence, tasks, project links, COI facts, alerts, and completeness are updated.
9. The live Master Contact Card reads the record from the contact API.

## Storage boundaries

- PostgreSQL: contacts, companies, email metadata, communication history, tasks, projects, COIs, evidence, duplicate reviews, and import jobs.
- Private object storage: original `.msg` files, HTML bodies, attachments, contact photos, company logos, COI documents, and project images.
- GitHub: application code and frozen templates only. No work emails or contact records.

## Duplicate policy

- Exact original-file SHA-256: reject duplicate import.
- Exact normalized sender email: attach to existing contact.
- Name/company similarity without matching email: create a duplicate-review record; do not auto-merge.

## Protected masters

The files in `frontend/public/final-templates/` are visual masters and must not be used as mutable data storage.
