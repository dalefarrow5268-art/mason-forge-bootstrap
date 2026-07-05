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
  }

  /**
   * Subscribe to an event.
   */
  on(eventName, callback) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, []);
    }

    this.events.get(eventName).push(callback);

    return () => this.off(eventName, callback);
  }

  /**
   * Subscribe once.
   */
  once(eventName, callback) {
    const wrapper = (payload) => {
      callback(payload);
      this.off(eventName, wrapper);
    };

    this.on(eventName, wrapper);
  }

  /**
   * Remove a listener.
   */
  off(eventName, callback) {
    if (!this.events.has(eventName)) {
      return;
    }

    const listeners = this.events
      .get(eventName)
      .filter((listener) => listener !== callback);

    this.events.set(eventName, listeners);
  }

  /**
   * Emit an event.
   */
  emit(eventName, payload = {}) {
    if (!this.events.has(eventName)) {
      return;
    }

    this.events.get(eventName).forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(
          `[EventBus] Error handling "${eventName}"`,
          error
        );
      }
    });
  }

  /**
   * Remove all listeners.
   */
  clear() {
    this.events.clear();
  }

  /**
   * Return registered events.
   */
  getEvents() {
    return [...this.events.keys()];
  }

  /**
   * Health check.
   */
  health() {
    return {
      status: "healthy",
      registeredEvents: this.events.size,
      timestamp: new Date().toISOString(),
    };
  }
}

export default EventBus;