# Phase One Project Review

## Automatic entry point
Place a project folder and its registered files under project 13:
`SSX Project Holding Folder/Phase One Project Review/<project>/`

Only registered, unarchived files within that path are inputs. A folder with no files does not start work. Ordinary Holding uploads are not inputs. The project handoff system is deliberately separate and has not been built.

The existing server scheduler checks every 15 minutes. Queue completion also advances pending work. No chat or browser session is required. The existing Cloudflare consumer allows up to five concurrent messages across this queue and other server work.

## Five review roles
- Plans: drawing sheets and plan sets.
- Documents: specifications, contracts, schedules, correspondence and other reports.
- Photos: photographic records; scanned drawings are not automatically photos.
- Geotech: soil investigations, boring logs and geotechnical reports.
- Needs Review: mixed, uncertain, unsupported, encrypted, unsafe or unreadable material.

Content classification uses the existing server document-review model and requires HIGH confidence for automatic sorting. This is classification, not engineering approval or a completeness certification.

## Durable workflow
1. Register each input once, keyed by its immutable source file ID.
2. Inventory ZIP members without loading the whole archive into memory.
3. Create one tracked queue item per file. Preserve internal paths and originals.
4. Stream working copies into R2 multipart storage, verifying ZIP CRC and byte count.
5. Review content and register the copy beneath its category.
6. Write `Phase One Review Report.json`, including each original path, output file ID, category, reason and count.

Outputs are grouped by source file ID and source filename. Outputs and reports are excluded from the entry trigger. They retain REVIEW REQUIRED status and do not enter estimating or other downstream project work automatically.

## Recovery and exceptions
Queued/running leases recover after 20 minutes. Queue attempts retry up to five times; terminal errors require staff review. Output R2 keys and inventory rows are stable to prevent duplicate copies on retries. Model requests can be retried and therefore may incur repeat model usage after interruptions.

Current automated limits: ZIP directory read 16 MiB; 50,000 entries per archive; 1 TiB total expanded size; 64 GiB per unpacked entry. Extreme compression ratios and unsafe paths are rejected. Password-protected members and symlinks are flagged. Nested archives and unsupported formats go to Needs Review rather than recursive execution. Content review is limited to supported formats of at most 20 MiB; larger working copies are retained in Needs Review. No executable content runs.

A COMPLETE job means all inventoried items have a disposition, including Needs Review. Staff must resolve exceptions before project release. Inventory errors are recorded in phase_one_jobs.error. No originals are deleted or overwritten.

## Maintenance
D1 tables: phase_one_jobs and phase_one_items. R2 working-copy prefix: projects/13/phase-one/. Queue kind: PHASE_ONE. Source files are in project_files; review reports are available through normal SSX file tools. Check Cloudflare queue logs for repeated failures and the dead-letter queue if infrastructure fails before status can be saved.

Validation: `node scripts/test-phase-one.mjs`.
