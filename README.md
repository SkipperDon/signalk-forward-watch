# signalk-forward-watch

AI-powered forward watch obstacle detection for Signal K. Monitors a bow-mounted IP camera using a custom-trained YOLOv8 marine model and sends detections into the Signal K data stream as notifications and values.

**Detects:** ships, boats, debris, buoys, kayaks, logs

---

## Requirements

- Signal K server **v2.23.0 or later** recommended (Node.js ≥ 18)
  - Earlier Signal K versions have an unrelated AIS TCP provider memory leak that causes server instability when AIS is active alongside this plugin
- A bow-mounted IP camera with RTSP stream (ONVIF cameras auto-discovered)
- ffmpeg installed on the host (`sudo apt install ffmpeg`)
- Raspberry Pi 4 or better (CPU inference, no GPU required)

---

## Installation

**Step 1 — Install the plugin**
```bash
cd ~/.signalk
npm install signalk-forward-watch
```

**Step 2 — Download the detection model**

The YOLOv8 marine model is hosted on GitHub Releases (12MB — too large to bundle in the npm package).

```bash
mkdir -p ~/.signalk/node_modules/signalk-forward-watch/models
wget -O ~/.signalk/node_modules/signalk-forward-watch/models/forward-watch.onnx \
  https://github.com/SkipperDon/signalk-forward-watch/releases/download/v0.1.0/forward-watch.onnx
```

Or download it manually from the [Releases page](https://github.com/SkipperDon/signalk-forward-watch/releases) and place it at:
```
~/.signalk/node_modules/signalk-forward-watch/models/forward-watch.onnx
```

**Step 3 — Enable the plugin**

Restart Signal K and enable the plugin in **Admin → Plugin Config → Forward Watch**.

---

## Configuration Fields

| Field | Default | Description |
|-------|---------|-------------|
| **Camera IP Address** | — | IP address of your bow camera (e.g. `192.168.1.100`) |
| **Camera Username** | `admin` | RTSP/ONVIF login username |
| **Camera Password** | — | RTSP/ONVIF login password |
| **RTSP URL** | auto | Full RTSP stream URL. If left blank, the plugin runs ONVIF discovery using the IP/user/pass above. Enter manually to skip discovery: `rtsp://user:pass@ip:554/stream1` |
| **Detection interval (seconds)** | `300` | How often to grab a frame and run detection. Lower = more CPU. Default 300s is conservative; v0.2.0+ worker thread allows 60s on Raspberry Pi 4 without impacting Signal K. |
| **Alert cooldown (seconds)** | `30` | Minimum time between repeat alerts for the same target type and quadrant. Prevents alarm flooding. |
| **Enable audio alarm** | `false` | Plays a system beep on detection within 100m. Requires audio output on the host. |
| **Confidence threshold** | `0.4` | Minimum detection confidence (0–1). Lower = more detections but more false positives. 0.4 is a good starting point. |
| **Show detections in OpenCPN** | `true` | Sends detections to OpenCPN as AIS targets on the chart. Requires boat GPS. |

---

## Chart Plotter Integration

When **Show detections in OpenCPN** is enabled, each detected object is written into Signal K as a vessel with a dedicated fake MMSI. Chart plotters that can read Signal K or NMEA 0183 AIS data will display them as AIS targets.

| Detection | Chart label | MMSI |
|-----------|-------------|------|
| ship | FW-SHIP-1..99 (confidence%) | 800000001, 800000011, ... |
| boat | FW-BOAT-1..99 (confidence%) | 800000002, 800000012, ... |
| debris | FW-DEBRIS-1..99 (confidence%) | 800000003, 800000013, ... |
| buoy | FW-BUOY-1..99 (confidence%) | 800000004, 800000014, ... |
| kayak | FW-KAYAK-1..99 (confidence%) | 800000005, 800000015, ... |
| log | FW-LOG-1..99 (confidence%) | 800000006, 800000016, ... |

The final MMSI digit identifies the detection class, preserving the original single-target values for the first object of each class. Simultaneous detections of the same class are sorted left-to-right in the camera frame and assigned slots 1-99, so multiple boats can appear as separate chart targets instead of overwriting the same fake vessel.

Forward Watch clears virtual AIS targets that are no longer detected on the next detection cycle. It removes only the Signal K paths it publishes for its own fake MMSI contexts, so the chart stays aligned with the current AI detections.

### OpenCPN (Signal K connection)

**OpenPlotter users:** No configuration needed. Signal K and OpenCPN are already connected — detections appear on the chart automatically.

**Other setups:** OpenCPN must have an active Signal K data connection (Admin → Connections → Signal K). If you can already see your boat's GPS position in OpenCPN via Signal K, detections will appear automatically.

### Standalone chart plotters — Garmin, Raymarine, B&G, Furuno, Navionics

Standalone MFDs and chart plotter apps do not connect to Signal K directly. To see forward-watch detections on these devices, install the **`@signalk/signalk-to-nmea0183`** plugin on your Signal K server.

**Prerequisite:** [`@signalk/signalk-to-nmea0183`](https://www.npmjs.com/package/@signalk/signalk-to-nmea0183)

Install it from the Signal K AppStore (Admin → AppStore → search "nmea0183"), then enable it. It converts all Signal K vessel data — including the fake AIS vessels written by forward-watch — into NMEA 0183 `!AIVDM` sentences and broadcasts them on a configurable TCP/UDP port or serial output.

Configure your chart plotter to receive NMEA 0183 from the Signal K server's IP address and port (default 10110). Once connected, forward-watch detections will appear as AIS targets labelled FW-SHIP, FW-BOAT, etc.

> **Note:** Targets only appear when your boat has GPS active in Signal K. Without a GPS position, the plugin cannot calculate where the detected object is, so nothing is sent to the chart.

---

## Signal K Data

### `environment.forwardWatch.detections`

Updated every detection interval. Always present — empty array `[]` when nothing detected.

**Example value (nothing detected):**
```json
[]
```

**Example value (boat detected):**
```json
[
  {
    "class_id": 1,
    "class_name": "boat",
    "confidence": 0.72,
    "cx": 0.51,
    "cy": 0.63,
    "w": 0.18,
    "h": 0.24,
    "position": {
      "latitude": 43.1234,
      "longitude": -70.5678
    },
    "distance": 45,
    "bearing": 187,
    "quadrant": "starboard"
  }
]
```

**Detection object fields:**

| Field | Type | Description |
|-------|------|-------------|
| `class_name` | string | Detected object type: `ship`, `boat`, `debris`, `buoy`, `kayak`, `log` |
| `class_id` | number | Numeric class index (0–5) |
| `confidence` | number | Model confidence 0–1 (e.g. `0.72` = 72% confident) |
| `cx` | number | Bounding box centre X, fraction of image width (0 = left, 1 = right) |
| `cy` | number | Bounding box centre Y, fraction of image height (0 = top, 1 = bottom) |
| `w` | number | Bounding box width as fraction of image width |
| `h` | number | Bounding box height as fraction of image height |
| `distance` | number | Estimated distance in metres (monocular estimate — larger object in frame = closer) |
| `bearing` | number | Estimated bearing in degrees true |
| `quadrant` | string | `port` (left half of frame) or `starboard` (right half of frame) |
| `position.latitude` | number | Estimated GPS latitude of the object (requires boat GPS in Signal K) |
| `position.longitude` | number | Estimated GPS longitude of the object (requires boat GPS in Signal K) |

> **Note on distance accuracy:** Distance is estimated from bounding box height using a monocular depth formula. It assumes a ~60° horizontal field of view. Accuracy is ±50% — treat it as a rough range indicator, not a precise measurement. A proper rangefinder integration would improve this.

---

### `notifications.forwardWatch.<class_name>`

A Signal K notification is sent for any detection **within 100m**. One notification path per class. Respects the alert cooldown setting.

**Severity levels:**

| Distance | Severity | Meaning |
|----------|----------|---------|
| ≤ 30m | `emergency` | Imminent collision risk |
| ≤ 75m | `warn` | Close approach — take action |
| > 75m | `normal` | Awareness only |

**Example notification:**
```json
{
  "state": "alert",
  "severity": "warn",
  "message": "boat detected 45m ahead at bearing 187",
  "timestamp": "2026-03-06T13:02:42.484Z"
}
```

---

## Detection Classes

| Class | Description |
|-------|-------------|
| `ship` | Large commercial vessel |
| `boat` | Recreational or small vessel |
| `debris` | Floating debris, garbage |
| `buoy` | Navigation buoy |
| `kayak` | Kayak or small paddle craft |
| `log` | Floating log or deadhead |

---

## Model

- Architecture: YOLOv8n (nano) — optimised for edge CPU deployment
- Training: 21,719 labelled marine images, 100 epochs
- Input: 640×640 RGB
- Format: ONNX (CPU inference via onnxruntime-node)
- File: `models/forward-watch.onnx` (~12MB)

---

## Performance

| Hardware | Inference time | Recommended interval |
|----------|---------------|----------------------|
| Raspberry Pi 4 (4GB) | ~1.6s | 300s (v0.1.x) · 60s (v0.2.0+) |
| Raspberry Pi 5 | ~0.6s (estimated) | 60s |
| x86 CPU (modern) | ~0.3s | 10s |

> **v0.1.x note:** ONNX inference runs on the Signal K event loop thread. At short intervals this can cause GPS, AIS, and engine data to freeze during inference. The default interval of 300s avoids this. v0.2.0 moves inference to a worker thread — GPS/AIS/engine data will remain live at any detection interval.

---

## Troubleshooting

**No detections, camera not connecting**
- Check your RTSP URL is correct. Test it with VLC on another device.
- Make sure ffmpeg is installed: `ffmpeg -version`
- Check the camera IP is reachable from the Signal K host.

**High CPU usage**
- Increase the detection interval. Default is 300s; v0.2.0+ worker thread allows 60s on Pi 4 without impacting Signal K performance.
- The plugin guards against overlapping inference cycles — if one cycle takes longer than the interval, the next is skipped.

**Distance estimates seem wrong**
- This is expected. Monocular depth estimation from a single camera is inherently imprecise. Use as a rough guide only.
- Accuracy improves for larger objects that fill more of the frame.

**No GPS position in detections**
- The plugin reads `navigation.position` and `navigation.headingTrue` from Signal K.
- If your GPS isn't providing position data, detections will still appear but without `position`, `distance`, and `bearing` fields.

---

## Compatibility

**Signal K v2.23.0 — Verified 2026-03-22**

Following the automatic update of Signal K server to v2.23.0 on a Raspberry Pi 4 running Node.js v20.20.0, signalk-forward-watch v0.2.0 was verified against the new version. The plugin loaded cleanly at Signal K startup with no errors — it appeared in the plugins list as active, all Signal K API endpoints (position, SOG, COG, resources) continued to return 200 OK, and the server maintained stable uptime of 2+ hours with the plugin enabled. The only log entry related to the plugin was an onnxruntime GPU device discovery warning, which is cosmetic — the runtime falls back to CPU inference automatically and detection operates normally. No API breaking changes were identified between v2.22.1 and v2.23.0 that affect this plugin. The minimum recommended Signal K version has been updated to v2.23.0 in the v0.2.1 release.

---

## License

Apache 2.0 — see [LICENSE](LICENSE)

**Author:** SkipperDon
**Plugin ID:** `signalk-forward-watch`
**npm:** [signalk-forward-watch](https://www.npmjs.com/package/signalk-forward-watch)
