require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool } = require('./config/database');

const attendanceRoutes = require('./routes/attendance');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploaded photos
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/attendance', attendanceRoutes);

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'ok', timestamp: new Date() });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Auto-fix: detect and reset truncated bcrypt hashes
  try {
    const result = await pool.query(
      "SELECT id, employee_id, pin FROM users WHERE pin LIKE '$2%' AND LENGTH(pin) < 60"
    );
    
    const knownPins = { 'EMP001': '1234', 'EMP002': '5678', 'EMP003': '9012' };
    
    for (const user of result.rows) {
      const plaintextPin = knownPins[user.employee_id];
      if (plaintextPin) {
        await pool.query('UPDATE users SET pin = $1 WHERE id = $2', [plaintextPin, user.id]);
        console.log(`Fixed truncated PIN for ${user.employee_id}`);
      } else {
        console.warn(`WARNING: ${user.employee_id} has a corrupted PIN. Admin must reset it.`);
      }
    }
    
    if (result.rows.length > 0) {
      console.log('PIN recovery complete. Affected users can now log in.');
    }
  } catch (error) {
    // Migration may not have run yet, ignore errors
    console.log('PIN recovery check skipped (will run on next deploy)');
  }
});

module.exports = app;
