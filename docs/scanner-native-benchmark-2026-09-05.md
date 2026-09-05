# Native scanner benchmark and implementation decision

Measured locally against Bradenton architectural PDF (61 pages), 2026-09-05.

- All pages native extraction: 26.718 seconds.
- A2.1 (page 13): 0.7809 seconds, 707 words, 26,902 drawing paths.
- Native capture only: no OCR, visual coverage validation, classification, or measurements. These timings are not end-to-end scan completion times.
- Existing 1,521 scanner sections are 169 pages times nine tiles; these are not CSI sections.

Decision: preserve native PDF text and geometry once, keyed by source hash, page, and extractor version. Review semantics separately. Use OCR only where native capture cannot recover content. Retain source coordinates and require independent scale checks before takeoff. Never equate raw capture or a model completeness claim with verified quantities.

Current change: release fully reviewed pages to purpose routing while the upload remains scanning. Run one A2.1 native-PDF API review as an isolated timed benchmark; it does not change production tile states. General native-page trials are disabled unless NATIVE_PAGE_TRIALS_ENABLED=true. No claim that four takeoff workers exist.

Options researched from primary documentation:

- PyMuPDF: native text, geometry and selective OCR. https://pymupdf.readthedocs.io/en/latest/recipes-ocr.html
- PyMuPDF licensing: AGPL/commercial; assess suitability before production selection. https://pymupdf.readthedocs.io/en/latest/about.html
- pdfplumber: text and table extraction, useful for schedules; not itself OCR. https://github.com/jsvine/pdfplumber
- OCRmyPDF: skip existing text / selective OCR. https://ocrmypdf.readthedocs.io/en/latest/advanced.html
- Docling: candidate for complex table/layout extraction. https://docling-project.github.io/docling/reference/pipeline_options/
- Existing OpenAI API: PDF input provides extracted text and page imagery. https://developers.openai.com/api/docs/guides/file-inputs

No new paid API is needed to run this benchmark. Evaluate missing-content coverage and measured latency before replacing all nine-tile reviews or increasing concurrency.

Follow-up: pdfplumber captured A2.1 text and drawing objects in 2.26 seconds (695 word groups; tokenization differs). The first native API benchmark prepared and registered its 1.66 MB source in approximately 2.3 seconds but remained RUNNING beyond three minutes. Code review found file upload has a separate 600-second timeout. An isolated direct-inline PDF variant removes that upload request; ordinary phase review file uploads are now bounded to 60 seconds. The cause of the first benchmark stall is not yet conclusively established.

Cloud result: inline A2.1 test v3 finished in 36.767 seconds with NEEDS_REVIEW on 2026-09-05 at 21:39:29 UTC. It did not complete production tiles or verify measurements. Earlier benchmark attempts could run in the short-lived health-check background context; v3 is restricted to the actual cron. Production deployment aca36cc3fcece5791b44b76964075ec225027bb0 passed all deployment and live checks. Three fully reviewed sheets were released to routing while the overall intake remained SCANNING. The old tile pipeline is still active; a complete native-capture replacement has not been deployed.
