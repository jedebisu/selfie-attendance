const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

router.get('/overview', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = end_date || new Date().toISOString().split('T')[0];

    const totalResult = await pool.query('SELECT COUNT(*) as total FROM users WHERE is_active = true');
    const totalEmployees = parseInt(totalResult.rows[0].total);

    const attendanceResult = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as present_count
      FROM attendance
      WHERE status = 'clock_in'
        AND DATE(timestamp) >= $1
        AND DATE(timestamp) <= $2
    `, [start, end]);

    const daysResult = await pool.query(`
      SELECT COUNT(DISTINCT DATE(timestamp)) as days
      FROM attendance
      WHERE DATE(timestamp) >= $1
        AND DATE(timestamp) <= $2
    `, [start, end]);

    const totalDays = parseInt(daysResult.rows[0].days) || 1;
    const avgAttendance = totalEmployees > 0
      ? Math.round((attendanceResult.rows[0].present_count / totalEmployees) * 100 / totalDays * 10) / 10
      : 0;

    const hoursResult = await pool.query(`
      WITH daily_pairs AS (
        SELECT
          user_id,
          DATE(timestamp) as day,
          MIN(CASE WHEN status = 'clock_in' THEN timestamp END) as clock_in,
          MAX(CASE WHEN status = 'clock_out' THEN timestamp END) as clock_out
        FROM attendance
        WHERE DATE(timestamp) >= $1 AND DATE(timestamp) <= $2
        GROUP BY user_id, DATE(timestamp)
        HAVING MIN(CASE WHEN status = 'clock_in' THEN timestamp END) IS NOT NULL
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600) as avg_hours,
        SUM(CASE WHEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600 > 8
          THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600 - 8 ELSE 0 END) as total_overtime
      FROM daily_pairs
      WHERE clock_out IS NOT NULL
    `, [start, end]);

    const todayResult = await pool.query(`
      SELECT COUNT(DISTINCT CASE WHEN status = 'clock_in' THEN user_id END) as present,
             COUNT(DISTINCT CASE WHEN status = 'clock_out' THEN user_id END) as clocked_out
      FROM attendance
      WHERE DATE(timestamp) = CURRENT_DATE
    `);

    const leaveResult = await pool.query(`
      SELECT COUNT(*) as on_leave
      FROM leave_requests
      WHERE status = 'approved'
        AND leave_date >= $1
        AND leave_date <= $2
    `, [start, end]);

    const lateResult = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as late_count
      FROM attendance
      WHERE status = 'clock_in'
        AND DATE(timestamp) >= $1
        AND DATE(timestamp) <= $2
        AND EXTRACT(HOUR FROM timestamp) > 9
    `, [start, end]);

    res.json({
      totalEmployees,
      avgAttendanceRate: avgAttendance,
      avgHoursWorked: parseFloat(hoursResult.rows[0].avg_hours?.toFixed(1) || 0),
      totalOvertimeHours: parseFloat(hoursResult.rows[0].total_overtime?.toFixed(1) || 0),
      presentToday: parseInt(todayResult.rows[0].present),
      absentToday: totalEmployees - parseInt(todayResult.rows[0].present),
      totalLeaves: parseInt(leaveResult.rows[0].on_leave),
      lateArrivals: parseInt(lateResult.rows[0].late_count)
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

router.get('/attendance-trend', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date, user_id } = req.query;
    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = end_date || new Date().toISOString().split('T')[0];

    const totalResult = await pool.query('SELECT COUNT(*) as total FROM users WHERE is_active = true');
    const totalEmployees = parseInt(totalResult.rows[0].total);

    const userFilter = user_id ? 'AND a.user_id = $4' : '';
    const params = user_id ? [start, end, totalEmployees, user_id] : [start, end, totalEmployees];

    const result = await pool.query(`
      WITH date_range AS (
        SELECT generate_series($1::date, $2::date, '1 day'::interval)::date as day
      ),
      daily_counts AS (
        SELECT
          dr.day,
          COUNT(DISTINCT CASE WHEN a.status = 'clock_in' THEN a.user_id END) as present_count
        FROM date_range dr
        LEFT JOIN attendance a ON DATE(a.timestamp) = dr.day ${userFilter}
        GROUP BY dr.day
        ORDER BY dr.day
      )
      SELECT
        day,
        present_count,
        $3 as total_employees,
        ROUND(present_count * 100.0 / NULLIF($3, 0), 1) as attendance_rate
      FROM daily_counts
    `, params);

    res.json({ trend: result.rows, totalEmployees });
  } catch (error) {
    console.error('Attendance trend error:', error);
    res.status(500).json({ error: 'Failed to fetch attendance trend' });
  }
});

router.get('/hours-worked', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = end_date || new Date().toISOString().split('T')[0];

    const result = await pool.query(`
      WITH daily_pairs AS (
        SELECT
          a.user_id,
          DATE(a.timestamp) as day,
          MIN(CASE WHEN a.status = 'clock_in' THEN a.timestamp END) as clock_in,
          MAX(CASE WHEN a.status = 'clock_out' THEN a.timestamp END) as clock_out
        FROM attendance a
        WHERE DATE(a.timestamp) >= $1 AND DATE(a.timestamp) <= $2
        GROUP BY a.user_id, DATE(a.timestamp)
      ),
      user_hours AS (
        SELECT
          user_id,
          SUM(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600) as total_hours,
          COUNT(*) as days_worked,
          AVG(EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600) as avg_daily_hours,
          SUM(CASE WHEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600 > 8
            THEN EXTRACT(EPOCH FROM (clock_out - clock_in)) / 3600 - 8 ELSE 0 END) as overtime_hours
        FROM daily_pairs
        WHERE clock_out IS NOT NULL
        GROUP BY user_id
      )
      SELECT
        u.id as user_id,
        u.name,
        u.employee_id,
        COALESCE(uh.total_hours, 0) as total_hours,
        COALESCE(uh.days_worked, 0) as days_worked,
        COALESCE(uh.avg_daily_hours, 0) as avg_daily_hours,
        COALESCE(uh.overtime_hours, 0) as overtime_hours
      FROM users u
      LEFT JOIN user_hours uh ON u.id = uh.user_id
      WHERE u.is_active = true
      ORDER BY uh.total_hours DESC NULLS LAST
    `, [start, end]);

    res.json({ employees: result.rows });
  } catch (error) {
    console.error('Hours worked error:', error);
    res.status(500).json({ error: 'Failed to fetch hours worked' });
  }
});

router.get('/clock-in-distribution', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const start = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = end_date || new Date().toISOString().split('T')[0];

    const result = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM timestamp)::int as hour,
        COUNT(*) as count
      FROM attendance
      WHERE status = 'clock_in'
        AND DATE(timestamp) >= $1
        AND DATE(timestamp) <= $2
      GROUP BY EXTRACT(HOUR FROM timestamp)
      ORDER BY hour
    `, [start, end]);

    const allHours = [];
    for (let h = 5; h <= 12; h++) {
      const found = result.rows.find(r => r.hour === h);
      allHours.push({
        hour: `${h.toString().padStart(2, '0')}:00`,
        count: found ? parseInt(found.count) : 0
      });
    }

    res.json({ distribution: allHours });
  } catch (error) {
    console.error('Clock-in distribution error:', error);
    res.status(500).json({ error: 'Failed to fetch clock-in distribution' });
  }
});

router.get('/day-of-week', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const start = start_date || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = end_date || new Date().toISOString().split('T')[0];

    const totalResult = await pool.query('SELECT COUNT(*) as total FROM users WHERE is_active = true');
    const totalEmployees = parseInt(totalResult.rows[0].total);

    const result = await pool.query(`
      WITH daily_attendance AS (
        SELECT
          EXTRACT(DOW FROM DATE(timestamp)) as dow,
          DATE(timestamp) as day,
          COUNT(DISTINCT user_id) as present_count
        FROM attendance
        WHERE status = 'clock_in'
          AND DATE(timestamp) >= $1
          AND DATE(timestamp) <= $2
        GROUP BY EXTRACT(DOW FROM DATE(timestamp)), DATE(timestamp)
      ),
      avg_by_dow AS (
        SELECT
          dow,
          ROUND(AVG(present_count), 1) as avg_present
        FROM daily_attendance
        GROUP BY dow
      )
      SELECT
        dow,
        CASE dow
          WHEN 0 THEN 'Sunday'
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
          WHEN 4 THEN 'Thursday'
          WHEN 5 THEN 'Friday'
          WHEN 6 THEN 'Saturday'
        END as day_name,
        COALESCE(avg_present, 0) as avg_attendance,
        $3 as total_employees,
        ROUND(COALESCE(avg_present, 0) * 100.0 / NULLIF($3, 0), 1) as attendance_rate
      FROM (
        SELECT generate_series(0, 6) as dow
      ) days
      LEFT JOIN avg_by_dow USING (dow)
      ORDER BY dow
    `, [start, end, totalEmployees]);

    res.json({ days: result.rows });
  } catch (error) {
    console.error('Day of week error:', error);
    res.status(500).json({ error: 'Failed to fetch day-of-week analysis' });
  }
});

module.exports = router;
