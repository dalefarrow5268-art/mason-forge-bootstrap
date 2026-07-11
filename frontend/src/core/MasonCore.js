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
    this.version = "0.4.0";
    this.status = "Operational";
    this.ready = false;

    this.knowledge = knowledgeService;

    this.metrics = {
      engineeringAgents: 7,
      engineeringJobs: 5,
      approvalQueue: 1,
      platformHealth: "Operational",
      environment: "Development",
      deployment: "Local",
    };

    this.ai = {
      getStatus: () => "Ready",
    };

    this.health = () => ({
      status: this.status,
      version: this.version,
      ready: this.ready,
      knowledge: this.knowledge.health(),
      metrics: this.metrics,
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

    console.log("========================================");
    console.log(" Mason Forge™");
    console.log(" Engineering Operating System");
    console.log(` Version ${this.version}`);
    console.log("========================================");
    console.log("Core Status:", this.status);
    console.log("Knowledge Engine:", this.knowledge.isReady() ? "Ready" : "Offline");
    console.log("AI Systems:", this.metrics.engineeringAgents);
    console.log("Environment:", this.metrics.environment);

    return this.getStatus();
  }

  /*
  |--------------------------------------------------------------------------
  | Knowledge Interface
  |--------------------------------------------------------------------------
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

  /*
  |--------------------------------------------------------------------------
  | Core Status
  |--------------------------------------------------------------------------
  */

  getStatus() {
    return {
      version: this.version,
      status: this.status,
      ready: this.ready,

      metrics: this.metrics,

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