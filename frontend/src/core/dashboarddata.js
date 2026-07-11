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
    this.version = "0.4.0";
  }

  /*
  |--------------------------------------------------------------------------
  | Dashboard Cards
  |--------------------------------------------------------------------------
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
        value: "Operational",
        status: "Online",
      },
      {
        id: "planner",
        title: "Engineering Planner",
        value: "Ready",
        status: "Operational",
      },
      {
        id: "workforce",
        title: "AI Workforce",
        value: 7,
        status: "Online",
      },
      {
        id: "jobs",
        title: "Engineering Jobs",
        value: 5,
        status: "Active",
      },
      {
        id: "approval",
        title: "Approval Queue",
        value: 1,
        status: "Pending",
      },
      {
        id: "verification",
        title: "Verification",
        value: "Ready",
        status: "Operational",
      },
      {
        id: "deployment",
        title: "Deployment",
        value: "Ready",
        status: "Operational",
      },
      {
        id: "local-ai",
        title: "Local AI",
        value: "Waiting",
        status: "Offline",
      },
      {
        id: "platform",
        title: "Platform Health",
        value: "Operational",
        status: "Healthy",
      },
    ];
  }

  /*
  |--------------------------------------------------------------------------
  | Dashboard Summary
  |--------------------------------------------------------------------------
  */

  getSummary() {
    return {
      startedAt: this.startedAt,
      version: this.version,

      mission: "Engineering Operating System",
      platform: "SubSource Exchange™",

      milestone: "Milestone 3",

      engineeringSystems: 11,
      engineeringAgents: 7,
      engineeringJobs: 5,

      approvalQueue: 1,

      knowledgeRecords: knowledgeService.count(),
      knowledgeHealth: knowledgeService.health(),

      timestamp: new Date().toISOString(),
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Dashboard Health
  |--------------------------------------------------------------------------
  */

  health() {
    return {
      status: "Operational",
      dashboard: "DashboardData",
      version: this.version,
      timestamp: new Date().toISOString(),
    };
  }
}

export default DashboardData;