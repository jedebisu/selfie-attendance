const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

// Local development reads the discrete DB_* settings (see AGENTS.md); only
// production connects through the single DATABASE_URL connection string. A dev
// .env must never be able to silently redirect local work to a remote/production
// database just because it happens to carry a DATABASE_URL — that is how the
// console ended up rendering production rows (whose customer/technician names
// were corrupted by an old import) instead of the local dev data.
const pool = isProduction
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER || 'yanggee',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'selfie_attendance',
      password: process.env.DB_PASSWORD || undefined,
      port: process.env.DB_PORT || 5432,
      ssl: false,
    });

pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  // An idle pooled client hit a transient network error (common with cloud
  // databases). Log it and let pg spin up a replacement client — do NOT exit
  // the process, otherwise one network blip takes the whole API down.
  console.error('PostgreSQL idle client error (pool will reconnect):', err.message);
});

module.exports = { pool };
