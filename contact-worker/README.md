# Mason Forge / SSX Contact Worker

This is an additive Cloudflare Worker module for the existing Mason Forge Cloud deployment. It uses the existing D1 database and private R2 bucket; do not create a second contact database or public bucket.

## Before production deployment

1. Replace the two `replace-existing...` binding placeholders and the all-zero D1 ID in `wrangler.jsonc` with the bindings from the live Mason Forge Worker.
2. Set `CONTACT_SYSTEM_TOKEN` as a Cloudflare Worker secret. Do not place it in GitHub or `wrangler.jsonc`.
3. Apply `migrations/0001_contact_system.sql` to the existing D1 database.
4. Integrate `src/index.ts` routes into the existing Mason Forge Worker router, or deploy this as the existing Worker only after preserving its project routes.

## Security behavior

- Every route except health requires `Authorization: Bearer <CONTACT_SYSTEM_TOKEN>`.
- Email originals are stored in private R2 at `contacts/unassigned/emails/<sha256>/<filename>`.
- The Worker recomputes SHA-256 and rejects duplicate originals before creating another import.
- `.msg` files are preserved without mutation and remain `stored` until a source-only extractor writes verified facts to D1.
- No internet research, inferred enrichment, or public file access is included.
