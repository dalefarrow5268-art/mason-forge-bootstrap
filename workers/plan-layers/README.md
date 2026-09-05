# Mason page preparation worker

Pipeline: original page -> full-page Brain record -> source-preserving layers -> classification review -> existing scale gate -> takeoff.

The original is immutable. The full-page record stores all extractable text, text locations, vector geometry, source digest and a full-page preview before any filtering. This is extraction, not a claim that all visual content has been semantically understood. Raster-only / unsupported PDFs are routed for OCR and segmentation; they must not silently become empty takeoff sheets.

The initial adapter supports Revit marked-content Element groups. It does not infer architectural meaning from element IDs. A profile selects the applicable drawing/text view regions and candidate heuristics. Two switchable layers: Measuring defaults ON; Not needed for measuring defaults OFF. The measuring layer contains wall, window, door and room-label candidates. Category membership remains in the manifest. All other content is retained. Whole source elements stay together, preserving labels, door swings and geometry. Uncertain classifications remain explicitly unverified.

Run:

    python pipeline.py original.pdf --page 13 --profile profile.json --output /path/to/brain-cache

Requires pypdf and PyMuPDF. Page numbers are one-based. Source hash, page, profile and worker version key the cache. Identical inputs reuse the completed artifacts; changed source or classifier settings create a new revision. The record and layered PDF are written before the manifest completion marker. A failed build has no completion marker and retries safely.

Outputs: original-page.pdf, full-page.png, full-page.json, layers.pdf, layer-manifest.json. Full-page capture and layer results have separate status. Layer classification is always REVIEW_REQUIRED for this heuristic adapter. Scale is NOT_CHECKED; this worker never authorizes quantities. Original annotations are hidden on the filtered copy only. Coordinates remain original PDF coordinates; geometry JSON declares its top-left transform.

Deployment status: executable local worker, not yet attached to the production queue. Production integration must store outputs in project R2, register the Brain record, then enqueue classification review. A Cloudflare JavaScript worker cannot directly execute this Python module: use a Python job runner with project-scoped download/upload grants. Never enqueue measurement from a successful PDF-write alone.
