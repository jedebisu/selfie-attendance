const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

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
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 100 } = req.query;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchTrimmed = q.trim();
    const searchTerm = `%${searchTrimmed}%`;

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
        END as marker_color,
        CASE
          WHEN UPPER(nap_id) = UPPER($1) THEN 0
          WHEN UPPER(nap_id) LIKE UPPER($2) THEN 1
          WHEN UPPER(nap_id) LIKE UPPER($3) THEN 2
          ELSE 3
        END as relevance
      FROM naps
      WHERE (
        UPPER(nap_id) LIKE UPPER($3)
        OR UPPER(building_served) LIKE UPPER($3)
        OR UPPER(city_name) LIKE UPPER($3)
        OR UPPER(province_name) LIKE UPPER($3)
        OR UPPER(barangay_name) LIKE UPPER($3)
        OR UPPER(cabinet) LIKE UPPER($3)
      )
      AND dp_nap_lat BETWEEN 4 AND 21
      AND dp_nap_long BETWEEN 116 AND 127
      ORDER BY relevance, nap_id
      LIMIT $4
    `, [searchTrimmed, `${searchTrimmed}%`, searchTerm, limit]);

    res.json({
      count: result.rows.length,
      naps: result.rows
    });
  } catch (error) {
    console.error('Error searching NAPs:', error);
    res.status(500).json({ error: 'Failed to search NAPs' });
  }
});

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
