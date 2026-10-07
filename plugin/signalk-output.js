'use strict';

const { exec } = require('child_process');
const AlertTracker = require('./alert-state');

const PLUGIN_ID = 'signalk-forward-watch';

class SignalkOutput {
  /**
   * @param {object} app - Signal K server instance
   * @param {object} options - Plugin configuration
   * @param {number} [options.persistence_checks=3] - Checks before raising
   * @param {number} [options.clear_checks=2] - Checks before clearing
   * @param {number} [options.stopped_speed_kn=1.0] - Stopped threshold
   * @param {number} [options.immediate_alert_m=75] - Distance threshold for immediate (urgent) alerts
   */
  constructor(app, options = {}) {
    this.app = app;
    this.options = options;
    this.audioUnavailable = false;

    // Initialize alert tracker
    this.tracker = new AlertTracker(
      options.persistence_checks ?? 3,
      options.clear_checks ?? 2,
      options.stopped_speed_kn ?? 1.0
    );
  }

  /**
   * Process detections and vessel SOG to manage alert state
   * @param {Array} detections - Detection objects with class_name, confidence, distance, etc
   * @param {number|null} sogMs - Speed Over Ground in m/s
   */
  sendDetections(detections, sogMs = null) {
    // Extract class names from detections
    const classesSeen = (detections || []).map(d => d.class_name).filter(Boolean);

    // Calculate urgent classes: objects within dangerous proximity (life-safety override)
    const urgentClasses = (detections || [])
      .filter(d => typeof d.distance === 'number' && d.distance <= (this.options.immediate_alert_m ?? 75))
      .map(d => d.class_name)
      .filter(Boolean);

    // Update tracker and get state transitions (with urgent classes)
    const { raise, clear, stopped } = this.tracker.update(classesSeen, sogMs, urgentClasses);

    // Always publish the raw detections
    this.app.handleMessage(PLUGIN_ID, {
      updates: [{
        values: [{
          path: 'environment.forwardWatch.detections',
          value: detections
        }]
      }]
    });

    // Publish raise notifications with severity and message
    for (const className of raise) {
      let severity = 'warn';
      let message = `${className} detected`;
      let isUrgent = urgentClasses.includes(className);

      // Find distance if available
      const detection = detections.find(d => d.class_name === className);
      if (detection && typeof detection.distance === 'number') {
        const dist = Math.round(detection.distance);
        if (isUrgent || dist <= 30) severity = 'emergency';
        else if (dist <= 75) severity = 'warn';
        message = `${className} detected ${dist}m ahead${isUrgent ? ' — IMMEDIATE ALERT' : ''}`;
      }

      this.app.handleMessage(PLUGIN_ID, {
        updates: [{
          values: [{
            path: `notifications.forwardWatch.${className}`,
            value: {
              state: 'alert',
              severity: severity,
              message: message,
              timestamp: new Date().toISOString()
            }
          }]
        }]
      });

      if (this.options.audio_alarm && !this.audioUnavailable) {
        this.playBeep();
      }
    }

    // Publish clear notifications with state='normal'
    for (const className of clear) {
      this.app.handleMessage(PLUGIN_ID, {
        updates: [{
          values: [{
            path: `notifications.forwardWatch.${className}`,
            value: {
              state: 'normal',
              message: `${className} cleared`,
              timestamp: new Date().toISOString()
            }
          }]
        }]
      });
    }
  }

  playBeep() {
    const command = 'which paplay > /dev/null 2>&1 && paplay /usr/share/sounds/alsa/Front_Left.wav || aplay -q /usr/share/sounds/alsa/Front_Left.wav';
    exec(command, (error) => {
      if (error) {
        this.audioUnavailable = true;
        this.app.debug('Audio alarm failed: ' + error.message);
      }
    });
  }

  /**
   * Reset state on plugin stop
   */
  reset() {
    this.tracker.reset();
  }
}

module.exports = SignalkOutput;
