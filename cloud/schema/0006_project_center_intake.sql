CREATE TABLE IF NOT EXISTS project_center_intake (
 id TEXT PRIMARY KEY,
 owner TEXT NOT NULL,
 client_project TEXT NOT NULL,
 name TEXT NOT NULL,
 relative_path TEXT NOT NULL,
 r2_key TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL,
 upload_id TEXT,
 revision TEXT NOT NULL DEFAULT '',
 issued TEXT NOT NULL DEFAULT '',
 created TEXT NOT NULL,
 file_id INTEGER,
 status TEXT NOT NULL DEFAULT 'PENDING'
);
CREATE INDEX IF NOT EXISTS project_center_intake_owner_project ON project_center_intake(owner,client_project,status);
