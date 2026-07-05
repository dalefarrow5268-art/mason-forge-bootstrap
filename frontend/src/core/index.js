/**
 * Mason Forge™
 * Core Module Exports
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

import MasonCore from "./MasonCore";
import knowledgeService from "./KnowledgeService";

const masonCore = new MasonCore();

/*
|--------------------------------------------------------------------------
| Core Instance
|--------------------------------------------------------------------------
*/

export { masonCore };
export default masonCore;

/*
|--------------------------------------------------------------------------
| Core Services
|--------------------------------------------------------------------------
*/

export { knowledgeService };

/*
|--------------------------------------------------------------------------
| Core Event Definitions
|--------------------------------------------------------------------------
*/

export { default as KnowledgeEvents } from "./KnowledgeEvents";

/*
|--------------------------------------------------------------------------
| Core Classes
|--------------------------------------------------------------------------
*/

export { default as MasonCore } from "./MasonCore";
export { default as AIEngine } from "./AIEngine";
export { default as CoreHealth } from "./CoreHealth";
export { default as DashboardData } from "./DashboardData";
export { default as DashboardService } from "./DashboardService";
export { default as EventBus } from "./EventBus";
export { default as Logger } from "./Logger";
export { default as StateManager } from "./StateManager";

/*
|--------------------------------------------------------------------------
| Knowledge Engine
|--------------------------------------------------------------------------
*/

export { default as KnowledgeMemory } from "./KnowledgeMemory";
export { default as KnowledgeStore } from "./KnowledgeStore";
export { default as KnowledgeIndex } from "./KnowledgeIndex";
export { default as KnowledgeEngine } from "./KnowledgeEngine";
export { default as KnowledgeService } from "./KnowledgeService";