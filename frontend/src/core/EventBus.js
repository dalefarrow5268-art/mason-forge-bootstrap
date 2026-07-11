/**
 * Mason Forge™
 * EventBus
 *
 * Lightweight publish / subscribe event system.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

class EventBus {
  constructor() {
    this.events = new Map();
    this.history = [];

    this.metrics = {
      emitted: 0,
      listeners: 0,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Subscription
  |--------------------------------------------------------------------------
  */

  on(eventName, callback) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, []);
    }

    this.events.get(eventName).push(callback);
    this.updateListenerMetric();

    return () => this.off(eventName, callback);
  }

  once(eventName, callback) {
    const wrapper = (payload) => {
      callback(payload);
      this.off(eventName, wrapper);
    };

    return this.on(eventName, wrapper);
  }

  off(eventName, callback) {
    if (!this.events.has(eventName)) {
      return;
    }

    const listeners = this.events
      .get(eventName)
      .filter((listener) => listener !== callback);

    if (listeners.length === 0) {
      this.events.delete(eventName);
    } else {
      this.events.set(eventName, listeners);
    }

    this.updateListenerMetric();
  }

  updateListenerMetric() {
    this.metrics.listeners = [...this.events.values()].reduce(
      (count, listeners) => count + listeners.length,
      0
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Publishing
  |--------------------------------------------------------------------------
  */

  emit(eventName, payload = {}) {
    const eventRecord = {
      id: `EVENT-${Date.now()}-${this.metrics.emitted + 1}`,
      event: eventName,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.history.unshift(eventRecord);
    this.history = this.history.slice(0, 250);
    this.metrics.emitted++;

    const listeners = this.events.get(eventName) ?? [];

    [...listeners].forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(
          `[EventBus] Error handling "${eventName}"`,
          error
        );
      }
    });

    const globalListeners = this.events.get("*") ?? [];

    [...globalListeners].forEach((listener) => {
      try {
        listener(eventRecord);
      } catch (error) {
        console.error(
          `[EventBus] Error handling global event "${eventName}"`,
          error
        );
      }
    });

    return eventRecord;
  }

  /*
  |--------------------------------------------------------------------------
  | Event History
  |--------------------------------------------------------------------------
  */

  getHistory(limit = 25) {
    return this.history.slice(0, limit);
  }

  clearHistory() {
    this.history = [];
  }

  /*
  |--------------------------------------------------------------------------
  | Utilities
  |--------------------------------------------------------------------------
  */

  clear() {
    this.events.clear();
    this.history = [];

    this.metrics.listeners = 0;
    this.metrics.emitted = 0;
  }

  getEvents() {
    return [...this.events.keys()];
  }

  getMetrics() {
    return {
      ...this.metrics,
      registeredEvents: this.events.size,
      historySize: this.history.length,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Health
  |--------------------------------------------------------------------------
  */

  health() {
    return {
      status: "Operational",
      health: 100,
      registeredEvents: this.events.size,
      listeners: this.metrics.listeners,
      eventsEmitted: this.metrics.emitted,
      historySize: this.history.length,
      timestamp: new Date().toISOString(),
    };
  }

  getHealth() {
    return this.health();
  }
}

export default EventBus;