const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const VALID_ROLES = ['employee', 'admin', 'hr', 'ceo'];

// Get all users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, employee_id, name, email, is_active, is_admin, role, created_at FROM users ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get single user
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, employee_id, name, email, is_active, is_admin, role, created_at FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Create user (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { employee_id, name, email, pin, role } = req.body;

    if (!employee_id || !name || !pin) {
      return res.status(400).json({ error: 'Employee ID, name, and PIN are required' });
    }

    const userRole = role || 'employee';
    if (!VALID_ROLES.includes(userRole)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Hash PIN
    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(pin, salt);

    const result = await pool.query(
      `INSERT INTO users (employee_id, name, email, pin, is_admin, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, employee_id, name, email, is_admin, role, created_at`,
      [employee_id, name, email || null, hashedPin, userRole === 'admin', userRole]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Employee ID already exists' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (admin only for most fields; users can update their own name/email)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, pin, is_active, role } = req.body;

    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Hash PIN if provided
    let hashedPin = null;
    if (pin) {
      const salt = await bcrypt.genSalt(10);
      hashedPin = await bcrypt.hash(pin, salt);
    }

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           pin = COALESCE($3, pin),
           is_active = COALESCE($4, is_active),
           role = COALESCE($5, role),
           is_admin = COALESCE($6, is_admin),
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, employee_id, name, email, is_active, is_admin, role, updated_at`,
      [name, email, hashedPin, is_active, role || null,
       role !== undefined ? role === 'admin' : null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'User updated successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (admin only, soft delete)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = false WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Reset user PIN (admin only)
router.post('/:id/reset-pin', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { new_pin } = req.body;

    if (!new_pin || new_pin.length < 4) {
      return res.status(400).json({ error: 'PIN must be at least 4 characters' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPin = await bcrypt.hash(new_pin, salt);

    const result = await pool.query(
      'UPDATE users SET pin = $1, updated_at = NOW() WHERE id = $2 RETURNING id, employee_id, name',
      [hashedPin, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: `PIN reset for ${result.rows[0].name}`, user: result.rows[0] });
  } catch (error) {
    console.error('Error resetting PIN:', error);
    res.status(500).json({ error: 'Failed to reset PIN' });
  }
});

module.exports = router;
