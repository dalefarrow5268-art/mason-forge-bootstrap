CREATE TABLE IF NOT EXISTS project_folders (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL,
  folder_path TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  UNIQUE(project_id, folder_path)
);
CREATE INDEX IF NOT EXISTS idx_project_folders_project_path ON project_folders(project_id, folder_path);
ALTER TABLE project_files ADD COLUMN archived_at TEXT;
ALTER TABLE project_files ADD COLUMN archived_from_status TEXT;
CREATE INDEX IF NOT EXISTS idx_project_files_active_path ON project_files(project_id, archived_at, relative_path);
