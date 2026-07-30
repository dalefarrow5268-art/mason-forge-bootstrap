# SSX Contact System — live deployment checklist

This worker is ready to be connected to the existing Mason Forge Cloudflare Worker, D1 database, and private R2 bucket. Do not create a public bucket or a second contact database.

## One-time Cloudflare steps

1. Authenticate Wrangler in a terminal that has access to the Mason Forge Cloudflare account:
   ```bash
   npx wrangler login
   ```
2. In `wrangler.jsonc`, replace the placeholder D1 name/ID and R2 bucket name with the existing Mason Forge bindings. Keep the Worker name pointed at the existing Mason Forge Worker/router integration.
3. Set a new, long random secret. Never put it in GitHub, a Vercel client page, or chat:
   ```bash
   npx wrangler secret put CONTACT_SYSTEM_TOKEN
   ```
4. Apply the two additive migrations to the existing D1 database:
   ```bash
   npx wrangler d1 migrations apply DB --remote
   ```
5. Deploy only after confirming the existing Mason Forge project routes are preserved:
   ```bash
   npx wrangler deploy
   ```

## First live test

1. Confirm `GET /contact-system/health` returns `ready: true`.
2. Upload one non-sensitive Outlook `.msg` file with:
   - `Authorization: Bearer <CONTACT_SYSTEM_TOKEN>`
   - `X-SSX-File-Name: sample.msg`
   - `X-SSX-SHA256: <SHA-256 of exact file bytes>`
3. Confirm the original `.msg` and any attachments are private in R2, the contact is created/matched only by exact sender email, and the contact detail record shows the evidence trail.
4. Re-upload the exact same file and confirm it is rejected as a duplicate.

## Security rules already enforced

- No public contact files or public email links.
- No web research or inferred enrichment.
- Contact/company facts must cite the imported Outlook email source.
- Similar names create duplicate-review items; they never merge automatically.
