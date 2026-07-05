/**
 * Mason Forge™
 * DashboardData
 *
 * Supplies data for the Mission Control Dashboard.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import knowledgeService from "./KnowledgeService";

class DashboardData {
  constructor() {
    this.startedAt = new Date().toISOString();
  }

  /**
   * Dashboard cards.
   */
  getCards() {
    const health = knowledgeService.health();

    return [
      {
        id: "knowledge",
        title: "Knowledge Engine",
        value: knowledgeService.count(),
        status: health.status,
      },
      {
        id: "memory",
        title: "Memory Status",
        value: health.records,
        status: health.ready ? "Ready" : "Starting",
      },
      {
        id: "index",
        title: "Search Index",
        value: health.index.indexedRecords,
        status: health.index.status,
      },
      {
        id: "core",
        title: "Mason Core",
        value: "Online",
        status: "healthy",
      },
    ];
  }

  /**
   * Dashboard summary.
   */
  getSummary() {
    return {
      startedAt: this.startedAt,
      knowledgeRecords: knowledgeService.count(),
      knowledgeHealth: knowledgeService.health(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dashboard health.
   */
  health() {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
    };
  }
}

export default DashboardData;