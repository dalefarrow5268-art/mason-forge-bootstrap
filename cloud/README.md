# Mason Forge Cloudflare Foundation

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
