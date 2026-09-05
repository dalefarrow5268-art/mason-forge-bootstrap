"""Create a bounded high-resolution retry for one terminal Holding scan tile."""
import json, pathlib, tempfile

from run_holding import now, query, r2
from scan_highres import render_retry


def main():
    rows = query("""SELECT i.id,i.source_file_id,i.original_path,i.source_path,
      p.prepared_file_id,f.project_id,f.r2_key,f.size_bytes
      FROM holding_scan_items i
      JOIN holding_preparations p ON p.source_file_id=i.source_file_id
      JOIN project_files f ON f.id=p.prepared_file_id
      WHERE p.status='SCANNING' AND i.status='NEEDS_REVIEW'
      AND i.asset_role='DETAIL_TILE' AND i.attempts>=4
      AND i.override_file_id IS NULL AND f.archived_at IS NULL
      ORDER BY i.updated_at LIMIT 1""")
    if not rows:
        print(json.dumps({"highResolutionRetry": "NOT_REQUIRED"}), flush=True)
        return
    item = rows[0]
    with tempfile.TemporaryDirectory() as temporary:
        root = pathlib.Path(temporary)
        prepared, image, verify = root / "prepared.zip", root / "retry.png", root / "verify.png"
        r2("get", item["r2_key"], prepared)
        if prepared.stat().st_size != item["size_bytes"]:
            raise ValueError("Prepared package size changed")
        metadata = render_retry(prepared, item["source_path"], item["original_path"], image)
        key = f"projects/{item['project_id']}/Mason Project Brain/Intake/{item['source_file_id']}/high-resolution-retries/{item['id']}.png"
        r2("put", key, image)
        r2("get", key, verify)
        if verify.read_bytes() != image.read_bytes():
            raise ValueError("Stored high-resolution retry checksum mismatch")
        at = now()
        relative = f"Mason Project Brain/Intake/{item['source_file_id']}/High Resolution Retries/{item['id']}.png"
        query("""INSERT OR IGNORE INTO project_files(
          project_id,r2_key,file_name,relative_path,file_type,size_bytes,review_status,source_class,uploaded_at,updated_at
        ) VALUES(?,?,?,?,?,?,'BRAIN REVIEW REQUIRED','BRAIN SCAN HIGH RES RETRY SOURCE',?,?)""",
        [item["project_id"], key, item["id"] + ".png", relative, "image/png", image.stat().st_size, at, at])
        file_id = query("SELECT id FROM project_files WHERE r2_key=?", [key])[0]["id"]
        changed = query("""UPDATE holding_scan_items
          SET override_file_id=?,override_asset_role='HIGH_RES_REGION_RETRY',status='PENDING',error=NULL,updated_at=?
          WHERE id=? AND status='NEEDS_REVIEW' AND attempts>=4 AND override_file_id IS NULL
          RETURNING id""", [file_id, at, item["id"]])
        if not changed:
            raise RuntimeError("High-resolution retry target changed before release")
        print(json.dumps({
            "highResolutionRetry": "PENDING_MODEL_REVIEW",
            "scanItemId": item["id"],
            "sourceFileId": item["source_file_id"],
            "overrideFileId": file_id,
            "render": metadata,
        }), flush=True)


if __name__ == "__main__":
    main()

