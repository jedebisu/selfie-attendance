require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { pool } = require('./config/database');

const attendanceRoutes = require('./routes/attendance');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const leaveRoutes = require('./routes/leave');
const exportRoutes = require('./routes/export');
const analyticsRoutes = require('./routes/analytics');
const napsRoutes = require('./routes/naps');

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
app.use('/api/leave', leaveRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/naps', napsRoutes);

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

// Auto-import NAPs from committed CSV if table is empty
const importNapsIfNeeded = async () => {
  try {
    const countResult = await pool.query('SELECT COUNT(*) FROM naps');
    if (parseInt(countResult.rows[0].count) > 0) {
      console.log('NAPs table has data. Skipping import.');
      return;
    }

    console.log('NAPs table empty. Starting auto-import...');
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const readline = require('readline');

    const csvGzPath = path.join(__dirname, 'config/naps_export.csv.gz');
    if (!fs.existsSync(csvGzPath)) {
      console.log('NAP export CSV not found. Skipping import.');
      return;
    }

    const csvPath = csvGzPath.replace('.gz', '');
    execSync(`gunzip -c "${csvGzPath}" > "${csvPath}"`);

    const fileStream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const BATCH_SIZE = 2000;
    let imported = 0;
    let batch = [];
    let headerSkipped = false;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for await (const line of rl) {
        if (!headerSkipped) { headerSkipped = true; continue; }

        const fields = parseCSVLine(line);
        if (fields.length < 17) continue;

        batch.push(fields);

        if (batch.length >= BATCH_SIZE) {
          await insertBatch(client, batch);
          imported += batch.length;
          batch = [];
          console.log(`NAP import: ${imported} rows...`);
        }
      }

      if (batch.length > 0) {
        await insertBatch(client, batch);
        imported += batch.length;
      }

      await client.query('COMMIT');
      console.log(`NAP import complete: ${imported} rows.`);

      await client.query('CREATE INDEX IF NOT EXISTS idx_naps_coords ON naps(dp_nap_lat, dp_nap_long)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_naps_nap_id ON naps(nap_id)');
      console.log('NAP indexes created.');

      fs.unlinkSync(csvPath);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('NAP import failed:', err.message);
    } finally {
      client.release();
      if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    }
  } catch (error) {
    console.error('NAP import check failed:', error.message);
  }
};

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { result.push(current); current = ''; }
    else { current += char; }
  }
  result.push(current);
  return result;
}

async function insertBatch(client, batch) {
  const values = [];
  const placeholders = [];
  batch.forEach((fields, i) => {
    const offset = i * 17;
    placeholders.push(`(${Array.from({ length: 17 }, (_, j) => `$${offset + j + 1}`).join(',')})`);
    values.push(
      fields[0] || null, fields[1] || null, fields[2] || null,
      fields[3] || null, fields[4] || null,
      parseInt(fields[5]) || 0, parseInt(fields[6]) || 0, parseInt(fields[7]) || 0,
      fields[8] || null, fields[9] || null, fields[10] || null,
      parseFloat(fields[11]) || null, parseFloat(fields[12]) || null,
      fields[13] || null, fields[14] || null, fields[15] || null,
      fields[16] || null
    );
  });
  await client.query(`
    INSERT INTO naps (nap_id, cabinet, location_type, building_served, floors_served,
      working_lines, vacant_lines, total_capacity, cfs_region, city_name, province_name,
      dp_nap_lat, dp_nap_long, naps_status, olt_id, sell_status, barangay_name)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (nap_id) DO NOTHING
  `, values);
}

// Session cleanup: delete expired tokens
const cleanupSessions = async () => {
  try {
    const result = await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
    if (result.rowCount > 0) {
      console.log(`Cleaned up ${result.rowCount} expired sessions`);
    }
  } catch (error) {
    console.error('Session cleanup error:', error.message);
  }
};

// PIN recovery: fix truncated bcrypt hashes
const recoverPins = async () => {
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
      console.log('PIN recovery complete.');
    }
  } catch (error) {
    console.log('PIN recovery check skipped');
  }
};

// Start server
const server = app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Startup tasks
  await cleanupSessions();
  await recoverPins();
  importNapsIfNeeded(); // fire-and-forget, runs in background
  
  // Periodic session cleanup every hour
  setInterval(cleanupSessions, 60 * 60 * 1000);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(async () => {
    console.log('HTTP server closed.');
    await pool.end();
    console.log('Database pool closed.');
    process.exit(0);
  });
  
  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
