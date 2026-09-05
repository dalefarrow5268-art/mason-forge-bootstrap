# Holding preparation and Brain intake scan

Dale's controlling order (2026-09-05): completed upload → preserve and prepare every file/page → detailed intake review saved in Mason Project Brain → Phase One → subsequent phases. Phase Six enriches existing Brain memory. The final estimate is UNPRICED.

## Implementation

- `prepare-holding.yml` runs on successful Cloud deployment, manual dispatch and a five-minute requested schedule. GitHub can delay scheduled starts. It uses existing Cloudflare Actions secrets; no new browser login or exposed token is required.
- `run_holding.py` checks the deployed release using authenticated Cloudflare Worker settings (the first public Python health request returned 403). It downloads completed staged sources via remote Wrangler R2, runs preparation on disk, uploads a prepared ZIP and manifest, downloads the stored ZIP and verifies SHA-256, then sets READY.
- `prepare_holding.py` unpacks archives safely, recursively to depth eight; rejects unsafe, encrypted, symlink or duplicate entries; budgets expanded bytes; emits one losslessly copied PDF page per review unit. It retains MediaBox, CropBox and rotation, checks rendered appearance and compares archive member hashes. Digital text blocks and link metadata are recorded. Saved page PDFs preserve original vector/image content. No OCR-derived or guessed measurements are accepted.
- `holding-brain-scan.js` inventories READY packages, verifies unit counts, queues every unit through the existing Cloudflare queue, registers source copies under Mason Project Brain, and requests a detailed page/file review. It records findings, locations, categories, unreadable regions and model-declared coverage. Model results remain explicitly labeled as model reviews, not independent verification. Raw originals, prepared pages, metadata and review artifacts are retained.
- Scan worker attempt wall times, start/finish timestamps and accumulated processing milliseconds are saved. They are not CPU time. Existing phase timers remain observed elapsed time.
- READY → SCANNING → SCANNED → COMPLETE. Only SCANNED permits the Phase One handoff. Incomplete scans become NEEDS_REVIEW. Exceptions retry up to five persisted attempts. Stale scanner leases recover after twenty minutes.
- `queuePhaseOne` archives any superseded initial inventory in `holding_superseded_items`, retains its file outputs, creates distinct prepared-generation item IDs and releases the prepared inventory in a D1 batch. Old queue messages cannot target new-generation item IDs. Complete saved scanner classifications are reused in Phase One.
- Cloudflare's scheduler is now configured every two minutes; queue completions also sweep eligible jobs. Five shared concurrent queue consumers remain the configured limit.
- Dashboard API includes `preparation`, `scan_total`, `scan_done`, and PREPARING state. A dedicated scanner panel and display of individual attempt timings still need Sites UI work.

## Known limits; do not overclaim

This is version-one full-page/file model review, not an independently proven exhaustive scanner. It preserves source content and reviews every enumerated page, but cannot guarantee that a model noticed every tiny symbol. Overlapping rendered region review, independent coverage reconciliation and a dedicated OCR engine for difficult scans are not implemented. Scanned PDFs receive model visual review; the Python preparation stage extracts embedded text only. Empty embedded text does not mean a blank page.

The page appearance check renders at a quarter-scale for comparison; this is a regression check, not a fine-detail reading accuracy test. Original vector PDFs are not downsampled. Individual pages over 20 MiB, oversized non-PDFs, encrypted or malformed documents, and resource-budget exceptions stop for review. Preparation retries restart the file; completed scan items persist. This runner is a practical current implementation, not yet a high-volume service with page-level preparation checkpoints.

Phase One can sort a page based on the saved scanner classification, but later facts, scale verification, takeoffs and engineering conclusions require their own review. Catalogue and estimate writer gaps remain separate. A passing deployment is not a finished estimate.

## Validation

`python scripts/test_holding.py` checks original integrity, page coverage, rotated page geometry and appearance, deterministic reruns, nested ZIPs, unsafe paths and empty archives.
`node scripts/test-phase-one.mjs` checks real ZIP inventory/extraction, 5,000-entry bounded inventory, queue deduplication, preparation and stale-message gates, Brain scanner admission and saved-review release using mocked model responses.
`node scripts/test-completion-pipeline.mjs` verifies downstream orchestration and independent scale gates with model fixtures.
Use the actual deployment and preparation run results for live status. Never describe mocked model tests as proof of drawing-reading accuracy.

## Bradenton source validation and lossless resource repair
The actual upload has 61 architectural pages, 74 engineering pages, and 34 geotechnical pages (169 total). Some pages retained shared resources from most of the complete PDF, causing single-page copies to remain 33–125 MB. PyMuPDF clean_contents removes unused page resources before lossless serialization; geometry and rendered-content checks still apply. Migration 0019 retries only source 2514 with the exact known oversize error. This is a retry, not a fabricated success.
