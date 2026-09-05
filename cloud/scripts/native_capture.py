"""Deterministic native PDF capture for the Mason Brain intake path.

Capture is evidence, not semantic review.  The output deliberately retains PDF
coordinates and source identity and never claims that a sheet is takeoff-ready.
"""
import hashlib
import json

import fitz

EXTRACTOR_VERSION = "mason-native-pdf-v2"


def _json_default(value):
    # PyMuPDF geometry values (Point/Rect/Quad/Matrix) are iterable numeric
    # coordinates.  Keep the numbers rather than converting them to display text.
    try:
        return list(value)
    except TypeError:
        raise TypeError(f"Unsupported native capture value: {type(value).__name__}")


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, default=_json_default).encode("utf-8")


def _json_sha256(value):
    """Hash canonical JSON without materializing very large drawing arrays."""
    digest = hashlib.sha256()
    encoder = json.JSONEncoder(
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        default=_json_default,
    )
    for chunk in encoder.iterencode(value):
        digest.update(chunk.encode("utf-8"))
    return digest.hexdigest()


def _drawing_summary(drawings):
    type_counts = {}
    layer_counts = {}
    bounds = None
    for drawing in drawings:
        drawing_type = str(drawing.get("type") or "UNKNOWN")
        type_counts[drawing_type] = type_counts.get(drawing_type, 0) + 1
        layer = str(drawing.get("layer") or "UNSPECIFIED")
        layer_counts[layer] = layer_counts.get(layer, 0) + 1
        rect = drawing.get("rect")
        if rect is None:
            continue
        coordinates = list(rect)
        if len(coordinates) != 4:
            continue
        if bounds is None:
            bounds = coordinates
        else:
            bounds = [
                min(bounds[0], coordinates[0]),
                min(bounds[1], coordinates[1]),
                max(bounds[2], coordinates[2]),
                max(bounds[3], coordinates[3]),
            ]
    return {
        "count": len(drawings),
        "canonicalSha256": _json_sha256(drawings),
        "typeCounts": type_counts,
        "layerCounts": layer_counts,
        "bounds": bounds,
        "authoritativeGeometry": "PRESERVED_SOURCE_PDF",
    }


def capture_key(source_sha256, page_index, profile=EXTRACTOR_VERSION):
    value = f"{source_sha256}:{page_index}:{profile}".encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def capture_page(page, source_sha256, source_path, page_index, revision=None):
    words = page.get_text("words", sort=True)
    blocks = page.get_text("blocks", sort=True)
    drawings = page.get_drawings(extended=True)
    images = page.get_images(full=True)
    links = page.get_links()
    text_chars = sum(len(str(block[4])) for block in blocks if len(block) > 4)
    # Sparse ordinary text does not mean blank: plan lettering may be vectorized
    # and photographs / scanned sheets may have no native text at all.
    risks = []
    if text_chars < 40 and drawings:
        risks.append("SPARSE_TEXT_WITH_VECTOR_GEOMETRY")
    if images:
        risks.append("IMAGE_CONTENT_REQUIRES_VISUAL_REVIEW")
    if text_chars < 40 and images:
        risks.append("POSSIBLE_IMAGE_ONLY_OR_MIXED_PAGE")
    record = {
        "schemaVersion": 2,
        "captureStatus": "CAPTURED_NOT_SEMANTICALLY_REVIEWED",
        "extractorVersion": EXTRACTOR_VERSION,
        "source": {
            "sha256": source_sha256,
            "path": source_path,
            "pageIndex": page_index,
            "pageNumber": page_index + 1,
            "revision": revision,
        },
        "page": {
            "mediaBox": list(page.mediabox),
            "cropBox": list(page.cropbox),
            "rect": list(page.rect),
            "rotation": page.rotation,
            "coordinateOrigin": "PDF_TOP_LEFT_AS_RETURNED_BY_PYMUPDF",
        },
        "evidence": {
            "textBlocks": blocks,
            "words": words,
            # Individual drawing paths can exceed tens of MiB because PDFs often
            # repeat hatch/line primitives. The lossless PDF remains the
            # authoritative geometry source; retain a deterministic digest and
            # useful counts here so the Brain capture stays bounded for review.
            "drawingDigest": _drawing_summary(drawings),
            "images": images,
            "links": links,
        },
        "signals": {
            "textCharacters": text_chars,
            "textBlockCount": len(blocks),
            "wordCount": len(words),
            "drawingCount": len(drawings),
            "imageCount": len(images),
            "riskFlags": risks,
            "visualReviewRequired": bool(risks),
            "semanticReviewComplete": False,
            "scaleVerified": False,
            "quantitiesVerified": False,
        },
    }
    record["cacheKey"] = capture_key(source_sha256, page_index)
    record["captureSha256"] = hashlib.sha256(_json_bytes(record)).hexdigest()
    return record


def write_capture(record, path):
    data = _json_bytes(record)
    path.write_bytes(data)
    return {"sha256": hashlib.sha256(data).hexdigest(), "sizeBytes": len(data)}
