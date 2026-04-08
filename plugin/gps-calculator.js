// Inline haversine helpers — geodesy v2 is ESM-only and cannot be require()'d
// from a CommonJS plugin. These formulae are equivalent to geodesy's
// LatLonSpherical.destinationPoint() on a spherical earth (R = 6371 km).
const _R = 6371000;
function _destinationPoint(lat, lon, distMetres, bearingDeg) {
  const δ = distMetres / _R;
  const θ = bearingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lon * Math.PI / 180;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * sinφ2
  );
  return {
    lat: φ2 * 180 / Math.PI,
    lon: ((λ2 * 180 / Math.PI) + 540) % 360 - 180
  };
}

class GpsCalculator {
  constructor(app) {
    this.app = app;
  }

  // detection: {cx, cy, w, h, class_name, confidence} (cx/cy/w/h normalized 0-1)
  // boatLat/boatLon: decimal degrees (null if no GPS)
  // boatHeading: degrees true
  calculate(detection, boatLat, boatLon, boatHeading) {
    if (boatLat === null || boatLon === null) return null;

    // Monocular depth estimate: larger box height = closer object
    // h=1.0 → ~5m, h=0.1 → ~50m, h=0.01 → ~500m
    const h = Math.max(0.01, Math.min(1.0, detection.h));
    const distance_m = Math.max(2, Math.min(500, 5 / h));

    // Bearing: centre of frame = straight ahead; 60° FOV assumption
    const bearing_deg = (boatHeading + ((detection.cx - 0.5) * 60) + 360) % 360;

    const dest = _destinationPoint(boatLat, boatLon, distance_m, bearing_deg);

    return {
      lat:         dest.lat,
      lon:         dest.lon,
      distance_m:  Math.round(distance_m),
      bearing_deg: Math.round(bearing_deg),
      class_name:  detection.class_name,
      confidence:  detection.confidence
    };
  }
}

module.exports = GpsCalculator;
