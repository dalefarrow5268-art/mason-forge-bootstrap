/**
 * Mason Forge™
 * KnowledgeStore
 *
 * Persistent storage abstraction for the Knowledge Engine.
 *
 * Current backend:
 * - KnowledgeMemory
 *
 * Future backends:
 * - IndexedDB
 * - SQLite
 * - PostgreSQL
 * - Cloud Storage
 * - Vector Databases
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import KnowledgeMemory from "./KnowledgeMemory";

class KnowledgeStore {
  constructor(memory = new KnowledgeMemory()) {
    this.memory = memory;
  }

  /*
  |--------------------------------------------------------------------------
  | CRUD Operations
  |--------------------------------------------------------------------------
  */

  save(key, value, metadata = {}) {
    return this.memory.set(key, value, metadata);
  }

  load(key) {
    return this.memory.get(key);
  }

  exists(key) {
    return this.memory.has(key);
  }

  remove(key) {
    return this.memory.delete(key);
  }

  /*
  |--------------------------------------------------------------------------
  | Collection Operations
  |--------------------------------------------------------------------------
  */

  all() {
    return this.memory.getAll();
  }

  keys() {
    return this.memory.keys();
  }

  count() {
    return this.memory.size();
  }

  clear() {
    this.memory.clear();
  }

  /*
  |--------------------------------------------------------------------------
  | Import / Export
  |--------------------------------------------------------------------------
  */

  export() {
    return this.memory.export();
  }

  import(data = []) {
    return this.memory.import(data);
  }

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  */

  search(query = "") {
    const q = query.toLowerCase();

    return this.all().filter((record) => {
      if (record.key.toLowerCase().includes(q)) return true;

      if (
        typeof record.value === "string" &&
        record.value.toLowerCase().includes(q)
      ) {
        return true;
      }

      if (
        record.metadata &&
        JSON.stringify(record.metadata).toLowerCase().includes(q)
      ) {
        return true;
      }

      return false;
    });
  }

  /*
  |--------------------------------------------------------------------------
  | Statistics
  |--------------------------------------------------------------------------
  */

  stats() {
    return {
      backend: "KnowledgeMemory",
      records: this.count(),
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
      backend: "KnowledgeMemory",
      records: this.count(),
      statistics: this.stats(),
      timestamp: new Date().toISOString(),
    };
  }
}

export default KnowledgeStore;