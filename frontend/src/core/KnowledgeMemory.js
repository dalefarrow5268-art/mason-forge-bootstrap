/**
 * Mason Forge™
 * KnowledgeMemory
 *
 * Lightweight in-memory storage used by the Knowledge Engine.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

class KnowledgeMemory {
  constructor() {
    this.records = new Map();
  }

  /*
  |--------------------------------------------------------------------------
  | CRUD Operations
  |--------------------------------------------------------------------------
  */

  set(key, value, metadata = {}) {
    if (!key) {
      throw new Error("Knowledge key is required.");
    }

    const now = new Date().toISOString();
    const existing = this.records.get(key);

    const record = {
      key,
      value,
      metadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      accessCount: existing?.accessCount ?? 0,
      lastAccessed: existing?.lastAccessed ?? null,
    };

    this.records.set(key, record);

    return record;
  }

  get(key) {
    const record = this.records.get(key);

    if (!record) {
      return null;
    }

    record.accessCount++;
    record.lastAccessed = new Date().toISOString();

    return record;
  }

  has(key) {
    return this.records.has(key);
  }

  delete(key) {
    return this.records.delete(key);
  }

  /*
  |--------------------------------------------------------------------------
  | Collection Operations
  |--------------------------------------------------------------------------
  */

  getAll() {
    return [...this.records.values()];
  }

  keys() {
    return [...this.records.keys()];
  }

  size() {
    return this.records.size;
  }

  clear() {
    this.records.clear();
  }

  /*
  |--------------------------------------------------------------------------
  | Import / Export
  |--------------------------------------------------------------------------
  */

  export() {
    return this.getAll();
  }

  import(records = []) {
    this.clear();

    records.forEach((record) => {
      if (record?.key) {
        this.records.set(record.key, record);
      }
    });

    return this.size();
  }

  /*
  |--------------------------------------------------------------------------
  | Statistics
  |--------------------------------------------------------------------------
  */

  stats() {
    return {
      records: this.size(),
      keys: this.keys().length,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Health
  |--------------------------------------------------------------------------
  */

  health() {
    return {
      status: "Operational",
      backend: "In Memory",
      records: this.size(),
      statistics: this.stats(),
      timestamp: new Date().toISOString(),
    };
  }
}

export default KnowledgeMemory;