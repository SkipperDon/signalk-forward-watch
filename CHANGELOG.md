# Changelog — signalk-forward-watch

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.2.5] — 2026-10-07

### Added
- **AlertTracker** (`plugin/alert-state.js`) — stateful alarm logic replaces single-frame decisions.
  - Alarm raises after 3 consecutive detection cycles (debounce).
  - Immediate alarm when estimated target distance ≤ 75 m (life-safety override).
  - Alarm clears after 2 consecutive cycles with no detection.
  - No alarms raised while vessel is stopped (speed < `stopped_speed_kn`, default 1.0 kn) — detections still published.
  - Detection interval configurable via plugin settings; default 5 s, minimum 2 s.
- Regression test suite covering all AlertTracker state transitions (16/16 passing).

### Fixed
- **BUG-235** — False alarms while moored; stopped suppression prevents raise-and-clear on every check.
- **BUG-244** — Alarm state never cleared; `alert-state.js` emits `state: normal` after target is lost.

### Validated
- Sea trial replay (S230 frames, 481 frames, lab replay): moored false alarms 97 → 0; both commercial ships correctly detected; 3 likely false positives remain (lighthouse, dock at 1.4 kn — expected at threshold).

---

## [0.2.4] — 2026-09-10

### Added
- ONNX model bundled with package (no separate download required on first install).
- Existence guard on model path — plugin fails cleanly if model is missing rather than crashing Signal K.

### Changed
- `files` array pinned in `package.json` — only plugin source, model, and README published to npm.
- README updated with v0.2.4 install and configuration instructions.

---

## [0.2.3] — 2026-04-21

### Fixed
- **Geodesy ESM/CJS incompatibility** — `geodesy` v2 uses `"type":"module"`; `require()` on Node 22+ returns a namespace object (silent failure, all detections dropped). Replaced with inline Vincenty spherical haversine in `gps-calculator.js`. `geodesy` dependency removed.
- `.npmignore` hardened — internal docs (`*.txt`, `ROADMAP.md`, `.aao-backups/`) excluded from published package.

---

## [0.2.2] — unpublished

Version number retired; cannot be republished to npm.

---

## [0.2.1] — 2026-03-12

### Fixed
- Signal K version requirement corrected in schema.
- Detection interval default corrected in README.

---

## [0.2.0] — 2026-03-11

### Changed
- **onnxruntime moved to Node.js Worker thread** (`detector-worker.js`). Previously, onnxruntime loaded ~470 MB into Signal K's main heap at `require()` time — even when the plugin was disabled. Worker thread isolates inference; Signal K heap is unaffected regardless of plugin state.

---

## [0.1.1] — 2026-02-28

### Fixed
- Detection interval schema correction.
- Signal K version requirement updated.

---

## [0.1.0] — 2026-02-20

### Added
- Initial release — YOLOv8n + EfficientNet-483 ONNX inference pipeline.
- Signal K plugin integration; detections published as fake vessel targets.
- OpenCPN integration via Signal K.
