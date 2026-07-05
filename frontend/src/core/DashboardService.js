/**
 * Mason Forge™
 * DashboardService
 *
 * Provides dashboard status and summary information.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import knowledgeService from "./KnowledgeService";

class DashboardService {
  constructor() {
    this.startedAt = new Date().toISOString();
  }

  /**
   * Dashboard status.
   */
  status() {
    return {
      status: "Ready",
      uptime: this.startedAt,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dashboard summary.
   */
  summary() {
    return {
      core: "Healthy",
      knowledge: knowledgeService.health().status,
      knowledgeRecords: knowledgeService.count(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dashboard metrics.
   */
  metrics() {
    return {
      knowledgeRecords: knowledgeService.count(),
      knowledgeReady: knowledgeService.isReady(),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Dashboard health.
   */
  health() {
    return {
      status: "healthy",
      dashboard: "DashboardService",
      timestamp: new Date().toISOString(),
    };
  }
}

export default DashboardService;