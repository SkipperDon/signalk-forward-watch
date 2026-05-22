// Writes forward watch detections into Signal K as fake vessels
// OpenCPN reads them via its existing Signal K connection and displays them as AIS targets

// Fake MMSIs keep the detection class in the final digit, preserving the
// original single-target values for slot 1 (boat = 800000002, etc.).
const CLASS_MMSI_DIGIT = {
  ship:   1,
  boat:   2,
  debris: 3,
  buoy:   4,
  kayak:  5,
  log:    6
};
const MMSI_PREFIX = 800000000;
const MAX_TARGETS_PER_CLASS = 99;

const CLASS_LABEL = {
  ship:   'FW-SHIP',
  boat:   'FW-BOAT',
  debris: 'FW-DEBRIS',
  buoy:   'FW-BUOY',
  kayak:  'FW-KAYAK',
  log:    'FW-LOG'
};

const PLUGIN_ID = 'signalk-forward-watch';
const CLEAR_VALUES = [
  { path: 'navigation.position', value: null },
  { path: 'name', value: null },
  { path: 'navigation.courseOverGroundTrue', value: null },
  { path: 'navigation.speedOverGround', value: null }
];

class OpenCPNOutput {
  constructor(app) {
    this.app = app;
    this.activeContexts = new Set();
  }

  sendDetections(detections) {
    const withPos = detections.filter(d =>
      d.position &&
      typeof d.position.latitude === 'number' &&
      typeof d.position.longitude === 'number'
    );

    const targets = assignTargetSlots(withPos);
    const currentContexts = new Set(targets.map(target => target.context));

    for (const target of targets) {
      const { detection: d, context, label } = target;

      this.app.handleMessage(PLUGIN_ID, {
        context: `vessels.${context}`,
        updates: [{
          values: [
            {
              path: 'navigation.position',
              value: {
                latitude: d.position.latitude,
                longitude: d.position.longitude
              }
            },
            {
              path: 'name',
              value: `${label} (${Math.round(d.confidence * 100)}%)`
            },
            {
              path: 'navigation.courseOverGroundTrue',
              value: (d.bearing || 0) * (Math.PI / 180)
            },
            {
              path: 'navigation.speedOverGround',
              value: 0
            }
          ]
        }]
      });

      this.app.debug(`OpenCPN: ${label} → ${context} at ${d.position.latitude.toFixed(4)},${d.position.longitude.toFixed(4)}`);
    }

    for (const context of this.activeContexts) {
      if (!currentContexts.has(context)) this.clearTarget(context);
    }

    this.activeContexts = currentContexts;
  }

  stop() {
    for (const context of this.activeContexts) {
      this.clearTarget(context);
    }
    this.activeContexts.clear();
  }

  clearTarget(context) {
    this.app.handleMessage(PLUGIN_ID, {
      context: `vessels.${context}`,
      updates: [{
        values: CLEAR_VALUES
      }]
    });

    this.app.debug(`OpenCPN: cleared ${context}`);
  }
}

function assignTargetSlots(detections) {
  const byClass = new Map();

  for (const detection of detections) {
    if (!CLASS_MMSI_DIGIT[detection.class_name]) continue;
    const list = byClass.get(detection.class_name) || [];
    list.push(detection);
    byClass.set(detection.class_name, list);
  }

  const targets = [];
  for (const [className, classDetections] of byClass.entries()) {
    classDetections
      .sort((a, b) => a.cx - b.cx)
      .slice(0, MAX_TARGETS_PER_CLASS)
      .forEach((detection, index) => {
        const slot = index + 1;
        const mmsi = MMSI_PREFIX + (index * 10) + CLASS_MMSI_DIGIT[className];
        targets.push({
          detection,
          context: `urn:mrn:imo:mmsi:${mmsi}`,
          label: `${CLASS_LABEL[className]}-${slot}`
        });
      });
  }

  return targets;
}

module.exports = OpenCPNOutput;
