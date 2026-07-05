/**
 * Mason Forge™
 * StateManager
 *
 * Central application state manager.
 *
 * Forge it once. Reuse it forever.™
 * We Build People.
 */

class StateManager {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.listeners = new Map();
  }

  /**
   * Get a value from state.
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Set a value in state.
   */
  set(key, value) {
    this.state[key] = value;

    this.notify(key, value);

    return value;
  }

  /**
   * Check if a key exists.
   */
  has(key) {
    return Object.prototype.hasOwnProperty.call(this.state, key);
  }

  /**
   * Remove a key.
   */
  remove(key) {
    if (!this.has(key)) {
      return false;
    }

    delete this.state[key];

    this.notify(key, undefined);

    return true;
  }

  /**
   * Return a copy of the current state.
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Replace the entire state.
   */
  replace(newState = {}) {
    this.state = { ...newState };

    Object.keys(this.state).forEach((key) => {
      this.notify(key, this.state[key]);
    });

    return this.getState();
  }

  /**
   * Subscribe to changes for a key.
   */
  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }

    this.listeners.get(key).push(callback);

    return () => this.unsubscribe(key, callback);
  }

  /**
   * Remove a subscription.
   */
  unsubscribe(key, callback) {
    if (!this.listeners.has(key)) {
      return;
    }

    const callbacks = this.listeners
      .get(key)
      .filter((listener) => listener !== callback);

    this.listeners.set(key, callbacks);
  }

  /**
   * Notify listeners.
   */
  notify(key, value) {
    if (!this.listeners.has(key)) {
      return;
    }

    this.listeners.get(key).forEach((callback) => {
      try {
        callback(value, key);
      } catch (error) {
        console.error(
          `[StateManager] Error notifying listeners for "${key}"`,
          error
        );
      }
    });
  }

  /**
   * Clear all state and listeners.
   */
  clear() {
    this.state = {};
    this.listeners.clear();
  }

  /**
   * Health check.
   */
  health() {
    return {
      status: "healthy",
      keys: Object.keys(this.state).length,
      subscriptions: this.listeners.size,
      timestamp: new Date().toISOString(),
    };
  }
}

export default StateManager;