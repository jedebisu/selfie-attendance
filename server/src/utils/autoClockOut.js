const { pool } = require('../config/database');

const MAX_HOURS = parseInt(process.env.AUTO_CLOCK_OUT_HOURS, 10) || 9;
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

const autoClockOut = async () => {
  try {
    // Find clocked-in users who have exceeded MAX_HOURS with no clock-out today (Philippine time)
    const result = await pool.query(
      `SELECT a.id AS attendance_id, a.user_id, a.timestamp AS clock_in_time,
              u.name, u.employee_id
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.status = 'clock_in'
         AND u.is_active = true
         AND (a.timestamp + INTERVAL '8 hours')::date = (NOW() + INTERVAL '8 hours')::date
         AND NOW() > a.timestamp + ($1 || ' hours')::interval
         AND NOT EXISTS (
           SELECT 1 FROM attendance o
           WHERE o.user_id = a.user_id AND o.status = 'clock_out'
             AND (o.timestamp, o.id) > (a.timestamp, a.id)
             AND (o.timestamp + INTERVAL '8 hours')::date = (NOW() + INTERVAL '8 hours')::date
         )
         AND NOT EXISTS (
           SELECT 1 FROM attendance n
           WHERE n.user_id = a.user_id AND n.status = 'clock_in'
             AND (n.timestamp, n.id) > (a.timestamp, a.id)
         )
       ORDER BY a.timestamp ASC`,
      [MAX_HOURS]
    );

    if (result.rows.length === 0) return;

    console.log(`Auto clock-out: ${result.rowCount} employee(s) exceeded ${MAX_HOURS}h`);

    for (const row of result.rows) {
      // Get last known GPS ping location
      const pingResult = await pool.query(
        `SELECT latitude, longitude FROM location_pings
         WHERE user_id = $1
         ORDER BY pinged_at DESC LIMIT 1`,
        [row.user_id]
      );

      const ping = pingResult.rows[0];
      const lat = ping?.latitude || null;
      const lng = ping?.longitude || null;

      await pool.query(
        `INSERT INTO attendance (user_id, status, timestamp, latitude, longitude, location_name, device_info)
         VALUES ($1, 'clock_out', NOW(), $2, $3, $4, $5)`,
        [
          row.user_id,
          lat,
          lng,
          'Auto clock-out',
          JSON.stringify({ auto: true, reason: `${MAX_HOURS}h limit exceeded`, clocked_in_at: row.clock_in_time })
        ]
      );

      console.log(`Auto clock-out: ${row.name} (${row.employee_id}) — clocked in at ${row.clock_in_time}`);
    }
  } catch (error) {
    console.error('Auto clock-out error:', error.message);
  }
};

const scheduleAutoClockOut = () => {
  console.log(`Auto clock-out scheduled: checking every 15 min for >${MAX_HOURS}h shifts`);
  // Run once shortly after boot (2 minutes), then every 15 minutes
  setTimeout(() => {
    autoClockOut();
    setInterval(autoClockOut, CHECK_INTERVAL_MS);
  }, 2 * 60 * 1000);
};

module.exports = { scheduleAutoClockOut };
