'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const AlertTracker = require('../plugin/alert-state');

describe('AlertTracker', () => {
  let tracker;

  beforeEach(() => {
    // Default: persist=3, clear=2, stoppedKn=1.0
    tracker = new AlertTracker(3, 2, 1.0);
  });

  describe('Constructor validation', () => {
    it('initializes with default and custom values correctly', () => {
      const custom = new AlertTracker(5, 3, 2.5);
      assert.equal(custom.persistChecks, 5);
      assert.equal(custom.clearChecks, 3);
      assert.equal(custom.stoppedKn, 2.5);
    });

    it('throws errors on invalid input parameters', () => {
      assert.throws(() => new AlertTracker(0, 2, 1.0), RangeError);
      assert.throws(() => new AlertTracker(3, -1, 1.0), RangeError);
      assert.throws(() => new AlertTracker(3, 2, -0.5), RangeError);
    });
  });

  describe('Persistence logic', () => {
    it('does not raise before persistChecks consecutive detections', () => {
      let result = tracker.update(['buoy'], 2.0);
      assert.deepEqual(result.raise, []);

      result = tracker.update(['buoy'], 2.0);
      assert.deepEqual(result.raise, []);
    });

    it('raises alert on reaching persistChecks consecutive detections', () => {
      tracker.update(['buoy'], 2.0);
      tracker.update(['buoy'], 2.0);
      const result = tracker.update(['buoy'], 2.0); // 3rd check
      assert.deepEqual(result.raise, ['buoy']);
    });

    it('does not repeatedly raise for already active alerts', () => {
      tracker.update(['buoy'], 2.0);
      tracker.update(['buoy'], 2.0);
      tracker.update(['buoy'], 2.0); // Raised here

      const result = tracker.update(['buoy'], 2.0); // 4th check
      assert.deepEqual(result.raise, []);
      assert.deepEqual(tracker.getActiveAlerts(), ['buoy']);
    });
  });

  describe('Clear logic', () => {
    it('clears active alert after clearChecks consecutive unseen frames', () => {
      // Raise alert first
      tracker.update(['vessel'], 2.0);
      tracker.update(['vessel'], 2.0);
      tracker.update(['vessel'], 2.0);

      // 1st unseen frame
      let result = tracker.update([], 2.0);
      assert.deepEqual(result.clear, []);
      assert.deepEqual(tracker.getActiveAlerts(), ['vessel']);

      // 2nd unseen frame -> clear
      result = tracker.update([], 2.0);
      assert.deepEqual(result.clear, ['vessel']);
      assert.deepEqual(tracker.getActiveAlerts(), []);
    });
  });

  describe('Vessel stopped speed check', () => {
    it('flags stopped when speed in knots is less than stoppedKn', () => {
      // 0.4 m/s * 1.94384 = ~0.777 kn (< 1.0 kn)
      const resStopped = tracker.update([], 0.4);
      assert.equal(resStopped.stopped, true);

      // 1.0 m/s * 1.94384 = ~1.94 kn (> 1.0 kn)
      const resMoving = tracker.update([], 1.0);
      assert.equal(resMoving.stopped, false);
    });

    it('handles null and undefined SOG gracefully without throwing', () => {
      const resNull = tracker.update(['buoy'], null);
      assert.equal(resNull.stopped, false);

      const resUndefined = tracker.update(['buoy'], undefined);
      assert.equal(resUndefined.stopped, false);

      const resNaN = tracker.update(['buoy'], NaN);
      assert.equal(resNaN.stopped, false);
    });
  });

  describe('Re-raise behavior', () => {
    it('re-raises alert if class clears and appears again for persistChecks', () => {
      // 1. Initial Raise
      tracker.update(['log'], 2.0);
      tracker.update(['log'], 2.0);
      let res = tracker.update(['log'], 2.0);
      assert.deepEqual(res.raise, ['log']);

      // 2. Clear
      tracker.update([], 2.0);
      res = tracker.update([], 2.0);
      assert.deepEqual(res.clear, ['log']);

      // 3. Re-detection under threshold
      res = tracker.update(['log'], 2.0);
      assert.deepEqual(res.raise, []);

      tracker.update(['log'], 2.0);
      // 4. Threshold reached again -> re-raised
      res = tracker.update(['log'], 2.0);
      assert.deepEqual(res.raise, ['log']);
    });
  });
});

// S232 regression: S230 dock replay raised and cleared on every check while stopped
const { test: t2 } = require('node:test');
const assert2 = require('node:assert');
const Tracker2 = require('../plugin/alert-state.js');
t2('stopped: object seen many checks never raises and never emits clear', () => {
  const tr = new Tracker2(3, 2, 1.0);
  for (let i = 0; i < 10; i++) {
    const r = tr.update(['ship'], 0.05);
    assert2.deepStrictEqual(r.raise, [], `raise on check ${i}`);
    assert2.deepStrictEqual(r.clear, [], `clear on check ${i}`);
  }
});
t2('stopped then underway: raises after persistence once moving', () => {
  const tr = new Tracker2(3, 2, 1.0);
  for (let i = 0; i < 5; i++) tr.update(['ship'], 0.0);
  const r = tr.update(['ship'], 3.0);
  assert2.deepStrictEqual(r.raise, ['ship']);
  assert2.deepStrictEqual(tr.update(['ship'], 3.0).raise, []);
});

