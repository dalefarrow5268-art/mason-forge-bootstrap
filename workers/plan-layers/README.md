# Mason page preparation worker

Pipeline: original page -> full-page Brain record -> source-preserving layers -> classification review -> existing scale gate -> takeoff.

The original is immutable. The full-page record stores all extractable text, text locations, vector geometry, source digest and a full-page preview before any filtering. This is extraction, not a claim that all visual content has been semantically understood. Raster-only / unsupported PDFs are routed for OCR and segmentation; they must not silently become empty takeoff sheets.

The initial adapter supports Revit marked-content Element groups. It does not infer architectural meaning from element IDs. A profile selects the applicable drawing/text view regions and candidate heuristics. Two switchable layers: Measuring defaults ON; Not needed for measuring defaults OFF. The measuring layer contains wall, window, door and room-label candidates. Category membership remains in the manifest. All other content is retained. Whole source elements stay together, preserving labels, door swings and geometry. Uncertain classifications remain explicitly unverified.

Run:

    python pipeline.py original.pdf --page 13 --profile profile.json --output /path/to/brain-cache

Requires pypdf and PyMuPDF. Page numbers are one-based. Source hash, page, profile and worker version key the cache. Identical inputs reuse the completed artifacts; changed source or classifier settings create a new revision. The record and layered PDF are written before the manifest completion marker. A failed build has no completion marker and retries safely.

Outputs: original-page.pdf, full-page.png, full-page.json, layers.pdf, layer-manifest.json. Full-page capture and layer results have separate status. Layer classification is always REVIEW_REQUIRED for this heuristic adapter. Scale is NOT_CHECKED; this worker never authorizes quantities. Original annotations are hidden on the filtered copy only. Coordinates remain original PDF coordinates; geometry JSON declares its top-left transform.

Integration: cloud/src/plan-layer-handoff.js queues sorted holding Plans only after every linked Brain scan record is complete. Prepare Plan Measuring Layers runs on the existing authorized GitHub job runner, persists checksummed artifacts and records status. Each plan is keyed by immutable registered source file ID. Changed uploads receive new identities; completed jobs are not rescanned. Retries resume incomplete work, maximum five attempts.

The auto Revit adapter discovers candidate view regions from stroke and room-label evidence. Unsupported sources stop with a reason. Heuristic outputs enter LAYER_REVIEW_REQUIRED. After source/layer comparison, the existing authenticated project-phase API accepts POST /api/project-phases/{submission}/layers/{job}/verify with sourceSha256, layerSha256, reviewer, evidence and classificationComplete:true. It validates both stored hashes, audits review and releases READY_FOR_TAKEOFF. This is classification review only; the independent scale and quantity checks still apply. Never submit a review unless the source comparison was actually completed.

Phase Nine waits without spending retries, then receives both measuring PDF and original plus saved Brain records. Other-trade scope still uses the original. API intake progress includes planLayers statuses. This implementation does not claim universal autonomous layer recognition or enable unverified quantities.

Sheet routing reuses cached Brain evidence before the Python layer worker. Cover/title, index, ADA/code information, notes, tags, legends and schedules stay REFERENCE_ONLY. TAKEOFF requires cited actual project geometry. Mixed sheets stop at REGION_REVIEW_REQUIRED until measurable regions can be isolated; no whole-sheet automatic tracing. Sheet IDs and printed scales alone never qualify. Bradenton A0.3 (ADA Information) and A2.15 (Guest Room Tags and Notes) are reference examples, not global sheet-number rules.
