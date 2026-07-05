/**
 * Mason Forge™
 * CoreHealth
 *
 * Monitors the health of Mason Forge core services.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

class CoreHealth {
  constructor() {
    this.services = new Map();
  }

  /**
   * Register a service for health monitoring.
   */
  register(name, service) {
    this.services.set(name, service);
  }

  /**
   * Check a single service.
   */
  checkService(name) {
    const service = this.services.get(name);

    if (!service) {
      return {
        name,
        status: "unknown",
      };
    }

    if (typeof service.health === "function") {
      return {
        name,
        ...service.health(),
      };
    }

    return {
      name,
      status: "healthy",
    };
  }

  /**
   * Check all registered services.
   */
  check() {
    const services = [];

    for (const [name] of this.services) {
      services.push(this.checkService(name));
    }

    return {
      status: services.every((s) => s.status === "healthy")
        ? "healthy"
        : "warning",
      services,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Alias used throughout Mason Forge.
   */
  health() {
    return this.check();
  }
}

export default CoreHealth;