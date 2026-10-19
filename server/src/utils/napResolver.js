// Resolves work-order coordinates against the authoritative Selfie-Attendance
// NAP database (the `naps` table in the shared PostgreSQL database).
//
// Priority rule (requirement 14): when a valid NAP ID match exists, the NAP
// record's verified coordinates win over the uploaded file's coordinates.
// Conflicting coordinates are flagged, never silently merged.

const { pool } = require('../config/database');

// Coordinates differing by more than this are treated as a conflict.
const CONFLICT_THRESHOLD_METERS = 150;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Bulk-load NAP records for a set of nap ids (case-insensitive fallback).
// Returns a Map keyed by both the exact string and its uppercase form.
async function lookupNaps(napIds) {
  const clean = [...new Set(napIds.map((n) => String(n).trim()).filter(Boolean))];
  const map = new Map();
  if (clean.length === 0) return map;

  const CHUNK = 2000;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const chunk = clean.slice(i, i + CHUNK);
    const up = chunk.map((c) => c.toUpperCase());
    const { rows } = await pool.query(
      `SELECT nap_id, cabinet, building_served, city_name, province_name,
              barangay_name, dp_nap_lat, dp_nap_long, naps_status, total_capacity,
              vacant_lines, working_lines
         FROM naps
        WHERE nap_id = ANY($1) OR UPPER(nap_id) = ANY($2)`,
      [chunk, up]
    );
    for (const row of rows) {
      map.set(row.nap_id, row);
      map.set(row.nap_id.toUpperCase(), row);
    }
  }
  return map;
}

function findNap(napMap, napId) {
  if (!napId) return null;
  const raw = String(napId).trim();
  if (!raw) return null;
  return napMap.get(raw) || napMap.get(raw.toUpperCase()) || null;
}

// Decide the final coordinates + status for a single imported row.
function resolveCoordinates({ napId, sourceLat, sourceLng }, napMap) {
  const nap = findNap(napMap, napId);
  const hasSource = sourceLat != null && sourceLng != null;

  if (!napId || !String(napId).trim()) {
    return {
      latitude: hasSource ? sourceLat : null,
      longitude: hasSource ? sourceLng : null,
      coordinate_source: hasSource ? 'imported' : null,
      nap_match_status: 'no_nap_id',
      coord_conflict: false,
      coord_diff_meters: null,
      nap: null,
    };
  }

  if (!nap) {
    return {
      latitude: hasSource ? sourceLat : null,
      longitude: hasSource ? sourceLng : null,
      coordinate_source: hasSource ? 'imported' : null,
      nap_match_status: 'not_found',
      coord_conflict: false,
      coord_diff_meters: null,
      nap: null,
    };
  }

  const napLat = nap.dp_nap_lat != null ? Number(nap.dp_nap_lat) : null;
  const napLng = nap.dp_nap_long != null ? Number(nap.dp_nap_long) : null;
  const napHasCoords = napLat != null && napLng != null;

  if (napHasCoords) {
    let diff = null;
    let conflict = false;
    if (hasSource) {
      diff = haversineMeters(napLat, napLng, sourceLat, sourceLng);
      conflict = diff > CONFLICT_THRESHOLD_METERS;
    }
    return {
      latitude: napLat,
      longitude: napLng,
      coordinate_source: 'nap',
      nap_match_status: 'matched',
      coord_conflict: conflict,
      coord_diff_meters: diff,
      nap,
    };
  }

  // Matched but the NAP itself has no coordinates -> fall back but flag it.
  return {
    latitude: hasSource ? sourceLat : null,
    longitude: hasSource ? sourceLng : null,
    coordinate_source: hasSource ? 'imported' : null,
    nap_match_status: 'matched_no_coords',
    coord_conflict: false,
    coord_diff_meters: null,
    nap,
  };
}

module.exports = {
  lookupNaps,
  findNap,
  resolveCoordinates,
  haversineMeters,
  CONFLICT_THRESHOLD_METERS,
};
