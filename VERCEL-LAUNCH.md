# Mason Forge — Vercel Launch

This repository is ready for the first persistent Vercel Git import.

## Import

- Team: `dalefarrow5268-6610's projects`
- Repository: `dalefarrow5268-art/mason-forge-bootstrap`
- Project name: `mason-forge`
- Root Directory: leave at repository root
- Framework Preset: Vite
- Install Command: use `vercel.json`
- Build Command: use `vercel.json`
- Output Directory: use `vercel.json`
- Production Branch: `main`

The root-level `vercel.json` installs and builds the `frontend/` application while preserving the root `api/` server functions.

## Protected environment variables

Configure for Production, Preview, and Development:

- `MASON_API_URL=https://mason-forge-cloud.mason-forge-ssx.workers.dev`
- `MASON_API_TOKEN=<existing Cloudflare Worker token>`
- `MASON_GITHUB_TOKEN=<GitHub token with Actions workflow dispatch access to this repository>`
- `MASON_DASHBOARD_APPROVAL_TOKEN=<new private approval token>`

Do not create any `VITE_MASON_API_TOKEN` variable. Backend credentials must remain server-side.

## First deployment verification

After Vercel reports Ready, run:

```bash
MASON_DASHBOARD_URL=https://<production-domain> npm run verify:production
```

The check must prove:

1. Dashboard root returns HTTP 200.
2. `/api/mason?path=health` reaches Mason Forge Cloud.
3. Cloud release ID is `2026-07-24-operational-1` or a later approved release.
4. `/api/mason` returns connector bootstrap JSON.
5. Project, file, extraction, task, and department-output totals are readable.
6. `executionProven` is not reported true unless completed tasks and stored outputs exist.

## Immediate operations after verification

Call the authenticated Cloudflare endpoint once to avoid waiting for cron:

```text
POST /api/admin/operations/kick
Authorization: Bearer <MASON_API_TOKEN>
```

Then re-run the production verification and watch the dashboard for extraction and department-output counts.

## Non-negotiable truth rule

A deployment is not complete merely because Vercel says Ready. Mason Forge is operational only after the dashboard, server proxy, Cloudflare release ID, D1 task events, and department output records all provide evidence.
