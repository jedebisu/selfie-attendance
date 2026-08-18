const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// Get all leave requests (admin) or own leaves (user)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { user_id, status, month, year } = req.query;
    let query = `
      SELECT lr.*, u.name as user_name, u.employee_id,
             approver.name as approved_by_name
      FROM leave_requests lr
      JOIN users u ON lr.user_id = u.id
      LEFT JOIN users approver ON lr.approved_by = approver.id
      WHERE 1=1
    `;
    const params = [];
    let pc = 0;

    // Non-admins can only see their own leaves
    if (!req.user.is_admin) {
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
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching leaves:', error);
    res.status(500).json({ error: 'Failed to fetch leave requests' });
  }
});

// Get leaves for a specific month (for calendar)
router.get('/month', authenticateToken, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const result = await pool.query(
      `SELECT lr.user_id, lr.leave_date, lr.reason, lr.status, u.name, u.employee_id
       FROM leave_requests lr
       JOIN users u ON lr.user_id = u.id
       WHERE EXTRACT(MONTH FROM lr.leave_date) = $1
         AND EXTRACT(YEAR FROM lr.leave_date) = $2
         AND lr.status = 'approved'
       ORDER BY lr.leave_date`,
      [month, year]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching monthly leaves:', error);
    res.status(500).json({ error: 'Failed to fetch monthly leaves' });
  }
});

// Submit a leave request
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { leave_date, reason } = req.body;

    if (!leave_date || !reason) {
      return res.status(400).json({ error: 'Leave date and reason are required' });
    }

    // Check for existing leave on same date
    const existing = await pool.query(
      `SELECT id FROM leave_requests WHERE user_id = $1 AND leave_date = $2`,
      [req.user.id, leave_date]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Leave request already exists for this date' });
    }

    const result = await pool.query(
      `INSERT INTO leave_requests (user_id, leave_date, reason)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, leave_date, reason]
    );

    res.status(201).json({ message: 'Leave request submitted', request: result.rows[0] });
  } catch (error) {
    console.error('Error creating leave request:', error);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

// Approve/reject leave (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
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

// Delete leave request
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Users can delete their own pending requests; admins can delete any
    let query = 'DELETE FROM leave_requests WHERE id = $1';
    const params = [id];

    if (!req.user.is_admin) {
      query += ' AND user_id = $2 AND status = $3';
      params.push(req.user.id, 'pending');
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Leave request not found or cannot be deleted' });
    }

    res.json({ message: 'Leave request deleted' });
  } catch (error) {
    console.error('Error deleting leave:', error);
    res.status(500).json({ error: 'Failed to delete leave request' });
  }
});

module.exports = router;
