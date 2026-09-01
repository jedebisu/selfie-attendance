const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Get all NAPs (with optional filters)
router.get('/', async (req, res) => {
  try {
    const { city, province, status, limit = 5000, min_lat, max_lat, min_long, max_long } = req.query;

    let query = `
      SELECT 
        id, nap_id, cabinet, location_type, building_served, floors_served,
        working_lines, vacant_lines, total_capacity, cfs_region,
        city_name, province_name, dp_nap_lat, dp_nap_long, 
        naps_status, olt_id, sell_status,
        CASE 
          WHEN vacant_lines = 0 THEN 'red'
          WHEN vacant_lines <= 8 THEN 'yellow'
          ELSE 'green'
        END as marker_color
      FROM naps 
      WHERE dp_nap_lat IS NOT NULL AND dp_nap_long IS NOT NULL
    `;
    const params = [];
    let pc = 0;

    if (min_lat && max_lat && min_long && max_long) {
      pc++;
      query += ` AND dp_nap_lat BETWEEN $${pc}`;
      params.push(min_lat);
      pc++;
      query += ` AND $${pc}`;
      params.push(max_lat);
      pc++;
      query += ` AND dp_nap_long BETWEEN $${pc}`;
      params.push(min_long);
      pc++;
      query += ` AND $${pc}`;
      params.push(max_long);
    }

    if (city) {
      pc++;
      query += ` AND UPPER(city_name) = UPPER($${pc})`;
      params.push(city);
    }

    if (province) {
      pc++;
      query += ` AND UPPER(province_name) = UPPER($${pc})`;
      params.push(province);
    }

    if (status) {
      pc++;
      query += ` AND naps_status = $${pc}`;
      params.push(status);
    }

    query += ` ORDER BY nap_id`;
    
    pc++;
    query += ` LIMIT $${pc}`;
    params.push(limit);

    const result = await pool.query(query, params);

    res.json({
      count: result.rows.length,
      naps: result.rows
    });
  } catch (error) {
    console.error('Error fetching NAPs:', error);
    res.status(500).json({ error: 'Failed to fetch NAP data' });
  }
});

// Get nearest NAPs to a location
router.get('/nearest', async (req, res) => {
  try {
    const { lat, lng, radius = 1, limit = 500 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radiusNum = parseFloat(radius);
    const buffer = radiusNum * 1.5 / 111.0;
    const minLat = latNum - buffer;
    const maxLat = latNum + buffer;
    const minLng = lngNum - buffer;
    const maxLng = lngNum + buffer;

    const result = await pool.query(`
      SELECT * FROM (
        SELECT 
          id, nap_id, cabinet, location_type, building_served, floors_served,
          working_lines, vacant_lines, total_capacity, cfs_region,
          city_name, province_name, barangay_name, dp_nap_lat, dp_nap_long,
          naps_status, olt_id, sell_status,
          CASE 
            WHEN vacant_lines = 0 THEN 'red'
            WHEN vacant_lines <= 8 THEN 'yellow'
            ELSE 'green'
          END as marker_color,
          (
            6371 * acos(
              cos(radians($1)) * cos(radians(dp_nap_lat)) *
              cos(radians(dp_nap_long) - radians($2)) +
              sin(radians($1)) * sin(radians(dp_nap_lat))
            )
          ) AS distance_km
        FROM naps
        WHERE dp_nap_lat BETWEEN $5 AND $6
          AND dp_nap_long BETWEEN $7 AND $8
      ) subq
      WHERE distance_km <= $3
      ORDER BY distance_km
      LIMIT $4
    `, [lat, lng, radius, limit, minLat, maxLat, minLng, maxLng]);

    res.json({
      count: result.rows.length,
      radius_km: radius,
      naps: result.rows
    });
  } catch (error) {
    console.error('Error fetching nearest NAPs:', error);
    res.status(500).json({ error: 'Failed to fetch nearest NAPs' });
  }
});

// Get NAP stats summary (MUST be before /:napId)
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
        SUM(vacant_lines) as available_ports
      FROM naps
      WHERE dp_nap_lat BETWEEN 9.5 AND 12.5
        AND dp_nap_long BETWEEN 122 AND 127
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching NAP stats:', error);
    res.status(500).json({ error: 'Failed to fetch NAP stats' });
  }
});

// Search NAPs by ID, building, city, etc.
// NAP ID matches always take priority; other fields are only used as a
// fallback when no nap_id matches, so ID searches never return unrelated NAPs.
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 100 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchTrimmed = q.trim();
    const searchTerm = `%${searchTrimmed}%`;

    // Pass 1: match on nap_id only (exact > prefix > contains)
    const idResult = await pool.query(`
      SELECT
        id, nap_id, cabinet, location_type, building_served, floors_served,
        working_lines, vacant_lines, total_capacity, cfs_region,
        city_name, province_name, barangay_name, dp_nap_lat, dp_nap_long,
        naps_status, olt_id, sell_status,
        CASE
          WHEN vacant_lines = 0 THEN 'red'
          WHEN vacant_lines <= 8 THEN 'yellow'
          ELSE 'green'
        END as marker_color,
        CASE
          WHEN UPPER(nap_id) = UPPER($1) THEN 0
          WHEN UPPER(nap_id) LIKE UPPER($2) THEN 1
          ELSE 2
        END as relevance
      FROM naps
      WHERE UPPER(nap_id) LIKE UPPER($3)
        AND dp_nap_lat BETWEEN 4 AND 21
        AND dp_nap_long BETWEEN 116 AND 127
      ORDER BY relevance, nap_id
      LIMIT $4
    `, [searchTrimmed, `${searchTrimmed}%`, searchTerm, limit]);

    if (idResult.rows.length > 0) {
      return res.json({
        count: idResult.rows.length,
        naps: idResult.rows
      });
    }

    // Pass 2 (fallback): no nap_id matched — search building, city, etc.
    const result = await pool.query(`
      SELECT
        id, nap_id, cabinet, location_type, building_served, floors_served,
        working_lines, vacant_lines, total_capacity, cfs_region,
        city_name, province_name, barangay_name, dp_nap_lat, dp_nap_long,
        naps_status, olt_id, sell_status,
        CASE
          WHEN vacant_lines = 0 THEN 'red'
          WHEN vacant_lines <= 8 THEN 'yellow'
          ELSE 'green'
        END as marker_color
      FROM naps
      WHERE (
        UPPER(building_served) LIKE UPPER($1)
        OR UPPER(city_name) LIKE UPPER($1)
        OR UPPER(province_name) LIKE UPPER($1)
        OR UPPER(barangay_name) LIKE UPPER($1)
        OR UPPER(cabinet) LIKE UPPER($1)
      )
      AND dp_nap_lat BETWEEN 4 AND 21
      AND dp_nap_long BETWEEN 116 AND 127
      ORDER BY nap_id
      LIMIT $2
    `, [searchTerm, limit]);

    res.json({
      count: result.rows.length,
      naps: result.rows
    });
  } catch (error) {
    console.error('Error searching NAPs:', error);
    res.status(500).json({ error: 'Failed to search NAPs' });
  }
});

// In-memory tracker for the (slow) background NAP import. The full upsert of
// ~318k rows exceeds the hosting proxy's request timeout, so the endpoint
// returns immediately and the import keeps running in the background.
let napImportJob = { running: false, imported: 0, total: 0, done: false, error: null, startedAt: null, finishedAt: null };

// Admin-only: re-import NAPs from the committed naps_export.csv.gz (upsert).
// Runs in the background so the response is returned before the proxy timeout.
router.post('/import', authenticateToken, requireAdmin, async (req, res) => {
  if (napImportJob.running) {
    return res.status(409).json({ error: 'NAP import already in progress' });
  }

  const gzPath = path.join(__dirname, '..', 'config', 'naps_export.csv.gz');
  if (!fs.existsSync(gzPath)) {
    return res.status(404).json({ error: 'naps_export.csv.gz not found on server' });
  }

  // Reset job state
  const job = napImportJob = {
    running: true, imported: 0, total: 0, done: false, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  };

  res.status(202).json({ message: 'NAP import started in background', jobId: 'nap-import' });

  (async () => {
    const client = await pool.connect();
    try {
      const csv = zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf-8');
      const lines = csv.split('\n');

      // 17 params per row; PostgreSQL caps bind at 65535 params, so keep
      // batches at or below 3800 rows (3800 * 17 = 64600)
      const BATCH_SIZE = 3000;
      let imported = 0;
      let batch = [];

      job.total = lines.length;

      await client.query('BEGIN');

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].replace(/\r/g, '');
        if (!line.trim()) continue;

        const f = parseCsvLine17(line);
        if (f.length < 17) continue;

        batch.push(f);
        if (batch.length >= BATCH_SIZE) {
          await upsertNapsBatch(client, batch);
          imported += batch.length;
          job.imported = imported;
          batch = [];
          console.log(`NAP import: ${imported} rows...`);
        }
      }

      if (batch.length > 0) {
        await upsertNapsBatch(client, batch);
        imported += batch.length;
        job.imported = imported;
      }

      await client.query('COMMIT');
      job.done = true;
      job.finishedAt = new Date().toISOString();
      console.log(`NAP import complete: ${imported} rows`);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      job.error = error.message;
      job.done = true;
      job.finishedAt = new Date().toISOString();
      console.error('NAP import failed:', error);
    } finally {
      client.release();
      job.running = false;
    }
  })();
});

// Status of the background NAP import (admin-only)
router.get('/import/status', authenticateToken, requireAdmin, async (req, res) => {
  res.json(napImportJob);
});

function str(val, maxLen) {
  if (!val) return null;
  val = val.trim();
  if (!val) return null;
  if (maxLen && val.length > maxLen) val = val.substring(0, maxLen);
  return val;
}

function parseCsvLine17(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function upsertNapsBatch(client, batch) {
  const values = [];
  const placeholders = [];

  batch.forEach((f, i) => {
    const offset = i * 17;
    placeholders.push(`(${Array.from({ length: 17 }, (_, j) => `$${offset + j + 1}`).join(',')})`);
    values.push(
      str(f[0], 100),   // nap_id
      str(f[1], 100),   // cabinet
      str(f[2], 50),    // location_type
      str(f[3], 500),   // building_served
      str(f[4], 500),   // floors_served
      parseInt(f[5]) || 0,  // working_lines
      parseInt(f[6]) || 0,  // vacant_lines
      parseInt(f[7]) || 0,  // total_capacity
      str(f[8], 100),   // cfs_region
      str(f[9], 100),   // city_name
      str(f[10], 100),  // province_name
      parseFloat(f[11]) || null, // dp_nap_lat
      parseFloat(f[12]) || null, // dp_nap_long
      str(f[13], 50),   // naps_status
      str(f[14], 100),  // olt_id
      str(f[15], 50),   // sell_status
      str(f[16], 100)   // barangay_name
    );
  });

  await client.query(`
    INSERT INTO naps (nap_id, cabinet, location_type, building_served, floors_served,
      working_lines, vacant_lines, total_capacity, cfs_region, city_name, province_name,
      dp_nap_lat, dp_nap_long, naps_status, olt_id, sell_status, barangay_name)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (nap_id) DO UPDATE SET
      cabinet = EXCLUDED.cabinet,
      location_type = EXCLUDED.location_type,
      building_served = EXCLUDED.building_served,
      floors_served = EXCLUDED.floors_served,
      working_lines = EXCLUDED.working_lines,
      vacant_lines = EXCLUDED.vacant_lines,
      total_capacity = EXCLUDED.total_capacity,
      cfs_region = EXCLUDED.cfs_region,
      city_name = EXCLUDED.city_name,
      province_name = EXCLUDED.province_name,
      dp_nap_lat = EXCLUDED.dp_nap_lat,
      dp_nap_long = EXCLUDED.dp_nap_long,
      naps_status = EXCLUDED.naps_status,
      olt_id = EXCLUDED.olt_id,
      sell_status = EXCLUDED.sell_status,
      barangay_name = EXCLUDED.barangay_name,
      updated_at = NOW()
  `, values);
}

// Get NAP details by ID (MUST be after /stats/summary and /search)
router.get('/:napId', async (req, res) => {
  try {
    const { napId } = req.params;

    const result = await pool.query(`
      SELECT 
        *,
        CASE 
          WHEN vacant_lines = 0 THEN 'red'
          WHEN vacant_lines <= 8 THEN 'yellow'
          ELSE 'green'
        END as marker_color
      FROM naps 
      WHERE nap_id = $1
    `, [napId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NAP not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching NAP:', error);
    res.status(500).json({ error: 'Failed to fetch NAP' });
  }
});

module.exports = router;
