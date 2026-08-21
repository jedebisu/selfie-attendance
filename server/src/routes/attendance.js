const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { processAttendancePhoto } = require('../utils/imageProcessor');
const { authenticateToken } = require('../middleware/auth');
const { isConfigured: isCloudinaryConfigured, uploadPhoto } = require('../config/cloudinary');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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
    const { user_id, latitude, longitude, location_name, status, device_info, timestamp: clientTimestamp } = req.body;
    const photoFile = req.file;

    if (!photoFile) {
      return res.status(400).json({ error: 'Photo is required' });
    }

    const attendanceStatus = status || 'clock_in';
    const recordTimestamp = clientTimestamp ? new Date(clientTimestamp) : new Date();

    // Duplicate prevention: block if same user submitted within last 2 minutes
    const duplicateCheck = await pool.query(
      `SELECT id FROM attendance 
       WHERE user_id = $1 AND status = $2 
       AND timestamp > ($3::timestamp - INTERVAL '2 minutes')`,
      [user_id, attendanceStatus, recordTimestamp.toISOString()]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(429).json({ error: 'Already recorded. Wait 2 minutes before trying again.' });
    }

    // Clock-out validation: must have a clock-in today before clocking out
    if (attendanceStatus === 'clock_out') {
      const clockInCheck = await pool.query(
        `SELECT id FROM attendance 
         WHERE user_id = $1 AND status = 'clock_in' 
         AND DATE(timestamp + INTERVAL '8 hours') = DATE($2::timestamp + INTERVAL '8 hours')`,
        [user_id, recordTimestamp.toISOString()]
      );
      if (clockInCheck.rows.length === 0) {
        return res.status(400).json({ error: 'You must clock in before clocking out.' });
      }
    }

    // Process image - add timestamp and GPS overlay
    const processedFilename = `processed_${photoFile.filename}`;
    const processedPath = path.join(__dirname, '../../uploads', processedFilename);
    
    await processAttendancePhoto({
      inputPath: photoFile.path,
      outputPath: processedPath,
      timestamp: recordTimestamp,
      latitude: parseFloat(latitude) || null,
      longitude: parseFloat(longitude) || null,
      locationName: location_name || null
    });

    // Upload to Cloudinary when configured, so photos persist across
    // redeploys (Render free tier has no persistent disk)
    let photoUrl = `/uploads/${processedFilename}`;
    let originalPhotoUrl = `/uploads/${photoFile.filename}`;

    if (isCloudinaryConfigured) {
      try {
        photoUrl = await uploadPhoto(processedPath);
        originalPhotoUrl = await uploadPhoto(photoFile.path);
      } catch (uploadError) {
        console.error('Cloudinary upload failed, falling back to local storage:', uploadError.message);
        photoUrl = `/uploads/${processedFilename}`;
        originalPhotoUrl = `/uploads/${photoFile.filename}`;
      }
      // Remove temp files from the ephemeral disk after upload
      try { fs.unlinkSync(photoFile.path); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(processedPath); } catch (e) { /* ignore */ }
    }

    // Insert attendance record
    const result = await pool.query(
      `INSERT INTO attendance (user_id, photo_url, original_photo_url, latitude, longitude, location_name, status, device_info, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        user_id,
        photoUrl,
        originalPhotoUrl,
        latitude || null,
        longitude || null,
        location_name || null,
        attendanceStatus,
        device_info ? JSON.stringify(device_info) : null,
        recordTimestamp
      ]
    );

    res.status(201).json({
      message: 'Attendance recorded successfully',
      record: result.rows[0]
    });
  } catch (error) {
    console.error('Error recording attendance:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to record attendance', detail: error.message });
  }
});

// Get current user's today summary (for mobile app; MUST be before /:id)
router.get('/summary/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        MIN(CASE WHEN a.status = 'clock_in' THEN a.timestamp END) as clock_in,
        MAX(CASE WHEN a.status = 'clock_out' THEN a.timestamp END) as clock_out,
        COUNT(CASE WHEN a.status = 'clock_in' THEN 1 END) as clock_in_count
       FROM users u
       LEFT JOIN attendance a ON u.id = a.user_id AND DATE(a.timestamp + INTERVAL '8 hours') = DATE(NOW() + INTERVAL '8 hours')
       WHERE u.id = $1`,
      [req.user.id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching today summary:', error);
    res.status(500).json({ error: 'Failed to fetch today summary' });
  }
});

// Get today's attendance summary (MUST be before /:id to avoid route conflict)
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
       LEFT JOIN attendance a ON u.id = a.user_id AND DATE(a.timestamp + INTERVAL '8 hours') = DATE(NOW() + INTERVAL '8 hours')
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

// Get monthly attendance summary per user (MUST be before /:id)
router.get('/summary/monthly', authenticateToken, async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) {
      return res.status(400).json({ error: 'year and month are required' });
    }

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endMonth = parseInt(month);
    const nextMonth = endMonth === 12 ? 1 : endMonth + 1;
    const nextYear = endMonth === 12 ? parseInt(year) + 1 : parseInt(year);
    const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const result = await pool.query(
      `SELECT 
        u.id as user_id,
        u.name,
        u.employee_id,
        a.id as attendance_id,
        a.status,
        a.timestamp,
        a.photo_url,
        a.latitude,
        a.longitude,
        TO_CHAR(a.timestamp + INTERVAL '8 hours', 'YYYY-MM-DD') as attendance_date
       FROM users u
       LEFT JOIN attendance a ON u.id = a.user_id 
         AND DATE(a.timestamp + INTERVAL '8 hours') >= $1::date
         AND DATE(a.timestamp + INTERVAL '8 hours') < $2::date
       WHERE u.is_active = true
       ORDER BY u.name, a.timestamp`,
      [startDate, endDate]
    );

    // Group by user, then by date
    const users = {};
    for (const row of result.rows) {
      if (!users[row.user_id]) {
        users[row.user_id] = {
          user_id: row.user_id,
          name: row.name,
          employee_id: row.employee_id,
          days: {}
        };
      }
      if (row.attendance_id) {
        const dateKey = row.attendance_date;
        if (!users[row.user_id].days[dateKey]) {
          users[row.user_id].days[dateKey] = {
            date: dateKey,
            status: 'absent',
            clock_in: null,
            clock_out: null,
            records: []
          };
        }
        users[row.user_id].days[dateKey].records.push({
          id: row.attendance_id,
          status: row.status,
          timestamp: row.timestamp,
          photo_url: row.photo_url,
          latitude: row.latitude,
          longitude: row.longitude
        });
        if (row.status === 'clock_in') {
          users[row.user_id].days[dateKey].clock_in = row.timestamp;
          users[row.user_id].days[dateKey].status = 'present';
        }
        if (row.status === 'clock_out') {
          users[row.user_id].days[dateKey].clock_out = row.timestamp;
        }
      }
    }

    res.json({
      year: parseInt(year),
      month: parseInt(month),
      users: Object.values(users)
    });
  } catch (error) {
    console.error('Error fetching monthly summary:', error);
    res.status(500).json({ error: 'Failed to fetch monthly summary' });
  }
});

// Get all attendance records (with filters) — AFTER /summary/* routes
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
      query += ` AND DATE(a.timestamp + INTERVAL '8 hours') = $${paramCount}`;
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

    // Get total count with same filters
    let countSql = `SELECT COUNT(*) FROM attendance a WHERE 1=1`;
    const countParams = [];
    let cp = 0;
    if (user_id) { cp++; countSql += ` AND a.user_id = $${cp}`; countParams.push(user_id); }
    if (date) { cp++; countSql += ` AND DATE(a.timestamp + INTERVAL '8 hours') = $${cp}`; countParams.push(date); }
    if (status) { cp++; countSql += ` AND a.status = $${cp}`; countParams.push(status); }
    const countResult = await pool.query(countSql, countParams);

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

// Get single attendance record (MUST be AFTER /summary/* routes)
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

module.exports = router;
