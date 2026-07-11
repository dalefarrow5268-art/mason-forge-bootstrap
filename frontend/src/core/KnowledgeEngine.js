/**
 * Mason Forge™
 * KnowledgeEngine
 *
 * Central coordinator for the Mason Forge Knowledge System.
 *
 * Responsibilities:
 * - Store knowledge
 * - Retrieve knowledge
 * - Index knowledge
 * - Search knowledge
 * - Import / Export
 * - Health reporting
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import KnowledgeStore from "./KnowledgeStore";
import KnowledgeIndex from "./KnowledgeIndex";

class KnowledgeEngine {
  constructor({
    store = new KnowledgeStore(),
    index = new KnowledgeIndex(),
  } = {}) {
    this.store = store;
    this.index = index;

    this.ready = false;

    this.statistics = {
      searches: 0,
      remembers: 0,
      recalls: 0,
      lastUpdated: null,
    };

    this.rebuildIndex();

    this.ready = true;
  }

  isReady() {
    return this.ready;
  }

  /*
  |--------------------------------------------------------------------------
  | Knowledge Operations
  |--------------------------------------------------------------------------
  */

  remember(key, value, metadata = {}) {
    const record = this.store.save(key, value, metadata);

    this.index.index(record);

    this.statistics.remembers++;
    this.statistics.lastUpdated = new Date().toISOString();

    return record;
  }

  recall(key) {
    this.statistics.recalls++;

    return this.store.load(key);
  }

  exists(key) {
    return this.store.exists(key);
  }

  forget(key) {
    this.index.remove(key);

    this.statistics.lastUpdated = new Date().toISOString();

    return this.store.remove(key);
  }

  search(query = "") {
    this.statistics.searches++;

    const matches = this.index.search(query);

    return matches
      .map((match) => {
        const record = this.store.load(match.key);

        if (!record) return null;

        return {
          ...record,
          score: match.score,
        };
      })
      .filter(Boolean);
  }

  /*
  |--------------------------------------------------------------------------
  | Storage
  |--------------------------------------------------------------------------
  */

  all() {
    return this.store.all();
  }

  count() {
    return this.store.count();
  }

  rebuildIndex() {
    this.index.rebuild(this.store.all());
  }

  clear() {
    this.store.clear();
    this.index.clear();

    this.statistics.lastUpdated = new Date().toISOString();
  }

  /*
  |--------------------------------------------------------------------------
  | Import / Export
  |--------------------------------------------------------------------------
  */

  export() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      records: this.store.export(),
      index: this.index.export(),
    };
  }

  import(data = {}) {
    this.store.import(data.records || []);

    if (Array.isArray(data.index)) {
      this.index.import(data.index);
    } else {
      this.rebuildIndex();
    }

    this.statistics.lastUpdated = new Date().toISOString();

    return this.count();
  }

  /*
  |--------------------------------------------------------------------------
  | Statistics
  |--------------------------------------------------------------------------
  */

  metrics() {
    return {
      ...this.statistics,
      records: this.count(),
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Health
  |--------------------------------------------------------------------------
  */

  health() {
    return {
      status: this.ready ? "Operational" : "Starting",
      ready: this.ready,
      engine: "KnowledgeEngine",
      records: this.count(),
      metrics: this.metrics(),
      store: this.store.health(),
      index: this.index.health(),
      timestamp: new Date().toISOString(),
    };
  }
}

export default KnowledgeEngine;