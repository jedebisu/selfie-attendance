require('dotenv').config();
const { pool } = require('./database');

const createTables = async () => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE,
        pin VARCHAR(60) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        is_admin BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add is_admin column if it doesn't exist (for existing databases)
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);

    // Widen pin column to fit bcrypt hashes (was VARCHAR(10), needs VARCHAR(60))
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN pin TYPE VARCHAR(60);
      EXCEPTION WHEN undefined_column THEN null;
            WHEN duplicate_column THEN null;
      END $$;
    `);

    // Attendance records table
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        photo_url VARCHAR(500) NOT NULL,
        original_photo_url VARCHAR(500),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        location_name VARCHAR(200),
        timestamp TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'clock_in' CHECK (status IN ('clock_in', 'clock_out')),
        device_info JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Sessions table for JWT tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_user_id ON attendance(user_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_timestamp ON attendance(timestamp);
      CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
      CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);
    `);

    // Leave requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        leave_date DATE NOT NULL,
        reason VARCHAR(500) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        approved_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_leave_user_id ON leave_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_leave_date ON leave_requests(leave_date);
    `);

    await client.query('COMMIT');
    console.log('Database tables created successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration
createTables()
  .then(() => {
    console.log('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
