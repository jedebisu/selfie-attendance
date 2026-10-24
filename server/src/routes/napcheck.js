const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const napCache = require('./napcheckCache');

// ---------------------------------------------------------------------------
// Public, read-only NAP Checking endpoints for the nap.ebisudps.com web app.
//
// SECURITY / SCOPE RULES:
//  - Visayas-only: every query below hard-filters on the database's own
//    regional classification (cfs_region / province_name). The filter lives
//    here in SQL — never trust the frontend to enforce it.
//  - Read-only: no write endpoints. Admin import stays in routes/naps.js.
//  - Rate limited per IP (see below). No auth for these public reads.
// ---------------------------------------------------------------------------

// Date of the source "NAP Facility Summary Report" CSV (same file the existing
// /api/naps import uses — single source of truth, reused, not duplicated).
let napReportDate = null;
try {
  napReportDate = fs.readFileSync(
    path.join(__dirname, '..', 'config', 'nap_report_date.txt'), 'utf-8'
  ).trim() || null;
} catch (_) {}

// ---------------------------------------------------------------------------
// Visayas regional filter.
//
// Two-part rule (per owner direction, Oct 2026 — "use the actual lat/long for
// the complete NAPs for Visayas"):
//
//   1. Classification (verified against all 471 distinct province_name /
//      cfs_region values in the authoritative naps table):
//        a. Globe commercial region codes meaning Visayas: VIS (incl. typo
//           variants VIS3/VISQ/VISS/VIZ observed in the data).
//        b. Official Visayas province / provincial-city names matched as
//           whole tokens (CEBU, ILOILO, NEGROS ORIENTAL, EASTERN SAMAR, ...).
//
//   2. Coordinates — records with garbled/blank region fields but REAL
//      coordinates inside the Visayas bounding box are INCLUDED. Guardrails
//      keep this honest: a coordinate match is rejected if the record is
//      explicitly classified as another region (NCR/NLZ/SLZ/MIN tokens) or
//      named for a non-Visayas province. Verified: adds 18,421 records in
//      production (nearly all blank/"PHILIPPINES" region values) and leaks
//      0 Mindanao/Luzon-named rows.
//
// A record is included when EITHER rule matches.
// ---------------------------------------------------------------------------
// Official Visayas multi-word names matched as substrings (values are
// constants below, never user input).
const VISAYAS_CLASSIFICATION_SQL = `(
  (regexp_split_to_array(upper(regexp_replace(COALESCE(cfs_region, province_name, ''), '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['VIS','VISAYAS','VIS3','VISQ','VISS','VIZ'])
  OR (regexp_split_to_array(upper(regexp_replace(COALESCE(province_name, cfs_region, ''), '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['AKLAN','ANTIQUE','CAPIZ','GUIMARAS','ILOILO','CEBU','BOHOL','BILIRAN','SIQUIJOR','SAMAR','LEYTE','BACOLOD','DUMAGUETE'])
  OR COALESCE(province_name, cfs_region, '') ILIKE '%NEGROS OCCIDENTAL%'
  OR COALESCE(province_name, cfs_region, '') ILIKE '%NEGROS ORIENTAL%'
  OR COALESCE(province_name, cfs_region, '') ILIKE '%EASTERN SAMAR%'
  OR COALESCE(province_name, cfs_region, '') ILIKE '%NORTHERN SAMAR%'
  OR COALESCE(province_name, cfs_region, '') ILIKE '%SOUTHERN LEYTE%'
  OR COALESCE(province_name, cfs_region, '') ILIKE '%ILO-ILO%'
)`;

// Coordinates fallback: bounding box covering the Visayas landmass
// (lat 8.9–13.2, lng 121.8–126.9) MINUS anything explicitly classified as
// another Globe region (NCR / North Luzon / South Luzon / Mindanao) or named
// for a non-Visayas province (Masbate/Romblon → Mimaropa/Bicol, Surigao /
// Camiguin / Davao / etc. → Mindanao, Palawan → Mimaropa). Two landmass
// "notches" cut where the box would otherwise overlap northern Mindanao:
//   - Surigao del Norte / Butuan / Tandag / Dinagat coast: lat<10.35 & lng>125
//     (Samar's east coast incl. Guiuan sits above lat 10.35 — kept).
//   - Camiguin: lat<9.75 & lng>124.5 (Bohol's east coast stays above lat 9.75).
// Verified in production: removes 396 blank-region Mindanao rows, keeps all
// genuine Visayas buckets.
const VISAYAS_OTHER_REGION_SQL = `(
    regexp_split_to_array(upper(regexp_replace(COALESCE(cfs_region, ''), '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['NCR','NLZ','SLZ','MIN']
  OR regexp_split_to_array(upper(regexp_replace(COALESCE(province_name, ''), '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['NCR','NLZ','SLZ','MIN']
)`;
const VISAYAS_OTHER_NAMES = [
  'METRO MANILA', 'MINDORO', 'MASBATE', 'ROMBLON', 'MARINDUQUE', 'SURIGAO',
  'AGUSAN', 'MISAMIS', 'CAMIGUIN', 'DAVAO', 'ZAMBOANGA', 'LANAO', 'BUKIDNON',
  'COTABATO', 'MAGUINDANAO', 'BASILAN', 'SULU', 'SARANGANI', 'SULTAN',
  'PALAWAN', 'ALBAY', 'CAMARINES', 'SORSOGON', 'CATANDUANES',
].map((n) => `COALESCE(cfs_region,'') NOT ILIKE '%${n}%' AND COALESCE(province_name,'') NOT ILIKE '%${n}%'`).join(' AND ');
const VISAYAS_COORD_SQL = `(
  dp_nap_lat BETWEEN 8.9 AND 13.2
  AND dp_nap_long BETWEEN 121.8 AND 126.9
  AND NOT ${VISAYAS_OTHER_REGION_SQL}
  AND ${VISAYAS_OTHER_NAMES}
  AND NOT (dp_nap_lat < 10.35 AND dp_nap_long > 125.0)
  AND NOT (dp_nap_lat < 9.75 AND dp_nap_long > 124.5)
)`;

const VISAYAS_WHERE = `((${VISAYAS_CLASSIFICATION_SQL}) OR (${VISAYAS_COORD_SQL}))`.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Rate limiting — tiny in-memory sliding window, per IP. No new dependencies.
// Public page traffic budget: 120 requests / minute / IP.
// ---------------------------------------------------------------------------
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 300; // generous for map panning + debounced; still bounds abuse
const rateBuckets = new Map(); // ip -> array of timestamps
setInterval(() => {
  const cutoff = Date.now() - RATE_WINDOW_MS;
  for (const [ip, hits] of rateBuckets) {
    const alive = hits.filter((t) => t > cutoff);
    if (alive.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, alive);
  }
}, 60 * 1000).unref();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const hits = (rateBuckets.get(ip) || []).filter((t) => t > cutoff);
  if (hits.length >= RATE_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }
  hits.push(now);
  rateBuckets.set(ip, hits);
  next();
}
router.use(rateLimit);

// Standard selectable columns + capacity marker color (same rules as the
// existing /api/naps endpoints so web results stay consistent with the app).
const SELECT_COLS = `
  id, nap_id, cabinet, location_type, building_served, floors_served,
  working_lines, vacant_lines, total_capacity, cfs_region,
  city_name, province_name, barangay_name, dp_nap_lat, dp_nap_long,
  naps_status, olt_id, sell_status, updated_at,
  ports_reserved, ports_defective, ports_contingency,
  discovered_when, customer_type, nap_address,
  CASE
    WHEN vacant_lines = 0 THEN 'red'
    WHEN vacant_lines <= 8 THEN 'yellow'
    ELSE 'green'
  END as marker_color
`.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// GET /api/napcheck/stats/summary — Visayas-only totals
// (MUST be registered before /:code routes)
// ---------------------------------------------------------------------------
router.get('/stats/summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_naps,
        SUM(CASE WHEN vacant_lines = 0 THEN 1 ELSE 0 END) as full_naps,
        SUM(CASE WHEN vacant_lines > 0 AND vacant_lines <= 8 THEN 1 ELSE 0 END) as warning_naps,
        SUM(CASE WHEN vacant_lines > 8 THEN 1 ELSE 0 END) as available_naps,
        SUM(total_capacity) as total_ports,
        SUM(working_lines) as used_ports,
        SUM(vacant_lines) as available_ports,
        MAX(updated_at) as last_data_update
      FROM naps
      WHERE ${VISAYAS_WHERE}
    `);
    res.json({ region: 'visayas', ...result.rows[0], nap_report_date: napReportDate });
  } catch (error) {
    console.error('Error fetching napcheck stats:', error);
    res.status(500).json({ error: 'Failed to fetch NAP statistics' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/napcheck/search?q=&status=&limit=
// NAP-ID-first matching (exact > prefix > contains), then fallback to
// building/barangay/city — same priority rules as the existing /api/naps/search
// so the web module stays consistent with the app. Visayas-only, always.
// ---------------------------------------------------------------------------
router.get('/search', async (req, res) => {
  try {
    const { q, status, limit = 60 } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const searchTrimmed = q.trim();
    const searchTerm = `%${searchTrimmed}%`;
    const lim = Math.min(parseInt(limit, 10) || 60, 100);
    const statusFilter = status ? ` AND naps_status = $5` : '';
    const idParams = status
      ? [searchTrimmed, `${searchTrimmed}%`, searchTerm, lim, status]
      : [searchTrimmed, `${searchTrimmed}%`, searchTerm, lim];

    // Pass 1: NAP ID matching (exact > prefix > contains), Visayas only
    const idResult = await pool.query(`
      SELECT ${SELECT_COLS},
        CASE
          WHEN UPPER(nap_id) = UPPER($1) THEN 0
          WHEN UPPER(nap_id) LIKE UPPER($2) THEN 1
          ELSE 2
        END as match_rank
      FROM naps
      WHERE ${VISAYAS_WHERE}
        AND ( UPPER(nap_id) = UPPER($1) OR UPPER(nap_id) LIKE UPPER($2) OR UPPER(nap_id) LIKE UPPER($3) )
        ${statusFilter}
      ORDER BY match_rank, nap_id
      LIMIT $4
    `, idParams);

    let rows = idResult.rows;

    // Pass 2 (only if the ID pass found nothing): text fields fallback
    if (rows.length === 0) {
      // All placeholders must be referenced; index the status filter accordingly
      const statusFilter2 = status ? ` AND naps_status = $4` : '';
      const textParams = status
        ? [`${searchTrimmed}%`, searchTerm, lim, status]
        : [`${searchTrimmed}%`, searchTerm, lim];
      const textResult = await pool.query(`
        SELECT ${SELECT_COLS},
          CASE
            WHEN UPPER(COALESCE(building_served,'')) LIKE UPPER($1) THEN 0
            WHEN UPPER(COALESCE(city_name,'')) LIKE UPPER($1) THEN 1
            WHEN UPPER(COALESCE(barangay_name,'')) LIKE UPPER($1) THEN 2
            WHEN UPPER(COALESCE(province_name,'')) LIKE UPPER($1) THEN 3
            ELSE 4
          END as other_rank
        FROM naps
        WHERE ${VISAYAS_WHERE}
          AND (
            UPPER(COALESCE(building_served,'')) LIKE UPPER($2)
            OR UPPER(COALESCE(city_name,'')) LIKE UPPER($2)
            OR UPPER(COALESCE(barangay_name,'')) LIKE UPPER($2)
            OR UPPER(COALESCE(province_name,'')) LIKE UPPER($2)
          )
          ${statusFilter2}
        ORDER BY other_rank, nap_id
        LIMIT $3
      `, textParams);
      rows = textResult.rows;
    }

    res.json({
      region: 'visayas',
      count: rows.length,
      naps: rows,
    });
  } catch (error) {
    console.error('Error searching NAPs (napcheck):', error);
    res.status(500).json({ error: 'Failed to search NAPs' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/napcheck/nearest?lat=&lng=&radius_km=&limit= — Visayas-only geo search
// ---------------------------------------------------------------------------
router.get('/nearest', async (req, res) => {
  try {
    const { lat, lng, radius_km = 1, limit = 100 } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radiusNum = Math.min(parseFloat(radius_km) || 1, 10);
    const lim = Math.min(parseInt(limit, 10) || 100, 200);
    const buffer = radiusNum * 1.5 / 111.0;

    const result = await pool.query(`
      SELECT * FROM (
        SELECT ${SELECT_COLS},
          (
            6371 * acos(
              cos(radians($1)) * cos(radians(dp_nap_lat)) *
              cos(radians(dp_nap_long) - radians($2)) +
              sin(radians($1)) * sin(radians(dp_nap_lat))
            )
          ) AS distance_km
        FROM naps
        WHERE ${VISAYAS_WHERE}
          AND dp_nap_lat BETWEEN $5 AND $6
          AND dp_nap_long BETWEEN $7 AND $8
          AND dp_nap_lat IS NOT NULL AND dp_nap_long IS NOT NULL
      ) subq
      WHERE distance_km <= $3
      ORDER BY distance_km
      LIMIT $4
    `, [latNum, lngNum, radiusNum, lim, latNum - buffer, latNum + buffer, lngNum - buffer, lngNum + buffer]);

    res.json({ region: 'visayas', count: result.rows.length, radius_km: radiusNum, naps: result.rows });
  } catch (error) {
    console.error('Error fetching nearest NAPs (napcheck):', error);
    res.status(500).json({ error: 'Failed to fetch nearby NAPs' });
  }
});

// ---------------------------------------------------------------------------
// Shared filter builder for map/list/filter endpoints.
// All values go through parameters — user input is never concatenated.
// ---------------------------------------------------------------------------
const LOW_AVAILABILITY_THRESHOLD = 8; // matches existing marker_color rule (≤8 = yellow)

const AVAIL_SQL = {
  available: 'vacant_lines > 8',
  warning: 'vacant_lines > 0 AND vacant_lines <= 8',
  full: 'vacant_lines = 0',
  unknown: 'vacant_lines IS NULL',
};

// Regional names never concatenated with user input; province values compared
// via parameter.
const RAW_GEO = `COALESCE(province_name, cfs_region, '')`;

const NORMAL_PROVINCE_SQL = `(
  CASE
    WHEN ${RAW_GEO} ILIKE '%EASTERN SAMAR%' THEN 'Eastern Samar'
    WHEN ${RAW_GEO} ILIKE '%NORTHERN SAMAR%' THEN 'Northern Samar'
    WHEN ${RAW_GEO} ILIKE '%SOUTHERN LEYTE%' THEN 'Southern Leyte'
    WHEN ${RAW_GEO} ILIKE '%NEGROS ORIENTAL%' OR regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['DUMAGUETE'] THEN 'Negros Oriental'
    WHEN ${RAW_GEO} ILIKE '%NEGROS OCCIDENTAL%' OR regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['BACOLOD'] THEN 'Negros Occidental'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['ILOILO'] OR ${RAW_GEO} ILIKE '%ILO-ILO%' THEN 'Iloilo'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['CEBU'] THEN 'Cebu'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['BOHOL'] THEN 'Bohol'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['CAPIZ'] THEN 'Capiz'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['ANTIQUE'] THEN 'Antique'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['GUIMARAS'] THEN 'Guimaras'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['AKLAN'] THEN 'Aklan'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['BILIRAN'] THEN 'Biliran'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['SIQUIJOR'] THEN 'Siquijor'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['SAMAR'] THEN 'Samar'
    WHEN regexp_split_to_array(upper(regexp_replace(${RAW_GEO}, '\\s+', ' ', 'g')), '[^A-Z0-9]+') && ARRAY['LEYTE'] THEN 'Leyte'
    ELSE 'Province not specified'
  END
)`;

const MAP_SELECT_COLS = `
  nap_id, dp_nap_lat, dp_nap_long, vacant_lines, working_lines, total_capacity,
  naps_status, barangay_name, city_name, province_name, building_served, updated_at,
  CASE
    WHEN vacant_lines IS NULL THEN 'unknown'
    WHEN vacant_lines = 0 THEN 'full'
    WHEN vacant_lines <= 8 THEN 'warning'
    ELSE 'available'
  END AS availability
`.replace(/\s+/g, ' ').trim();

function buildFilterWhere(query) {
  const { q, status, avail, province, city, barangay } = query;
  const params = [];
  const conds = [];

  if (q && q.trim().length >= 2) {
    const term = q.trim();
    params.push(`${term}%`);
    const p1 = params.length;
    params.push(`%${term}%`);
    const p2 = params.length;
    conds.push(`(UPPER(nap_id) LIKE UPPER($${p1}) OR UPPER(COALESCE(building_served,'')) LIKE UPPER($${p2}) OR UPPER(COALESCE(city_name,'')) LIKE UPPER($${p2}) OR UPPER(COALESCE(barangay_name,'')) LIKE UPPER($${p2}) OR UPPER(COALESCE(province_name,'')) LIKE UPPER($${p2}))`);
  }
  if (status) {
    params.push(String(status));
    conds.push(`naps_status = $${params.length}`);
  }
  if (avail && AVAIL_SQL[String(avail)]) {
    conds.push(`(${AVAIL_SQL[String(avail)]})`);
  }
  if (province) {
    params.push(String(province));
    conds.push(`${NORMAL_PROVINCE_SQL} ILIKE $${params.length}`);
  }
  if (city) {
    params.push(String(city));
    conds.push(`UPPER(COALESCE(city_name,'')) = UPPER($${params.length})`);
  }
  if (barangay) {
    params.push(String(barangay));
    conds.push(`UPPER(COALESCE(barangay_name,'')) = UPPER($${params.length})`);
  }
  return { where: conds.length ? conds.join(' AND ') : 'TRUE', params };
}

// Coordinates validity: never display a pin we cannot trust
const COORD_SAFE = `dp_nap_lat IS NOT NULL AND dp_nap_long IS NOT NULL
  AND dp_nap_lat BETWEEN -90 AND 90 AND dp_nap_long BETWEEN -180 AND 180
  AND NOT (dp_nap_lat = 0 AND dp_nap_long = 0)`.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// GET /api/napcheck/filters — cascading filter options (Visayas-only)
//   /filters                    → normalized provinces + counts
//   /filters?province=Cebu      → cities in that province
//   /filters?province=Cebu&city=X → barangays in that city
// ---------------------------------------------------------------------------
router.get('/filters', async (req, res) => {
  try {
    const { province, city } = req.query;
    if (city) {
      const params = [String(city)];
      const result = await pool.query(`
        SELECT DISTINCT barangay_name
        FROM naps
        WHERE ${VISAYAS_WHERE} AND barangay_name IS NOT NULL AND barangay_name <> ''
          AND UPPER(COALESCE(city_name,'')) = UPPER($1)
        ORDER BY barangay_name
        LIMIT 2000
      `, params);
      return res.json({ region: 'visayas', barangays: result.rows.map((r) => r.barangay_name) });
    }
    if (province) {
      const params = [String(province)];
      const result = await pool.query(`
        SELECT COALESCE(city_name,'') AS city, COUNT(*)::int AS c
        FROM naps
        WHERE ${VISAYAS_WHERE}
          AND ${NORMAL_PROVINCE_SQL} ILIKE $1
        GROUP BY city_name
        ORDER BY c DESC, city
        LIMIT 1500
      `, params);
      return res.json({
        region: 'visayas',
        cities: result.rows.filter((r) => r.city).map((r) => r.city),
      });
    }
    const result = await pool.query(`
      SELECT ${NORMAL_PROVINCE_SQL} AS name, COUNT(*)::int AS count
      FROM naps
      WHERE ${VISAYAS_WHERE}
      GROUP BY ${NORMAL_PROVINCE_SQL}
      ORDER BY count DESC, name
    `);
    res.json({ region: 'visayas', provinces: result.rows });
  } catch (error) {
    console.error('Error fetching napcheck filters:', error);
    res.status(500).json({ error: 'Failed to fetch filter options' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/napcheck/map — viewport-based map data (Visayas-only).
//   bbox=minLng,minLat,maxLng,maxLat — only if provided; filters q/status/
//   avail/province/city/barangay; limit/offset.
//   cols=min — UNCAPAPPED compact mode for the web map: returns every match
//   in the viewport as [id, nap_id, lat, lng, vacant_lines] tuples (gzipped).
//   The web map draws ALL pins — no page cap. Full-record JSON mode (default)
//   keeps limit/offset for other consumers.
//   Returns the matched set + total_matching + availability summary over the
//   FULL filtered set (not just the viewport).
// ---------------------------------------------------------------------------

// Gzip a JSON response when the client accepts it and the payload is large.
// Keeps the uncapped pin payload (~55k tuples at country zoom) lightweight
// without adding a compression dependency.
function sendMaybeGzip(req, res, payload) {
  const accepts = String(req.headers['accept-encoding'] || '');
  if (accepts.includes('gzip')) {
    const body = zlib.gzipSync(JSON.stringify(payload), { level: 6 });
    res.set('Content-Type', 'application/json');
    res.set('Content-Encoding', 'gzip');
    res.set('Vary', 'Accept-Encoding');
    return res.send(body);
  }
  return res.json(payload);
}

router.get('/map', async (req, res) => {
  try {
    const { where: fw, params: fparams } = buildFilterWhere(req.query);
    const hasFilters = fw !== 'TRUE';
    const minimal = req.query.cols === 'min';
    // The summary counts the FULL filtered set — identical for every viewport.
    // When only the bbox changed, the client passes with_summary=0 (it already
    // holds the summary), skipping the COUNT queries per pan/zoom.
    const wantSummary = req.query.with_summary !== '0';

    const limit = Math.min(Math.max(parseInt(String(req.query.limit || 1000), 10) || 1000, 1), 2500);
    const offset = Math.max(parseInt(String(req.query.offset || 0), 10) || 0, 0);

    // Validate bbox if provided (minLng,minLat,maxLng,maxLat)
    let bbox = null;
    if (req.query.bbox) {
      const parts = String(req.query.bbox).split(',').map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        const [minLng, minLat, maxLng, maxLat] = parts;
        const latOk = minLat >= -90 && maxLat <= 90 && maxLat >= minLat;
        const lngOk = minLng >= -180 && maxLng <= 180 && maxLng >= minLng;
        if (latOk && lngOk) bbox = { minLng, minLat, maxLng, maxLat };
      }
      if (!bbox) {
        return res.status(400).json({ error: 'Invalid bbox. Expected minLng,minLat,maxLng,maxLat' });
      }
    }

    // --- Cache lookup (in-memory, TTL 60 s + version-stamped invalidation) ---
    // Cache key covers every input the response depends on; the version
    // stamp (report date + max(updated_at)) covers any data change.
    if (minimal) {
      const cacheKey = [
        fw, fparams.join('\u0001'),
        bbox ? [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat].map((n) => +n.toFixed(5)).join(',') : '',
        wantSummary ? 'summary' : 'nosummary',
        limit, offset,
      ].join('\u0002');
      const version = await napCache.currentVersion();
      const hit = napCache.cacheGet(cacheKey, version);
      if (hit) {
        res.set('Content-Type', 'application/json');
        if (hit.bodyBuffer) {
          res.set('Content-Encoding', 'gzip');
          res.set('Vary', 'Accept-Encoding, Cache-Version');
          return res.send(hit.bodyBuffer);
        }
        res.set('Vary', 'Cache-Version');
        return res.send(hit.bodyJson);
      }
      // remember it for the store step below
      res.locals._napCache = { key: cacheKey, version };
    }

    const geoCond = hasFilters
      ? `${COORD_SAFE} AND ${fw}`
      : COORD_SAFE;

    // Param assembly: filter params first, then (conditionally) bbox params,
    // then limit/offset for the page query.
    // 1) Summary + total_matching share the filter-only WHERE (no bbox) —
    //    only requested when filters changed or on first load.
    const baseWhere = `${VISAYAS_WHERE} AND ${geoCond}`;

    let s = null;
    if (wantSummary) {
      // Single pass: one COUNT per bucket via CASE expressions over the
      // visibility summary + total (replaces four COUNT(*) FILTER passes).
      const summary = await pool.query(`
        SELECT
          COUNT(*)::int AS total_matching,
          SUM(CASE WHEN vacant_lines IS NULL THEN 1 ELSE 0 END)::int AS unknown,
          SUM(CASE WHEN vacant_lines = 0 THEN 1 ELSE 0 END)::int AS full,
          SUM(CASE WHEN vacant_lines > 0 AND vacant_lines <= ${LOW_AVAILABILITY_THRESHOLD} THEN 1 ELSE 0 END)::int AS warning,
          SUM(CASE WHEN vacant_lines > ${LOW_AVAILABILITY_THRESHOLD} THEN 1 ELSE 0 END)::int AS available
        FROM naps
        WHERE ${baseWhere}
      `, fparams);
      s = summary.rows[0];
    }

    // 2) Page query — bbox params appended after filter params.
    const bboxParams = fparams.slice();
    let bboxSql = '';
    if (bbox) {
      bboxSql = ` AND dp_nap_lat BETWEEN $${bboxParams.length + 1} AND $${bboxParams.length + 2}
                  AND dp_nap_long BETWEEN $${bboxParams.length + 3} AND $${bboxParams.length + 4}`;
      bboxParams.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
    }
    const limitParamIdx = bboxParams.length + 1;
    const offsetParamIdx = bboxParams.length + 2;

    let rows;
    let tupleCount = null;
    if (minimal) {
      // Uncapped pin mode — every matching NAP in the viewport, no LIMIT.
      const page = await pool.query(`
        SELECT id, nap_id, dp_nap_lat, dp_nap_long, vacant_lines
        FROM naps
        WHERE ${VISAYAS_WHERE} AND ${geoCond}${bboxSql}
      `, bboxParams);
      tupleCount = page.rows.length;
      rows = page.rows.map((r) => [r.id, r.nap_id, r.dp_nap_lat, r.dp_nap_long, r.vacant_lines]);
    } else {
      const page = await pool.query(`
        SELECT ${MAP_SELECT_COLS}
        FROM naps
        WHERE ${VISAYAS_WHERE} AND ${geoCond}${bboxSql}
        ORDER BY nap_id
        LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}
      `, [...bboxParams, limit, offset]);
      rows = page.rows;
    }

    const payload = {
      region: 'visayas',
      count: tupleCount !== null ? tupleCount : rows.length,
      offset,
      limit: minimal ? null : limit,
      summary_omitted: !wantSummary,
      total_matching: s ? Number(s.total_matching) : undefined,
      summary: s ? {
        available: Number(s.available),
        warning: Number(s.warning),
        full: Number(s.full),
        unknown: Number(s.unknown),
      } : undefined,
      low_availability_threshold: LOW_AVAILABILITY_THRESHOLD,
      bbox_used: Boolean(bbox),
      nap_report_date: napReportDate,
      cols: minimal ? 'min' : 'full',
      rows: minimal ? rows : undefined,
      naps: minimal ? undefined : rows,
    };
    if (minimal) {
      const accepts = String(req.headers['accept-encoding'] || '');
      const wantsGzip = accepts.includes('gzip');
      const bodyJson = JSON.stringify(payload);
      const bodyBuffer = wantsGzip ? zlib.gzipSync(bodyJson, { level: 6 }) : null;
      // Cache the SUCCESS result (never a failure — failures bail above via
      // the catch and never reach this store step).
      const cc = res.locals._napCache;
      if (cc) napCache.cacheSet(cc.key, cc.version, payload, bodyBuffer, bodyJson);
      if (wantsGzip) {
        res.set('Content-Type', 'application/json');
        res.set('Content-Encoding', 'gzip');
        res.set('Vary', 'Accept-Encoding, Cache-Version');
        res.send(bodyBuffer);
      } else {
        res.send(bodyJson);
      }
      return;
    }
    return res.json(payload);
  } catch (error) {
    console.error('Error fetching napcheck map data:', error);
    res.status(500).json({ error: 'Failed to fetch map data' });
  }
});

// ---------------------------------------------------------------------------
// Non-Visayas records return 404 (existence of other-region records is not
// disclosed beyond a generic "not found in this region" hint).
// ---------------------------------------------------------------------------
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(`
      SELECT ${SELECT_COLS}
      FROM naps
      WHERE UPPER(nap_id) = UPPER($1)
        AND ${VISAYAS_WHERE}
      LIMIT 1
    `, [code]);

    if (result.rows.length === 0) {
      // If it exists elsewhere, say so without exposing the record
      const elsewhere = await pool.query(`SELECT 1 FROM naps WHERE UPPER(nap_id) = UPPER($1) LIMIT 1`, [code]);
      if (elsewhere.rows.length > 0) {
        return res.status(404).json({ error: 'NAP not found in the Visayas region' });
      }
      return res.status(404).json({ error: 'NAP not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching NAP detail (napcheck):', error);
    res.status(500).json({ error: 'Failed to fetch NAP' });
  }
});

module.exports = router;
module.exports.VISAYAS_WHERE = VISAYAS_WHERE;
module.exports.VISAYAS_CLASSIFICATION_SQL = VISAYAS_CLASSIFICATION_SQL;
module.exports.VISAYAS_COORD_SQL = VISAYAS_COORD_SQL;
module.exports.COORD_SAFE = COORD_SAFE;
module.exports.LOW_AVAILABILITY_THRESHOLD = LOW_AVAILABILITY_THRESHOLD;
module.exports.napReportDate = napReportDate;
