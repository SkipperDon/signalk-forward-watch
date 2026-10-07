'use strict';

/**
 * Conversion factor: 1 meter per second (m/s) to knots (kn).
 */
const MS_TO_KNOTS = 1.94384;

/**
 * Manages detection hysteresis and state tracking for forward watch alerts.
 * Implements persistence checks before raising alerts, unseen checks before
 * clearing alerts, and vessel stopped state detection via SOG.
 */
class AlertTracker {
  /**
   * @param {number} [persistChecks=3] - Number of consecutive frames an object must be seen to raise an alert.
   * @param {number} [clearChecks=2] - Number of consecutive frames an active object must be unseen to clear its alert.
   * @param {number} [stoppedKn=1.0] - Speed Over Ground threshold in knots below which the vessel is considered stopped.
   */
  constructor(persistChecks = 3, clearChecks = 2, stoppedKn = 1.0) {
    if (persistChecks < 1 || !Number.isInteger(persistChecks)) {
      throw new RangeError('persistChecks must be an integer >= 1');
    }
    if (clearChecks < 1 || !Number.isInteger(clearChecks)) {
      throw new RangeError('clearChecks must be an integer >= 1');
    }
    if (typeof stoppedKn !== 'number' || stoppedKn < 0 || Number.isNaN(stoppedKn)) {
      throw new RangeError('stoppedKn must be a non-negative number');
    }

    this.persistChecks = persistChecks;
    this.clearChecks = clearChecks;
    this.stoppedKn = stoppedKn;

    /**
     * Map tracking detection counters per class.
     * Structure: className -> { consecutiveSeen: number, consecutiveUnseen: number, active: boolean }
     * @type {Map<string, {consecutiveSeen: number, consecutiveUnseen: number, active: boolean}>}
     */
    this.states = new Map();
  }

  /**
   * Evaluates incoming detections and vessel speed, returning alert transitions.
   *
   * @param {string[]|Set<string>} classesSeen - Array or Set of detected class names in the current frame.
   * @param {number|null|undefined} sogMs - Vessel Speed Over Ground in meters per second.
   * @returns {{ raise: string[], clear: string[], stopped: boolean }} State changes and vessel stopped flag.
   */
  update(classesSeen, sogMs) {
    const raise = [];
    const clear = [];

    // Safely evaluate stopped speed state (knots)
    let stopped = false;
    if (sogMs !== null && sogMs !== undefined && !Number.isNaN(sogMs)) {
      const sogKn = sogMs * MS_TO_KNOTS;
      stopped = sogKn < this.stoppedKn;
    }

    const seenSet = new Set(Array.isArray(classesSeen) ? classesSeen : classesSeen || []);

    // 1. Process all classes seen in current frame
    for (const className of seenSet) {
      if (!this.states.has(className)) {
        this.states.set(className, {
          consecutiveSeen: 0,
          consecutiveUnseen: 0,
          active: false
        });
      }

      const state = this.states.get(className);
      state.consecutiveSeen += 1;
      state.consecutiveUnseen = 0;

      // Raise alert if threshold met and not already active
      if (!state.active && state.consecutiveSeen >= this.persistChecks) {
        state.active = true;
        raise.push(className);
      }
    }

    // 2. Process all registered classes not seen in this frame
    for (const [className, state] of this.states.entries()) {
      if (!seenSet.has(className)) {
        state.consecutiveSeen = 0;
        state.consecutiveUnseen += 1;

        // Clear active alert if unseen threshold reached
        if (state.active && state.consecutiveUnseen >= this.clearChecks) {
          state.active = false;
          clear.push(className);
        }

        // Garbage collect tracking state once inactive and settled
        if (!state.active && state.consecutiveUnseen >= this.clearChecks) {
          this.states.delete(className);
        }
      }
    }

    // When stopped, suppress all active alerts
    if (stopped && this.states.size > 0) {
      for (const [className, state] of this.states.entries()) {
        if (state.active) {
          state.active = false;
          clear.push(className);
        }
      }
    }

    return { raise, clear, stopped };
  }

  /**
   * Resets all tracked detection states.
   */
  reset() {
    this.states.clear();
  }

  /**
   * Returns a list of currently active alert class names.
   * @returns {string[]}
   */
  getActiveAlerts() {
    const active = [];
    for (const [className, state] of this.states.entries()) {
      if (state.active) {
        active.push(className);
      }
    }
    return active;
  }
}

module.exports = AlertTracker;
