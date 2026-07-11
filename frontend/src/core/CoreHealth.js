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
    this.version = "0.4.0";
    this.services = new Map();
    this.startedAt = new Date().toISOString();
  }

  /*
  |--------------------------------------------------------------------------
  | Registration
  |--------------------------------------------------------------------------
  */

  register(name, service) {
    this.services.set(name, service);
  }

  unregister(name) {
    this.services.delete(name);
  }

  /*
  |--------------------------------------------------------------------------
  | Service Health
  |--------------------------------------------------------------------------
  */

  checkService(name) {
    const service = this.services.get(name);

    if (!service) {
      return {
        name,
        status: "Unknown",
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
      status: "Operational",
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Overall Health
  |--------------------------------------------------------------------------
  */

  check() {
    const services = [];

    for (const [name] of this.services) {
      services.push(this.checkService(name));
    }

    const operationalServices = services.filter(
      (service) =>
        service.status === "Operational" ||
        service.status === "healthy"
    );

    const warningServices = services.filter(
      (service) =>
        service.status !== "Operational" &&
        service.status !== "healthy"
    );

    return {
      version: this.version,

      status:
        warningServices.length === 0
          ? "Operational"
          : "Warning",

      startedAt: this.startedAt,

      registeredServices: services.length,

      operationalServices: operationalServices.length,

      warningServices: warningServices.length,

      services,

      timestamp: new Date().toISOString(),
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Dashboard Summary
  |--------------------------------------------------------------------------
  */

  summary() {
    const report = this.check();

    return {
      version: report.version,
      status: report.status,

      registeredServices: report.registeredServices,

      operationalServices: report.operationalServices,

      warningServices: report.warningServices,

      uptime: report.startedAt,

      timestamp: report.timestamp,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Alias
  |--------------------------------------------------------------------------
  */

  health() {
    return this.check();
  }
}

export default CoreHealth;