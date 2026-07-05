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

    this.rebuildIndex();

    this.ready = true;
  }

  isReady() {
    return this.ready;
  }

  /**
   * Store knowledge.
   */
  remember(key, value, metadata = {}) {
    const record = this.store.save(key, value, metadata);

    this.index.index(record);

    return record;
  }

  /**
   * Retrieve knowledge.
   */
  recall(key) {
    return this.store.load(key);
  }

  /**
   * Determine if knowledge exists.
   */
  exists(key) {
    return this.store.exists(key);
  }

  /**
   * Remove knowledge.
   */
  forget(key) {
    this.index.remove(key);

    return this.store.remove(key);
  }

  /**
   * Search indexed knowledge.
   */
  search(query = "") {
    const matches = this.index.search(query);

    return matches
      .map((match) => {
        const record = this.store.load(match.key);

        if (!record) {
          return null;
        }

        return {
          ...record,
          score: match.score,
        };
      })
      .filter(Boolean);
  }

  /**
   * Return all knowledge.
   */
  all() {
    return this.store.all();
  }

  /**
   * Number of stored records.
   */
  count() {
    return this.store.count();
  }

  /**
   * Rebuild the search index.
   */
  rebuildIndex() {
    this.index.rebuild(this.store.all());
  }

  /**
   * Remove everything.
   */
  clear() {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Export engine state.
   */
  export() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      records: this.store.export(),
      index: this.index.export(),
    };
  }

  /**
   * Import engine state.
   */
  import(data = {}) {
    this.store.import(data.records || []);

    if (Array.isArray(data.index)) {
      this.index.import(data.index);
    } else {
      this.rebuildIndex();
    }

    return this.count();
  }

  /**
   * Engine health.
   */
  health() {
    return {
      status: this.ready ? "healthy" : "starting",
      ready: this.ready,
      engine: "KnowledgeEngine",
      records: this.count(),
      store: this.store.health(),
      index: this.index.health(),
      timestamp: new Date().toISOString(),
    };
  }
}

export default KnowledgeEngine;