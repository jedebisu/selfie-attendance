const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Export attendance as CSV
router.get('/attendance', authenticateToken, async (req, res) => {
  try {
    const { user_id, date, status, start_date, end_date } = req.query;

    let query = `
      SELECT a.id, u.name as user_name, u.employee_id, a.status,
             a.timestamp, a.latitude, a.longitude, a.location_name
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let pc = 0;

    if (user_id) { pc++; query += ` AND a.user_id = $${pc}`; params.push(user_id); }
    if (date) { pc++; query += ` AND DATE(a.timestamp + INTERVAL '8 hours') = $${pc}`; params.push(date); }
    if (status) { pc++; query += ` AND a.status = $${pc}`; params.push(status); }
    if (start_date) { pc++; query += ` AND DATE(a.timestamp + INTERVAL '8 hours') >= $${pc}`; params.push(start_date); }
    if (end_date) { pc++; query += ` AND DATE(a.timestamp + INTERVAL '8 hours') <= $${pc}`; params.push(end_date); }

    query += ' ORDER BY a.timestamp DESC';

    const result = await pool.query(query, params);

    const headers = ['ID', 'Employee', 'Employee ID', 'Status', 'Date', 'Time', 'Latitude', 'Longitude', 'Location'];
    const rows = result.rows.map(r => [
      r.id,
      `"${r.user_name}"`,
      r.employee_id,
      r.status === 'clock_in' ? 'Clock In' : 'Clock Out',
      new Date(r.timestamp).toISOString().split('T')[0],
      new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }),
      r.latitude || '',
      r.longitude || '',
      `"${r.location_name || ''}"`
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_export_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting attendance:', error);
    res.status(500).json({ error: 'Failed to export attendance' });
  }
});

// Export leaves as CSV
router.get('/leaves', authenticateToken, async (req, res) => {
  try {
    const { user_id, status, month, year } = req.query;

    let query = `
      SELECT lr.id, u.name as user_name, u.employee_id, lr.leave_date,
             lr.reason, lr.status, approver.name as approved_by_name, lr.created_at
      FROM leave_requests lr
      JOIN users u ON lr.user_id = u.id
      LEFT JOIN users approver ON lr.approved_by = approver.id
      WHERE 1=1
    `;
    const params = [];
    let pc = 0;

    if (user_id) { pc++; query += ` AND lr.user_id = $${pc}`; params.push(user_id); }
    if (status) { pc++; query += ` AND lr.status = $${pc}`; params.push(status); }
    if (month && year) {
      pc++; query += ` AND EXTRACT(MONTH FROM lr.leave_date) = $${pc}`; params.push(month);
      pc++; query += ` AND EXTRACT(YEAR FROM lr.leave_date) = $${pc}`; params.push(year);
    }

    query += ' ORDER BY lr.leave_date DESC';

    const result = await pool.query(query, params);

    const headers = ['ID', 'Employee', 'Employee ID', 'Date', 'Reason', 'Status', 'Approved By'];
    const rows = result.rows.map(r => [
      r.id,
      `"${r.user_name}"`,
      r.employee_id,
      r.leave_date,
      `"${r.reason}"`,
      r.status,
      `"${r.approved_by_name || 'N/A'}"`
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=leaves_export_${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting leaves:', error);
    res.status(500).json({ error: 'Failed to export leaves' });
  }
});

module.exports = router;
