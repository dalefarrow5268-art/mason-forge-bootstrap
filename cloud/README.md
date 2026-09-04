# Mason Forge Cloudflare Foundation

## Project Brain and supervised workers — September 2026

Cloudflare D1 is the controlling record store for each project's memories,
assignments, measured takeoffs, reviews and immutable revision histories. R2 holds
source documents and backups. Local files are a working cache; a handoff ZIP is
not a substitute for current Cloudflare records.

Each project receives eight configured roles: Sheet Review, Quantity Takeoff,
Trade, Schedule and Equipment, Broken-Chain and RFI, Estimate, Verification, and
Mason. Roles are shared definitions; all records and assignments are scoped by
project ID. New project intake configures the same roster automatically.

This release supports **supervised execution**. An orchestrator assigns work,
starts the actual worker, records its run and stores the output. Configuring a
role or saving a QUEUED assignment does not launch an autonomous AI process.
Existing department analysis workers remain separate. Their COMPLETED status
means an analysis output exists; it does not establish a measured takeoff.

MCP tools:

- `get_project_brain`: roster, counts by record kind, assignments and write contract.
- `get_brain_record`: full record and immutable revisions.
- `get_brain_assignment`: assignment and immutable progress history.
- `manage_project_brain`: assign, start, block, complete, save, verify and approve.

The existing project status tool also includes the Project Brain summary.
Clients may need to refresh their connector's tool discovery after deployment.
Reads require `mason.read`; mutations require the existing `mason.write` scope.
The authenticated connector is a shared orchestrator. Worker and verifier IDs are
explicitly **attested provenance**, not separate authenticated accounts.

MEMORY records store sheet reviews, trade traces, equipment schedules, broken
chains and general project memory without asserting a measured quantity.
TAKEOFF records require a scope number, quantity, unit, calculation, source
references, producer/run, and explicit cost/basis fields (null when unresolved).
Verification requires a different worker and run, a matching independently
checked quantity/unit, and review evidence. Mason approval follows verification.
An allowance needs evidence of the user's actual approval; no automatic approval
is inferred. Edits invalidate current verification and approvals while preserving
history. Unresolved broken chains prevent approval of verified quantities.

`mark_entered` records an external estimate save receipt. It **does not** change an
estimator. Integration must first retrieve the approved revision, write the
authorized estimate, verify the saved version, and then attach its receipt.
SYSTEM_TEST records are excluded from takeoff totals and cannot enter an estimate.

Run `npm run test:brain` for lifecycle and rejection checks. The deployment smoke
uses the same lifecycle module with the real D1 database and an explicitly
synthetic five-item fixture. An independent agent checked that fixture; this is
not construction-plan verification. The smoke tests D1 persistence, reviews,
approval, retrieval and assignment output linkage, while the MCP contract tests
exercise endpoint authentication and routing locally. Production tool discovery
and retrieval must also be checked after deployment.

This package moves Mason Forge's always-on working layer away from the home computer.

## Architecture

- **D1:** projects, contacts, identity cards, risk profiles, tasks, findings, RFIs, takeoffs, approvals, audit history and Outcome Ledger.
- **R2:** drawings, specifications, schedules, budgets, email files, photographs, generated reports and extracted text.
- **Workers:** authenticated Mason Forge API.
- **Queues:** durable department assignments with retries.
- **Cron recovery:** detects stale `RUNNING` tasks and requeues them.
- **OpenAI:** configured as an encrypted Worker secret.
- **Mason-1:** backup and high-powered document-processing node after cloud deployment.

## Honest worker-state rule

`QUEUED`, `RUNNING`, `BLOCKED`, `COMPLETED`, `FAILED`, and `CANCELED` have distinct meanings.

A task cannot be called completed without an output record. A task whose specialized processor is not deployed is marked `BLOCKED`, never represented as running or completed.

## Current build status

The package contains:

- initial D1 schema;
- five AI employee records and job descriptions;
- project intake endpoint;
- automatic department-task creation;
- Queue producer and consumer;
- stale-task recovery;
- project status endpoint;
- risk, RFI and takeoff tables;
- R2 file-register and multipart-upload initialization;
- audit log;
- Mason-1 SQLite export script;
- project-file synchronization script;
- guided deployment script.

The specialized OpenAI processors for detailed takeoff, investigation, document control, contacts and communications are the next implementation layer. The foundation intentionally blocks those assignments instead of falsely reporting work.

## Live Cloudflare resources

These resources already exist. Do not create duplicates:

1. D1 database: `mason-forge-cloud`
2. R2 bucket: `mason-forge-project-files`
3. Queue: `mason-forge-department-work`
4. Dead-letter queue: `mason-forge-department-dead-letter`
5. Worker: `mason-forge-cloud`

The included `wrangler.toml` contains the verified D1 database ID. Encrypted
secrets are already configured in Cloudflare and are intentionally not included
in this package.

## API

- `GET /health`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id/status`
- `POST /api/projects/:id/files/multipart`

All `/api` routes require:

`Authorization: Bearer <MASON_API_TOKEN>`

## Human approval gate

External emails, paid background checks, permission changes, contract decisions and other consequential external actions remain in `human_approvals` until a professional approves them.
