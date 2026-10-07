const path = require('path');
const fs = require('fs');
const CameraDiscovery = require('./plugin/camera-discovery');
const RtspGrabber = require('./plugin/rtsp-grabber');
const Detector = require('./plugin/detector');
const GpsCalculator = require('./plugin/gps-calculator');
const SignalkOutput = require('./plugin/signalk-output');
const OpenCPNOutput = require('./plugin/opencpn-output');

const MODEL_PATH = path.join(__dirname, 'models', 'forward-watch.onnx');

if (!fs.existsSync(MODEL_PATH)) {
  throw new Error(
    'signalk-forward-watch: bundled model missing at ' + MODEL_PATH +
    ' — reinstall the plugin. This build never downloads models.');
}

module.exports = function(app) {
  const plugin = {
    id: 'signalk-forward-watch',
    name: 'Forward Watch',
    description: 'AI-powered forward watch obstacle detection for Signal K',

    schema: {
      type: 'object',
      title: 'Forward Watch Configuration',
      properties: {
        camera_ip: {
          type: 'string',
          title: 'Camera IP Address'
        },
        camera_user: {
          type: 'string',
          title: 'Camera Username',
          default: 'admin'
        },
        camera_pass: {
          type: 'string',
          title: 'Camera Password',
          format: 'password'
        },
        rtsp_url: {
          type: 'string',
          title: 'RTSP URL — auto-filled or enter manually'
        },
        detection_interval: {
          type: 'number',
          title: 'Detection interval in seconds',
          default: 5,
          minimum: 2,
          maximum: 600
        },
        alert_cooldown: {
          type: 'number',
          title: 'Seconds before re-alerting same target',
          default: 30
        },
        audio_alarm: {
          type: 'boolean',
          title: 'Enable audio alarm',
          default: false
        },
        confidence_threshold: {
          type: 'number',
          title: 'Minimum detection confidence 0-1',
          default: 0.4,
          minimum: 0,
          maximum: 1
        },
        opencpn_enabled: {
          type: 'boolean',
          title: 'Show detections in OpenCPN',
          default: true
        },
        stopped_speed_kn: {
          type: 'number',
          title: 'Stopped Vessel Speed Threshold (knots)',
          description: 'Vessel is considered stopped when SOG is below this value. Suppresses alerts when stopped.',
          default: 1.0,
          minimum: 0
        },
        persistence_checks: {
          type: 'integer',
          title: 'Persistence Checks',
          description: 'Number of consecutive detection frames required to raise an alert.',
          default: 3,
          minimum: 1
        },
        clear_checks: {
          type: 'integer',
          title: 'Clear Checks',
          description: 'Number of consecutive frames unseen required to clear an active alert.',
          default: 2,
          minimum: 1
        },
        immediate_alert_m: {
          type: 'number',
          title: 'Alert immediately when closer than (m)',
          description: 'Life-safety override: Objects within this distance raise alerts immediately, skipping persistence checks.',
          default: 75,
          minimum: 1
        }
      },
      required: ['camera_ip', 'camera_user', 'camera_pass']
    },

    start: async function(options) {
      app.debug('Starting Forward Watch plugin');

      this.discovery = new CameraDiscovery(app);
      this.grabber = new RtspGrabber(app);
      this.detector = new Detector(app, MODEL_PATH);
      this.gpsCalc = new GpsCalculator(app);
      
      // Pass alert tracker config to SignalkOutput
      this.skOutput = new SignalkOutput(app, {
        persistence_checks: options.persistence_checks ?? 3,
        clear_checks: options.clear_checks ?? 2,
        stopped_speed_kn: options.stopped_speed_kn ?? 1.0,
        immediate_alert_m: options.immediate_alert_m ?? 75,
        audio_alarm: options.audio_alarm
      });
      
      this.ocpnOutput = new OpenCPNOutput(app);

      // Load ONNX model
      await this.detector.init();
      app.debug('ONNX model loaded');

      // Resolve RTSP URL
      let rtspUrl = options.rtsp_url;
      if (!rtspUrl) {
        app.debug('No RTSP URL configured — running ONVIF discovery');
        const cameras = await this.discovery.scan();
        if (cameras.length > 0) {
          rtspUrl = cameras[0].rtsp_url;
          app.debug(`Discovered camera: ${rtspUrl}`);
        } else {
          rtspUrl = await this.discovery.buildRtspUrl(options.camera_ip, options.camera_user, options.camera_pass);
          app.debug(`Using fallback RTSP URL: ${rtspUrl}`);
        }
      }

      this.rtspUrl = rtspUrl;
      app.debug(`Starting detection loop every ${options.detection_interval}s`);

      // Track SOG from Signal K for alert suppression
      let currentSogMs = null;
      let unsubscribeSOG = null;

      const sogSubscription = {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'navigation.speedOverGround',
            period: 1000
          }
        ]
      };

      if (app.subscriptionmanager) {
        const unsubs = [];
        app.subscriptionmanager.subscribe(
          sogSubscription,
          unsubs,
          (err) => {
            if (err) {
              app.debug(`SOG subscription error: ${err}`);
            }
          },
          (delta) => {
            if (!delta.updates) return;
            for (const update of delta.updates) {
              for (const val of update.values) {
                if (val.path === 'navigation.speedOverGround') {
                  currentSogMs = val.value;
                }
              }
            }
          }
        );
        if (unsubs.length > 0) {
          unsubscribeSOG = unsubs[0];
        }
      }

      this.running = false;
      this.interval = setInterval(async () => {
        if (this.running) return; // skip if previous inference still in progress
        this.running = true;
        try {
          const framePath = await this.grabber.grabFrame(this.rtspUrl);
          if (!framePath) return;

          const detections = await this.detector.detect(framePath, options.confidence_threshold || 0.4) || [];

          // Get boat position from Signal K
          const boatLat = app.getSelfPath('navigation.position.value.latitude') || null;
          const boatLon = app.getSelfPath('navigation.position.value.longitude') || null;
          const boatHeading = app.getSelfPath('navigation.headingTrue.value') || 0;

          // Enrich detections with GPS position
          const enriched = detections.map(d => {
            const gps = this.gpsCalc.calculate(d, boatLat, boatLon, boatHeading);
            return Object.assign({}, d, gps ? {
              position: { latitude: gps.lat, longitude: gps.lon },
              distance: gps.distance_m,
              bearing: gps.bearing_deg,
              quadrant: d.cx < 0.5 ? 'port' : 'starboard'
            } : {});
          });

          // Send to Signal K with alert tracker state management and current SOG
          this.skOutput.sendDetections(enriched, currentSogMs);
          
          if (options.opencpn_enabled !== false) this.ocpnOutput.sendDetections(enriched);
        } catch (err) {
          app.debug('Detection loop error: ' + err.message);
        } finally {
          this.running = false;
        }
      }, (options.detection_interval || 5) * 1000);

      this.unsubscribeSOG = unsubscribeSOG;
    },

    stop: function() {
      app.debug('Stopping Forward Watch plugin');
      if (this.interval) clearInterval(this.interval);
      if (this.grabber) this.grabber.stop();
      if (this.detector) this.detector.terminate();
      if (this.skOutput) this.skOutput.reset();
      if (this.unsubscribeSOG) this.unsubscribeSOG();
    }
  };

  return plugin;
};
