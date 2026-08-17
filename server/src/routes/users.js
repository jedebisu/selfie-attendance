const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// Get all users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, employee_id, name, email, is_active, created_at FROM users ORDER BY name'
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
      'SELECT id, employee_id, name, email, is_active, created_at FROM users WHERE id = $1',
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
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { employee_id, name, email, pin } = req.body;

    if (!employee_id || !name || !pin) {
      return res.status(400).json({ error: 'Employee ID, name, and PIN are required' });
    }

    const result = await pool.query(
      `INSERT INTO users (employee_id, name, email, pin)
       VALUES ($1, $2, $3, $4)
       RETURNING id, employee_id, name, email, created_at`,
      [employee_id, name, email || null, pin]
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

// Update user
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, pin, is_active } = req.body;

    const result = await pool.query(
      `UPDATE users 
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           pin = COALESCE($3, pin),
           is_active = COALESCE($4, is_active),
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, employee_id, name, email, is_active, updated_at`,
      [name, email, pin, is_active, id]
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

// Delete user (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

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

module.exports = router;
