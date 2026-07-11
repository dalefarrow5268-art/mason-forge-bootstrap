/**
 * Mason Forge™
 * Logger
 *
 * Central logging service for Mason Forge.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

class Logger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;

    this.metrics = {
      info: 0,
      warn: 0,
      error: 0,
      debug: 0,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Core Logging
  |--------------------------------------------------------------------------
  */

  add(level, message, data = null) {
    const entry = {
      id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    if (this.metrics[level] !== undefined) {
      this.metrics[level]++;
    }

    return entry;
  }

  info(message, data = null) {
    console.log(message, data ?? "");
    return this.add("info", message, data);
  }

  warn(message, data = null) {
    console.warn(message, data ?? "");
    return this.add("warn", message, data);
  }

  error(message, data = null) {
    console.error(message, data ?? "");
    return this.add("error", message, data);
  }

  debug(message, data = null) {
    console.debug(message, data ?? "");
    return this.add("debug", message, data);
  }

  /*
  |--------------------------------------------------------------------------
  | Retrieval
  |--------------------------------------------------------------------------
  */

  getLogs(level = null) {
    if (!level) {
      return [...this.logs];
    }

    return this.logs.filter((log) => log.level === level);
  }

  latest(count = 10) {
    return this.logs.slice(-count).reverse();
  }

  clear() {
    this.logs = [];
  }

  count() {
    return this.logs.length;
  }

  /*
  |--------------------------------------------------------------------------
  | Health
  |--------------------------------------------------------------------------
  */

  health() {
    return {
      status: "Operational",
      entries: this.logs.length,
      maxEntries: this.maxLogs,
      metrics: this.metrics,
      timestamp: new Date().toISOString(),
    };
  }
}

export default Logger;