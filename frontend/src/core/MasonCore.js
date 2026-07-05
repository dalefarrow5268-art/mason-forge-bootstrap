/**
 * Mason Forge™
 * MasonCore
 *
 * Central orchestration layer for Mason Forge.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import knowledgeService from "./KnowledgeService";

class MasonCore {
  constructor() {
    this.version = "0.2.0";
    this.status = "healthy";
    this.ready = false;

    this.knowledge = knowledgeService;

    this.ai = {
      getStatus: () => "Ready",
    };

    this.health = () => ({
      status: this.status,
      version: this.version,
      ready: this.ready,
      knowledge: this.knowledge.health(),
      timestamp: new Date().toISOString(),
    });

    this.health.check = () => ({
      status: this.status,
      message: "Mason Forge core systems online.",
      timestamp: new Date().toISOString(),
    });

    this.initialize();
  }

  initialize() {
    this.ready = true;

    console.log("MasonCore initialized.");

    return this.getStatus();
  }

  /**
   * Knowledge Interface
   */

  remember(key, value, metadata = {}) {
    return this.knowledge.remember(key, value, metadata);
  }

  recall(key) {
    return this.knowledge.recall(key);
  }

  exists(key) {
    return this.knowledge.exists(key);
  }

  searchKnowledge(query = "") {
    return this.knowledge.search(query);
  }

  forget(key) {
    return this.knowledge.forget(key);
  }

  knowledgeHealth() {
    return this.knowledge.health();
  }

  knowledgeCount() {
    return this.knowledge.count();
  }

  /**
   * Core Status
   */

  getStatus() {
    return {
      version: this.version,
      status: this.status,
      ready: this.ready,
      knowledge: {
        ready: this.knowledge.isReady(),
        records: this.knowledge.count(),
        health: this.knowledge.health(),
      },
      timestamp: new Date().toISOString(),
    };
  }
}

export default MasonCore;