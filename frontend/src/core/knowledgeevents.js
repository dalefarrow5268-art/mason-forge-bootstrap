/**
 * Mason Forge™
 * KnowledgeEvents
 *
 * Standard event definitions for the Knowledge Engine.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

const KnowledgeEvents = Object.freeze({
  /*
  |--------------------------------------------------------------------------
  | Engine
  |--------------------------------------------------------------------------
  */

  ENGINE_INITIALIZED: "knowledge:engine:initialized",
  ENGINE_READY: "knowledge:engine:ready",
  ENGINE_SHUTDOWN: "knowledge:engine:shutdown",
  ENGINE_ERROR: "knowledge:engine:error",

  /*
  |--------------------------------------------------------------------------
  | Memory
  |--------------------------------------------------------------------------
  */

  MEMORY_STORED: "knowledge:memory:stored",
  MEMORY_UPDATED: "knowledge:memory:updated",
  MEMORY_DELETED: "knowledge:memory:deleted",
  MEMORY_CLEARED: "knowledge:memory:cleared",

  /*
  |--------------------------------------------------------------------------
  | Search
  |--------------------------------------------------------------------------
  */

  SEARCH_STARTED: "knowledge:search:started",
  SEARCH_COMPLETED: "knowledge:search:completed",
  SEARCH_FAILED: "knowledge:search:failed",

  /*
  |--------------------------------------------------------------------------
  | Index
  |--------------------------------------------------------------------------
  */

  INDEX_STARTED: "knowledge:index:started",
  INDEX_COMPLETED: "knowledge:index:completed",
  INDEX_FAILED: "knowledge:index:failed",
  INDEX_REBUILT: "knowledge:index:rebuilt",

  /*
  |--------------------------------------------------------------------------
  | Import / Export
  |--------------------------------------------------------------------------
  */

  IMPORT_STARTED: "knowledge:import:started",
  IMPORT_COMPLETED: "knowledge:import:completed",
  EXPORT_STARTED: "knowledge:export:started",
  EXPORT_COMPLETED: "knowledge:export:completed",

  /*
  |--------------------------------------------------------------------------
  | Dashboard
  |--------------------------------------------------------------------------
  */

  DASHBOARD_REFRESHED: "dashboard:refreshed",
  DASHBOARD_UPDATED: "dashboard:updated",

  /*
  |--------------------------------------------------------------------------
  | Health
  |--------------------------------------------------------------------------
  */

  HEALTH_CHANGED: "knowledge:health:changed",

  /*
  |--------------------------------------------------------------------------
  | General
  |--------------------------------------------------------------------------
  */

  ERROR: "knowledge:error",
  WARNING: "knowledge:warning",
  INFO: "knowledge:info",
});

export default KnowledgeEvents;