const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const MAX_PINGS_PER_REQUEST = 200;

const findOpenShift = async (userId) => {
  const result = await pool.query(
    `SELECT a.id, a.user_id, a.latitude, a.longitude, a.timestamp AS clock_in_time,
            u.name, u.employee_id
     FROM attendance a
     JOIN users u ON u.id = a.user_id
     WHERE a.user_id = $1
       AND a.status = 'clock_in'
       AND NOT EXISTS (
         SELECT 1 FROM attendance o
         WHERE o.user_id = a.user_id AND o.status = 'clock_out'
           AND (o.timestamp, o.id) > (a.timestamp, a.id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM attendance n
         WHERE n.user_id = a.user_id AND n.status = 'clock_in'
           AND (n.timestamp, n.id) > (a.timestamp, a.id)
       )
     ORDER BY a.timestamp DESC, a.id DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
};

const toNumberOrNull = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

router.post('/pings', authenticateToken, async (req, res) => {
  try {
    const { pings } = req.body;
    if (!Array.isArray(pings) || pings.length === 0) {
      return res.status(400).json({ error: 'pings array is required' });
    }
    if (pings.length > MAX_PINGS_PER_REQUEST) {
      return res.status(400).json({ error: `Maximum ${MAX_PINGS_PER_REQUEST} pings per request` });
    }

    const openShift = await findOpenShift(req.user.id);
    if (!openShift) {
      return res.status(200).json({ stored: 0, reason: 'not_clocked_in' });
    }

    const validPings = [];
    for (const ping of pings) {
      const latitude = toNumberOrNull(ping.latitude);
      const longitude = toNumberOrNull(ping.longitude);
      if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        continue;
      }
      let pingedAt = ping.pinged_at || ping.timestamp ? new Date(ping.pinged_at || ping.timestamp) : new Date();
      if (isNaN(pingedAt.getTime())) {
        pingedAt = new Date();
      }
      validPings.push({
        latitude,
        longitude,
        accuracyM: toNumberOrNull(ping.accuracy_m ?? ping.accuracy),
        speedMps: toNumberOrNull(ping.speed_mps ?? ping.speed),
        batteryPct: (() => {
          const b = parseInt(ping.battery_pct ?? ping.battery, 10);
          return Number.isFinite(b) ? Math.min(Math.max(b, 0), 100) : null;
        })(),
        pingedAt
      });
    }

    if (validPings.length === 0) {
      return res.status(400).json({ error: 'No valid pings in payload' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const p of validPings) {
        await client.query(
          `INSERT INTO location_pings (user_id, attendance_id, latitude, longitude, accuracy_m, speed_mps, battery_pct, pinged_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.user.id, openShift.id, p.latitude, p.longitude, p.accuracyM, p.speedMps, p.batteryPct, p.pingedAt]
        );
      }
      await client.query('COMMIT');
    } catch (insertError) {
      await client.query('ROLLBACK');
      throw insertError;
    } finally {
      client.release();
    }

    res.status(201).json({ stored: validPings.length, attendance_id: openShift.id });
  } catch (error) {
    console.error('Error storing location pings:', error);
    res.status(500).json({ error: 'Failed to store location pings' });
  }
});

router.get('/live', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const openShifts = await pool.query(
      `SELECT a.id AS attendance_id, a.user_id, a.latitude AS clock_in_latitude,
              a.longitude AS clock_in_longitude, a.timestamp AS clock_in_time,
              u.name, u.employee_id
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.is_active = true
         AND a.status = 'clock_in'
         AND NOT EXISTS (
           SELECT 1 FROM attendance o
           WHERE o.user_id = a.user_id AND o.status = 'clock_out'
             AND (o.timestamp, o.id) > (a.timestamp, a.id)
         )
         AND NOT EXISTS (
           SELECT 1 FROM attendance n
           WHERE n.user_id = a.user_id AND n.status = 'clock_in'
             AND (n.timestamp, n.id) > (a.timestamp, a.id)
         )
       ORDER BY a.timestamp DESC`
    );

    const shiftIds = openShifts.rows.map((row) => row.attendance_id);
    let latestByShift = {};
    if (shiftIds.length > 0) {
      const latestPings = await pool.query(
        `SELECT DISTINCT ON (attendance_id)
                attendance_id, latitude, longitude, accuracy_m, battery_pct, pinged_at
         FROM location_pings
         WHERE attendance_id = ANY($1)
         ORDER BY attendance_id, pinged_at DESC, id DESC`,
        [shiftIds]
      );
      for (const row of latestPings.rows) {
        latestByShift[row.attendance_id] = {
          latitude: row.latitude,
          longitude: row.longitude,
          accuracy_m: row.accuracy_m,
          battery_pct: row.battery_pct,
          pinged_at: row.pinged_at
        };
      }
    }

    const users = openShifts.rows.map((row) => ({
      user_id: row.user_id,
      name: row.name,
      employee_id: row.employee_id,
      attendance_id: row.attendance_id,
      clock_in_time: row.clock_in_time,
      clock_in_location: row.clock_in_latitude && row.clock_in_longitude
        ? { latitude: row.clock_in_latitude, longitude: row.clock_in_longitude }
        : null,
      latest: latestByShift[row.attendance_id] || null
    }));

    res.json({ users });
  } catch (error) {
    console.error('Error fetching live locations:', error);
    res.status(500).json({ error: 'Failed to fetch live locations' });
  }
});

router.get('/trail/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const date = req.query.date || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    const pings = await pool.query(
      `SELECT id, attendance_id, latitude, longitude, accuracy_m, speed_mps, battery_pct, pinged_at
       FROM location_pings
       WHERE user_id = $1 AND (pinged_at + INTERVAL '8 hours')::date = $2::date
       ORDER BY pinged_at ASC, id ASC`,
      [userId, date]
    );

    const events = await pool.query(
      `SELECT id, status, latitude, longitude, timestamp, photo_url
       FROM attendance
       WHERE user_id = $1 AND (timestamp + INTERVAL '8 hours')::date = $2::date
       ORDER BY timestamp ASC, id ASC`,
      [userId, date]
    );

    res.json({
      user_id: userId,
      date,
      pings: pings.rows,
      events: events.rows
    });
  } catch (error) {
    console.error('Error fetching location trail:', error);
    res.status(500).json({ error: 'Failed to fetch location trail' });
  }
});

module.exports = router;
