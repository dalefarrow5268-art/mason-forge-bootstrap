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
    this.globalListeners = [];
    this.history = [];

    this.metrics = {
      updates: 0,
      subscriptions: 0,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | State Access
  |--------------------------------------------------------------------------
  */

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    const previousValue = this.state[key];

    this.state[key] = value;

    this.recordHistory({
      action: "set",
      key,
      previousValue,
      value,
    });

    this.metrics.updates++;

    this.notify(key, value, previousValue);

    return value;
  }

  update(key, updater) {
    if (typeof updater !== "function") {
      throw new TypeError(
        `[StateManager] Update for "${key}" requires a function.`
      );
    }

    const previousValue = this.state[key];
    const nextValue = updater(previousValue);

    return this.set(key, nextValue);
  }

  merge(values = {}) {
    if (
      !values ||
      typeof values !== "object" ||
      Array.isArray(values)
    ) {
      throw new TypeError(
        "[StateManager] Merge requires a plain object."
      );
    }

    Object.entries(values).forEach(([key, value]) => {
      this.set(key, value);
    });

    return this.getState();
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.state, key);
  }

  remove(key) {
    if (!this.has(key)) {
      return false;
    }

    const previousValue = this.state[key];

    delete this.state[key];

    this.recordHistory({
      action: "remove",
      key,
      previousValue,
      value: undefined,
    });

    this.metrics.updates++;

    this.notify(key, undefined, previousValue);

    return true;
  }

  getState() {
    return { ...this.state };
  }

  replace(newState = {}) {
    if (
      !newState ||
      typeof newState !== "object" ||
      Array.isArray(newState)
    ) {
      throw new TypeError(
        "[StateManager] Replace requires a plain object."
      );
    }

    const previousState = this.getState();

    this.state = { ...newState };

    this.recordHistory({
      action: "replace",
      key: "*",
      previousValue: previousState,
      value: this.getState(),
    });

    this.metrics.updates++;

    const keys = new Set([
      ...Object.keys(previousState),
      ...Object.keys(this.state),
    ]);

    keys.forEach((key) => {
      this.notify(
        key,
        this.state[key],
        previousState[key]
      );
    });

    return this.getState();
  }

  /*
  |--------------------------------------------------------------------------
  | Subscriptions
  |--------------------------------------------------------------------------
  */

  subscribe(key, callback) {
    if (typeof callback !== "function") {
      throw new TypeError(
        `[StateManager] Subscription for "${key}" requires a function.`
      );
    }

    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }

    this.listeners.get(key).push(callback);

    this.updateSubscriptionMetrics();

    return () => this.unsubscribe(key, callback);
  }

  subscribeAll(callback) {
    if (typeof callback !== "function") {
      throw new TypeError(
        "[StateManager] Global subscription requires a function."
      );
    }

    this.globalListeners.push(callback);

    this.updateSubscriptionMetrics();

    return () => this.unsubscribeAll(callback);
  }

  unsubscribe(key, callback) {
    if (!this.listeners.has(key)) {
      return;
    }

    const callbacks = this.listeners
      .get(key)
      .filter((listener) => listener !== callback);

    if (callbacks.length === 0) {
      this.listeners.delete(key);
    } else {
      this.listeners.set(key, callbacks);
    }

    this.updateSubscriptionMetrics();
  }

  unsubscribeAll(callback) {
    this.globalListeners = this.globalListeners.filter(
      (listener) => listener !== callback
    );

    this.updateSubscriptionMetrics();
  }

  notify(key, value, previousValue) {
    const keyedListeners = this.listeners.get(key) ?? [];

    [...keyedListeners].forEach((callback) => {
      try {
        callback(value, key, previousValue);
      } catch (error) {
        console.error(
          `[StateManager] Error notifying listeners for "${key}"`,
          error
        );
      }
    });

    [...this.globalListeners].forEach((callback) => {
      try {
        callback({
          key,
          value,
          previousValue,
          state: this.getState(),
        });
      } catch (error) {
        console.error(
          "[StateManager] Error notifying global listeners",
          error
        );
      }
    });
  }

  updateSubscriptionMetrics() {
    const keyedSubscriptions = [...this.listeners.values()].reduce(
      (count, list) => count + list.length,
      0
    );

    this.metrics.subscriptions =
      keyedSubscriptions + this.globalListeners.length;
  }

  /*
  |--------------------------------------------------------------------------
  | History
  |--------------------------------------------------------------------------
  */

  recordHistory(entry) {
    this.history.unshift({
      id: `STATE-${Date.now()}-${this.metrics.updates + 1}`,
      ...entry,
      timestamp: new Date().toISOString(),
    });

    this.history = this.history.slice(0, 250);
  }

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

  clearState() {
    const previousState = this.getState();

    this.state = {};

    this.recordHistory({
      action: "clear",
      key: "*",
      previousValue: previousState,
      value: {},
    });

    this.metrics.updates++;

    Object.keys(previousState).forEach((key) => {
      this.notify(key, undefined, previousState[key]);
    });
  }

  clear() {
    this.state = {};
    this.listeners.clear();
    this.globalListeners = [];
    this.history = [];

    this.metrics.updates = 0;
    this.metrics.subscriptions = 0;
  }

  getMetrics() {
    return {
      ...this.metrics,
      keys: Object.keys(this.state).length,
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
      keys: Object.keys(this.state).length,
      subscriptions: this.metrics.subscriptions,
      updates: this.metrics.updates,
      historySize: this.history.length,
      timestamp: new Date().toISOString(),
    };
  }

  getHealth() {
    return this.health();
  }
}

export default StateManager;