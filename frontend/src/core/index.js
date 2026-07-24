/**
 * Mason Forge™
 * Core Module Exports
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import MasonCore from "./MasonCore";
import EventBus from "./EventBus";
import StateManager from "./StateManager";
import WorkflowCoordinator from "./WorkflowCoordinator";
import knowledgeService from "./KnowledgeService";

const masonCore = new MasonCore();

const initialAIWorkers = [
  { id: "MF-AI-001", name: "Mason Core", department: "Mission Control", role: "Engineering Conductor", status: "Online", currentJob: "Idle", health: 100 },
  { id: "MF-AI-002", name: "Knowledge Engine", department: "Memory", role: "Knowledge Specialist", status: "Online", currentJob: "Idle", health: 100 },
  { id: "MF-AI-003", name: "Build Engine", department: "Engineering", role: "Code Generation Specialist", status: "Online", currentJob: "Idle", health: 100 },
  { id: "MF-AI-004", name: "Validation Engine", department: "Quality Assurance", role: "Verification Specialist", status: "Online", currentJob: "Idle", health: 100 },
  { id: "MF-AI-005", name: "Deployment Engine", department: "Release Operations", role: "Deployment Specialist", status: "Online", currentJob: "Idle", health: 100 },
  { id: "MF-AI-006", name: "Dashboard Service", department: "User Interface", role: "Interface Operations Specialist", status: "Online", currentJob: "Idle", health: 100 },
  { id: "MF-AI-007", name: "Event Bus", department: "System Coordination", role: "Workflow Coordination Specialist", status: "Online", currentJob: "Idle", health: 100 },
];

const eventBus = new EventBus();

const stateManager = new StateManager({
  engineeringPlans: [],
  engineeringJobs: [],
  aiWorkers: initialAIWorkers,
  approvalQueue: [],
  prompts: [],
  gitChanges: [],
  verificationJobs: [],
  deployments: [],
  localAI: [],
});

const workflowCoordinator = new WorkflowCoordinator({ stateManager, eventBus });
workflowCoordinator.initialize();

export { masonCore };
export default masonCore;

export { eventBus, stateManager, workflowCoordinator, knowledgeService };

export { default as MasonCore } from "./MasonCore";
export { default as AIEngine } from "./AIEngine";
export { default as CoreHealth } from "./CoreHealth";
export { default as DashboardService } from "./DashboardService";
export { default as EventBus } from "./EventBus";
export { default as Logger } from "./Logger";
export { default as StateManager } from "./StateManager";
export { default as WorkflowCoordinator } from "./WorkflowCoordinator";

export { default as KnowledgeMemory } from "./KnowledgeMemory";
export { default as KnowledgeStore } from "./KnowledgeStore";
export { default as KnowledgeIndex } from "./KnowledgeIndex";
export { default as KnowledgeEngine } from "./KnowledgeEngine";
export { default as KnowledgeService } from "./KnowledgeService";

export const ForgeInfo = {
  name: "Mason Forge™",
  slogan: "Forge it once. Reuse it forever.™",
  mission: "Engineering Operating System for SubSource Exchange™",
  version: "0.5.0",
  milestone: "Milestone 4",
  environment: "Development",
  engineeringAgents: 7,
  engineeringJobs: 5,
  approvalQueue: 1,
  platformHealth: "Operational",
  systems: [
    "Mission Control",
    "Knowledge Engine",
    "Engineering Planner",
    "AI Workforce Manager",
    "Human Approval Queue",
    "Prompt Library",
    "Git Bridge",
    "VS Code Bridge",
    "Verification Engine",
    "Deployment Bridge",
    "Local AI Integration",
    "Shared Event Bus",
    "Shared State Manager",
    "Workflow Coordinator",
  ],
  motto: "We Build People.",
};
