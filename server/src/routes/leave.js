const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const isHR = (user) => user.role === 'hr';
const isCEO = (user) => user.role === 'ceo';

// Convert a pg DATE value (string or Date-at-local-midnight) to YYYY-MM-DD
// without timezone drift
function ymd(d) {
  return typeof d === 'string' ? d.slice(0, 10) : d.toLocaleDateString('en-CA');
}

// Count all days between two YYYY-MM-DD dates, inclusive (weekends included)
function countLeaveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let days = 0;
  for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    days++;
  }
  return days;
}

// Get all leave requests (admin) or own leaves (user)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { user_id, status, month, year } = req.query;
    let query = `
      SELECT lr.*, u.name as user_name, u.employee_id,
             u.leave_balance as user_balance,
             approver.name as approved_by_name
      FROM leave_requests lr
      JOIN users u ON lr.user_id = u.id
      LEFT JOIN users approver ON lr.approved_by = approver.id
      WHERE 1=1
    `;
    const params = [];
    let pc = 0;

    // HR and CEO see all leaves; everyone else sees only their own
    if (!isHR(req.user) && !isCEO(req.user)) {
      pc++;
      query += ` AND lr.user_id = $${pc}`;
      params.push(req.user.id);
    } else if (user_id) {
      pc++;
      query += ` AND lr.user_id = $${pc}`;
      params.push(user_id);
    }

    if (status) {
      pc++;
      query += ` AND lr.status = $${pc}`;
      params.push(status);
    }

    if (month && year) {
      pc++;
      query += ` AND EXTRACT(MONTH FROM lr.leave_date) = $${pc}`;
      params.push(month);
      pc++;
      query += ` AND EXTRACT(YEAR FROM lr.leave_date) = $${pc}`;
      params.push(year);
    }

    query += ' ORDER BY lr.leave_date DESC';

    const result = await pool.query(query, params);

    // Attach computed workday count per request
    const leaves = result.rows.map(row => ({
      ...row,
      end_date: row.end_date || row.leave_date,
      days: countLeaveDays(
        ymd(row.leave_date),
        ymd(row.end_date || row.leave_date)
      )
    }));

    res.json(leaves);
  } catch (error) {
    console.error('Error fetching leaves:', error);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

// Get own remaining balance
router.get('/balance/me', authenticateToken, async (req, res) => {
  try {
    const approved = await pool.query(
      `SELECT leave_date, end_date FROM leave_requests WHERE user_id = $1 AND status = 'approved'`,
      [req.user.id]
    );
    let used = 0;
    approved.rows.forEach(r => {
      const start = ymd(r.leave_date);
      const end = ymd(r.end_date || r.leave_date);
      used += countLeaveDays(start, end);
    });

    const balanceResult = await pool.query(
      'SELECT leave_balance FROM users WHERE id = $1',
      [req.user.id]
    );
    const total = balanceResult.rows[0]?.leave_balance ?? 4;

    res.json({ total, used, remaining: Math.max(0, total - used) });
  } catch (error) {
    console.error('Error fetching leave balance:', error);
    res.status(500).json({ error: 'Failed to fetch leave balance' });
  }
});

// Get leaves for a specific month (for calendar) — expands date ranges
router.get('/month', authenticateToken, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const yearNum = parseInt(year);
    const monthNum = parseInt(month);
    const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(yearNum, monthNum, 0)).getUTCDate();
    const monthEnd = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const result = await pool.query(
      `SELECT lr.user_id, lr.leave_date, lr.end_date, lr.reason, lr.status, u.name, u.employee_id
       FROM leave_requests lr
       JOIN users u ON lr.user_id = u.id
       WHERE lr.status = 'approved'
         AND lr.leave_date <= $2::date
         AND COALESCE(lr.end_date, lr.leave_date) >= $1::date
       ORDER BY lr.leave_date`,
      [monthStart, monthEnd]
    );

    // Expand each range into individual dates within the month
    const expanded = [];
    result.rows.forEach(leave => {
      const start = ymd(leave.leave_date) > monthStart ? ymd(leave.leave_date) : monthStart;
      const end = ymd(leave.end_date || leave.leave_date) < monthEnd ? ymd(leave.end_date || leave.leave_date) : monthEnd;
      for (let cur = new Date(`${start}T00:00:00Z`); cur <= new Date(`${end}T00:00:00Z`); cur.setUTCDate(cur.getUTCDate() + 1)) {
        expanded.push({
          ...leave,
          leave_date: cur.toISOString().slice(0, 10)
        });
      }
    });

    res.json(expanded);
  } catch (error) {
    console.error('Error fetching monthly leaves:', error);
    res.status(500).json({ error: 'Failed to fetch monthly leaves' });
  }
});

// Submit a leave request (single day or date range) — HR only
router.post('/', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  try {
    if (!isHR(req.user)) {
      return res.status(403).json({ error: 'Only HR can file leave requests' });
    }

    const { leave_date, start_date, end_date, reason, user_id } = req.body;

    // HR files on behalf of an employee (defaults to themselves)
    const targetUserId = user_id ? parseInt(user_id) : req.user.id;

    const startDate = start_date || leave_date;
    const endDate = end_date || startDate;

    if (!startDate || !reason) {
      return res.status(400).json({ error: 'Leave date and reason are required' });
    }
    if (endDate < startDate) {
      return res.status(400).json({ error: 'End date cannot be before start date' });
    }

    const workdays = countLeaveDays(startDate, endDate);
    if (workdays === 0) {
      return res.status(400).json({ error: 'Invalid leave range' });
    }

    await client.query('BEGIN');

    // Overlap check against pending/approved requests
    const overlap = await client.query(
      `SELECT id FROM leave_requests
       WHERE user_id = $1 AND status IN ('pending', 'approved')
         AND leave_date <= $3 AND COALESCE(end_date, leave_date) >= $2`,
      [targetUserId, startDate, endDate]
    );
    if (overlap.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'You already have a leave request overlapping these dates' });
    }

    // Balance check (pending + approved consume from the same pool)
    const committed = await client.query(
      `SELECT leave_date, end_date FROM leave_requests
       WHERE user_id = $1 AND status IN ('pending', 'approved')`,
      [targetUserId]
    );
    let usedDays = 0;
    committed.rows.forEach(r => {
      usedDays += countLeaveDays(
        ymd(r.leave_date),
        ymd(r.end_date || r.leave_date)
      );
    });
    const balResult = await client.query(
      'SELECT leave_balance FROM users WHERE id = $1',
      [targetUserId]
    );
    const totalBalance = balResult.rows[0]?.leave_balance ?? 4;
    if (usedDays + workdays > totalBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Insufficient leave balance: requesting ${workdays} day(s) but only ${Math.max(0, totalBalance - usedDays)} remaining`
      });
    }

    const result = await client.query(
      `INSERT INTO leave_requests (user_id, leave_date, end_date, reason)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [targetUserId, startDate, endDate, reason]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Leave request submitted',
      request: { ...result.rows[0], days: workdays }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating leave request:', error);
    res.status(500).json({ error: 'Failed to submit leave request' });
  } finally {
    client.release();
  }
});

// Approve/reject leave — CEO only
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (!isCEO(req.user)) {
      return res.status(403).json({ error: 'Only the CEO can approve or reject leave requests' });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }

    const result = await pool.query(
      `UPDATE leave_requests
       SET status = $1, approved_by = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, req.user.id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    res.json({ message: `Leave ${status}`, request: result.rows[0] });
  } catch (error) {
    console.error('Error updating leave:', error);
    res.status(500).json({ error: 'Failed to update leave request' });
  }
});

// Delete leave request — HR or CEO only
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!isHR(req.user) && !isCEO(req.user)) {
      return res.status(403).json({ error: 'Only HR or the CEO can delete leave requests' });
    }

    const { id } = req.params;

    const result = await pool.query('DELETE FROM leave_requests WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found' });
    }

    res.json({ message: 'Leave request deleted' });
  } catch (error) {
    console.error('Error deleting leave:', error);
    res.status(500).json({ error: 'Failed to delete leave request' });
  }
});

module.exports = router;
