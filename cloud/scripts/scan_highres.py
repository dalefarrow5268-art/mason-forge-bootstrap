"""Render one exact Holding scanner tile from its preserved vector page."""
import hashlib, pathlib, re, tempfile, zipfile

import fitz

LIMIT = 20 * 1024**2
TARGET_WIDTH = 1200
MAX_SCALE = 5.5
TILE_RE = re.compile(r"\.brain-scan/tile-r([1-3])-c([1-3])\.(?:jpe?g|png|webp)$", re.I)


def _sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe(name):
    return bool(name) and len(name) < 1100 and not name.startswith("/") and "\\" not in name and ":" not in name and all(part not in ("", ".", "..") for part in name.split("/"))


def tile_clip(rect, tile_path):
    match = TILE_RE.search(tile_path or "")
    if not match:
        raise ValueError("Detail tile path does not identify a 3-by-3 review region")
    row, column = map(int, match.groups())
    width, height, overlap = rect.width / 3, rect.height / 3, 0.08
    return fitz.Rect(
        max(rect.x0, rect.x0 + (column - 1) * width - width * overlap),
        max(rect.y0, rect.y0 + (row - 1) * height - height * overlap),
        min(rect.x1, rect.x0 + column * width + width * overlap),
        min(rect.y1, rect.y0 + row * height + height * overlap),
    )


def render_retry(prepared_zip, source_path, tile_path, output_png):
    if not _safe(source_path) or not source_path.lower().endswith(".pdf"):
        raise ValueError("Prepared source path is unsafe or not a PDF")
    before = _sha(prepared_zip)
    with tempfile.TemporaryDirectory() as temporary:
        page_pdf = pathlib.Path(temporary) / "source-page.pdf"
        with zipfile.ZipFile(prepared_zip) as archive:
            try:
                info = archive.getinfo(source_path)
            except KeyError as error:
                raise ValueError("Prepared source page is missing") from error
            if info.is_dir() or info.flag_bits & 1 or info.file_size > LIMIT:
                raise ValueError("Prepared source page is invalid")
            with archive.open(info) as source, open(page_pdf, "wb") as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
        with fitz.open(page_pdf) as document:
            if document.needs_pass or document.page_count != 1:
                raise ValueError("High-resolution retry requires one unencrypted page")
            page = document[0]
            clip = tile_clip(page.rect, tile_path)
            scale = min(MAX_SCALE, max(1.25, TARGET_WIDTH / clip.width))
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False, annots=True)
            pixmap.save(output_png)
    output = pathlib.Path(output_png)
    if not output.is_file() or output.stat().st_size > LIMIT:
        raise ValueError("High-resolution retry image is missing or exceeds 20 MiB")
    if _sha(prepared_zip) != before:
        raise ValueError("Prepared package changed during high-resolution retry")
    return {
        "sourcePath": source_path,
        "tilePath": tile_path,
        "clip": list(clip),
        "renderScale": scale,
        "renderDpi": round(72 * scale, 2),
        "width": pixmap.width,
        "height": pixmap.height,
        "sizeBytes": output.stat().st_size,
        "sha256": _sha(output),
        "preparedSha256": before,
    }

