/**
 * Mason Forge™
 * KnowledgeService
 *
 * Stable interface between MasonCore and the Knowledge Engine.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import KnowledgeEngine from "./KnowledgeEngine";

class KnowledgeService {
  constructor() {
    this.engine = new KnowledgeEngine();
  }

  /*
  |--------------------------------------------------------------------------
  | Engine Status
  |--------------------------------------------------------------------------
  */

  isReady() {
    return this.engine.isReady();
  }

  health() {
    return this.engine.health();
  }

  /*
  |--------------------------------------------------------------------------
  | Knowledge Operations
  |--------------------------------------------------------------------------
  */

  remember(key, value, metadata = {}) {
    return this.engine.remember(key, value, metadata);
  }

  recall(key) {
    return this.engine.recall(key);
  }

  exists(key) {
    return this.engine.exists(key);
  }

  search(query = "") {
    return this.engine.search(query);
  }

  forget(key) {
    return this.engine.forget(key);
  }

  /*
  |--------------------------------------------------------------------------
  | Storage
  |--------------------------------------------------------------------------
  */

  all() {
    return this.engine.all();
  }

  count() {
    return this.engine.count();
  }

  clear() {
    this.engine.clear();
  }

  /*
  |--------------------------------------------------------------------------
  | Backup / Restore
  |--------------------------------------------------------------------------
  */

  export() {
    return this.engine.export();
  }

  import(data) {
    return this.engine.import(data);
  }

  rebuildIndex() {
    this.engine.rebuildIndex();
  }

  /*
  |--------------------------------------------------------------------------
  | Dashboard Helpers
  |--------------------------------------------------------------------------
  */

  summary() {
    return {
      ready: this.isReady(),
      records: this.count(),
      health: this.health(),
    };
  }
}

const knowledgeService = new KnowledgeService();

export default knowledgeService;