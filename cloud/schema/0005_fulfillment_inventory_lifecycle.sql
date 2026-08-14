CREATE TABLE IF NOT EXISTS fulfillment_inventory_history (
  id TEXT PRIMARY KEY,
  inventory_number TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('RECLASSIFY', 'ARCHIVE', 'RESTORE')),
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (inventory_number) REFERENCES fulfillment_inventory(inventory_number),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_history_item
  ON fulfillment_inventory_history(inventory_number, created_at);

CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_history_project
  ON fulfillment_inventory_history(project_id, action, created_at);
