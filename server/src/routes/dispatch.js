const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { optionalAuth, requireAdmin, authenticateToken } = require('../middleware/auth');

// Configurable statuses
router.get('/statuses', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM work_order_statuses ORDER BY sort_order, code');
  res.json({ statuses: rows });
});

router.post('/statuses', optionalAuth, requireAdmin, async (req, res) => {
  const { code, label, color, sort_order, is_terminal } = req.body || {};
  if (!code || !label) return res.status(400).json({ error: 'code and label are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO work_order_statuses (code, label, color, sort_order, is_terminal)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [String(code).toUpperCase().trim(), label, color || '#6b7280', sort_order || 99, !!is_terminal]
    );
    res.status(201).json({ status: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Status already exists' });
    res.status(500).json({ error: 'Failed to create status' });
  }
});

router.patch('/statuses/:code', optionalAuth, requireAdmin, async (req, res) => {
  const { label, color, sort_order, is_terminal, is_active } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE work_order_statuses SET
         label = COALESCE($2, label),
         color = COALESCE($3, color),
         sort_order = COALESCE($4, sort_order),
         is_terminal = COALESCE($5, is_terminal),
         is_active = COALESCE($6, is_active)
       WHERE code = $1 RETURNING *`,
      [req.params.code, label, color, sort_order, is_terminal, is_active]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Status not found' });
    res.json({ status: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Configurable channels
router.get('/channels', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM work_order_channels ORDER BY sort_order, code');
  res.json({ channels: rows });
});

router.post('/channels', optionalAuth, requireAdmin, async (req, res) => {
  const { code, label, color, sort_order } = req.body || {};
  if (!code || !label) return res.status(400).json({ error: 'code and label are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO work_order_channels (code, label, color, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [String(code).toUpperCase().trim(), label, color || '#3b82f6', sort_order || 99]
    );
    res.status(201).json({ channel: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Channel already exists' });
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

router.patch('/channels/:code', optionalAuth, requireAdmin, async (req, res) => {
  const { label, color, sort_order, is_active } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE work_order_channels SET
       label = COALESCE($2, label), color = COALESCE($3, color),
       sort_order = COALESCE($4, sort_order), is_active = COALESCE($5, is_active)
     WHERE code = $1 RETURNING *`,
    [req.params.code, label, color, sort_order, is_active]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
  res.json({ channel: rows[0] });
});

// Technicians / teams
router.get('/technicians', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM technicians WHERE is_active = true ORDER BY name');
  res.json({ technicians: rows });
});

router.post('/technicians', authenticateToken, async (req, res) => {
  try {
    const { name, team, phone } = req.body || {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) return res.status(400).json({ error: 'Name is required' });
    const dup = await pool.query(
      'SELECT id FROM technicians WHERE lower(trim(name)) = lower($1) LIMIT 1',
      [cleanName]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'A technician with this name already exists' });
    }
    const { rows } = await pool.query(
      'INSERT INTO technicians (name, team, phone) VALUES ($1, $2, $3) RETURNING *',
      [cleanName, team || null, phone || null]
    );
    res.status(201).json({ technician: rows[0] });
  } catch (error) {
    console.error('create technician error:', error);
    res.status(500).json({ error: 'Failed to create technician' });
  }
});

router.patch('/technicians/:id', authenticateToken, async (req, res) => {
  const { name, team, phone, is_active } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE technicians SET
       name = COALESCE($2, name), team = COALESCE($3, team),
       phone = COALESCE($4, phone), is_active = COALESCE($5, is_active)
     WHERE id = $1 RETURNING *`,
    [req.params.id, name, team, phone, is_active]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Technician not found' });
  res.json({ technician: rows[0] });
});

router.delete('/technicians/:id', authenticateToken, async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE technicians SET is_active = false WHERE id = $1 RETURNING *',
    [req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'Technician not found' });
  res.json({ success: true });
});

module.exports = router;
