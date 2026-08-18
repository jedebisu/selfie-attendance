const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Get all NAPs (with optional filters)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { city, province, status, limit = 500 } = req.query;

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
router.get('/nearest', authenticateToken, async (req, res) => {
  try {
    const { lat, lng, radius = 5, limit = 20 } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    // Using Haversine formula for distance calculation
    const result = await pool.query(`
      SELECT 
        id, nap_id, cabinet, location_type, building_served, floors_served,
        working_lines, vacant_lines, total_capacity, cfs_region,
        city_name, province_name, dp_nap_lat, dp_nap_long,
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
      WHERE dp_nap_lat IS NOT NULL AND dp_nap_long IS NOT NULL
        AND vacant_lines > 0
      HAVING (
          6371 * acos(
            cos(radians($1)) * cos(radians(dp_nap_lat)) *
            cos(radians(dp_nap_long) - radians($2)) +
            sin(radians($1)) * sin(radians(dp_nap_lat))
          )
        ) <= $3
      ORDER BY distance_km
      LIMIT $4
    `, [lat, lng, radius, limit]);

    res.json({
      count: result.rows.length,
      naps: result.rows
    });
  } catch (error) {
    console.error('Error fetching nearest NAPs:', error);
    res.status(500).json({ error: 'Failed to fetch nearest NAPs' });
  }
});

// Get NAP details by ID
router.get('/:napId', authenticateToken, async (req, res) => {
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

// Get NAP stats summary
router.get('/stats/summary', authenticateToken, async (req, res) => {
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
      WHERE dp_nap_lat IS NOT NULL
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching NAP stats:', error);
    res.status(500).json({ error: 'Failed to fetch NAP stats' });
  }
});

module.exports = router;
