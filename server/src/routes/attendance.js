const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { processAttendancePhoto } = require('../utils/imageProcessor');
const { authenticateToken } = require('../middleware/auth');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Submit attendance (clock in/out)
router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
  try {
    const { user_id, latitude, longitude, location_name, status, device_info } = req.body;
    const photoFile = req.file;

    if (!photoFile) {
      return res.status(400).json({ error: 'Photo is required' });
    }

    // Process image - add timestamp and GPS overlay
    const processedFilename = `processed_${photoFile.filename}`;
    const processedPath = path.join(__dirname, '../../uploads', processedFilename);
    
    await processAttendancePhoto({
      inputPath: photoFile.path,
      outputPath: processedPath,
      timestamp: new Date(),
      latitude: parseFloat(latitude) || null,
      longitude: parseFloat(longitude) || null,
      locationName: location_name || null
    });

    // Insert attendance record
    const result = await pool.query(
      `INSERT INTO attendance (user_id, photo_url, original_photo_url, latitude, longitude, location_name, status, device_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        user_id,
        `/uploads/${processedFilename}`,
        `/uploads/${photoFile.filename}`,
        latitude || null,
        longitude || null,
        location_name || null,
        status || 'clock_in',
        device_info ? JSON.stringify(device_info) : null
      ]
    );

    res.status(201).json({
      message: 'Attendance recorded successfully',
      record: result.rows[0]
    });
  } catch (error) {
    console.error('Error recording attendance:', error);
    res.status(500).json({ error: 'Failed to record attendance' });
  }
});

// Get all attendance records (with filters)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { user_id, date, status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT a.*, u.name as user_name, u.employee_id
      FROM attendance a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (user_id) {
      paramCount++;
      query += ` AND a.user_id = $${paramCount}`;
      params.push(user_id);
    }

    if (date) {
      paramCount++;
      query += ` AND DATE(a.timestamp) = $${paramCount}`;
      params.push(date);
    }

    if (status) {
      paramCount++;
      query += ` AND a.status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY a.timestamp DESC`;
    
    paramCount++;
    query += ` LIMIT $${paramCount}`;
    params.push(limit);
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(offset);

    const result = await pool.query(query, params);

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM attendance WHERE 1=1`,
      []
    );

    res.json({
      records: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
});

// Get single attendance record
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT a.*, u.name as user_name, u.employee_id
       FROM attendance a
       JOIN users u ON a.user_id = u.id
       WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching attendance record:', error);
    res.status(500).json({ error: 'Failed to fetch attendance record' });
  }
});

// Get today's attendance summary
router.get('/summary/today', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id,
        u.name,
        u.employee_id,
        MIN(CASE WHEN a.status = 'clock_in' THEN a.timestamp END) as first_clock_in,
        MAX(CASE WHEN a.status = 'clock_out' THEN a.timestamp END) as last_clock_out,
        COUNT(CASE WHEN a.status = 'clock_in' THEN 1 END) as clock_in_count
       FROM users u
       LEFT JOIN attendance a ON u.id = a.user_id AND DATE(a.timestamp) = CURRENT_DATE
       WHERE u.is_active = true
       GROUP BY u.id, u.name, u.employee_id
       ORDER BY u.name`
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching today summary:', error);
    res.status(500).json({ error: 'Failed to fetch today summary' });
  }
});

module.exports = router;
