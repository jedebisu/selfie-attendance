const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Login with employee ID and PIN
router.post('/login', async (req, res) => {
  try {
    const { employee_id, pin } = req.body;

    if (!employee_id || !pin) {
      return res.status(400).json({ error: 'Employee ID and PIN are required' });
    }

    const result = await pool.query(
      'SELECT * FROM users WHERE employee_id = $1 AND pin = $2 AND is_active = true',
      [employee_id, pin]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, employeeId: user.employee_id },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Store session
    await pool.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'24 hours\')',
      [user.id, token]
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        employee_id: user.employee_id,
        name: user.name
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Verify token
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      'SELECT id, employee_id, name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ valid: true, user: result.rows[0] });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

module.exports = router;
