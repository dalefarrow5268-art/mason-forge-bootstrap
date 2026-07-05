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
  }

  add(level, message, data = null) {
    const entry = {
      id: Date.now() + Math.random(),
      level,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
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

  getLogs(level = null) {
    if (!level) {
      return [...this.logs];
    }

    return this.logs.filter((log) => log.level === level);
  }

  clear() {
    this.logs = [];
  }

  count() {
    return this.logs.length;
  }

  health() {
    return {
      status: "healthy",
      entries: this.logs.length,
      maxEntries: this.maxLogs,
      timestamp: new Date().toISOString(),
    };
  }
}

export default Logger;