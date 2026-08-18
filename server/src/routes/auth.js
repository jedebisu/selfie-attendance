const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Rate limit: 5 login attempts per minute per IP
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Login with employee ID and PIN
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { employee_id, pin } = req.body;

    if (!employee_id || !pin) {
      return res.status(400).json({ error: 'Employee ID and PIN are required' });
    }

    // Fetch user by employee_id only (PIN check done with bcrypt)
    const result = await pool.query(
      'SELECT * FROM users WHERE employee_id = $1 AND is_active = true',
      [employee_id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Compare PIN with bcrypt hash
    let pinMatch = await bcrypt.compare(pin, user.pin);

    // Auto-migrate: handle various legacy PIN states
    if (!pinMatch) {
      const isTruncatedHash = user.pin.startsWith('$2') && user.pin.length < 60;
      const isPlaintext = user.pin === pin;

      if (isTruncatedHash || isPlaintext) {
        // PIN is correct but stored improperly - re-hash it
        const salt = await bcrypt.genSalt(10);
        const hashedPin = await bcrypt.hash(pin, salt);
        await pool.query('UPDATE users SET pin = $1 WHERE id = $2', [hashedPin, user.id]);
        pinMatch = true;
        console.log(`Migrated PIN for ${user.employee_id}`);
      }
    }

    if (!pinMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, employeeId: user.employee_id, isAdmin: user.is_admin },
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
        name: user.name,
        is_admin: user.is_admin
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
      'SELECT id, employee_id, name, is_admin FROM users WHERE id = $1',
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
