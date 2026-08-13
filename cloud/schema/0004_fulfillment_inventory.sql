CREATE TABLE IF NOT EXISTS fulfillment_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_number TEXT UNIQUE,
  project_id INTEGER NOT NULL,
  item_type TEXT NOT NULL,
  item_name TEXT NOT NULL,
  parent_inventory_number TEXT,
  csi_code TEXT,
  folder_path TEXT,
  source_file_id INTEGER,
  description TEXT,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (parent_inventory_number) REFERENCES fulfillment_inventory(inventory_number),
  FOREIGN KEY (source_file_id) REFERENCES project_files(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_inventory_number
  ON fulfillment_inventory(inventory_number);
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_project_type
  ON fulfillment_inventory(project_id, item_type, status);
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_parent
  ON fulfillment_inventory(parent_inventory_number);
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_csi
  ON fulfillment_inventory(csi_code);
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_source
  ON fulfillment_inventory(source_file_id);
