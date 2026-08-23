const { pool } = require('../config/database');

const RETENTION_DAYS = 90;

async function purgeOldPings() {
  const res = await pool.query(
    `DELETE FROM location_pings WHERE created_at < NOW() - ($1 || ' days')::interval`,
    [RETENTION_DAYS]
  );
  if (res.rowCount > 0) {
    console.log(`[purge] removed ${res.rowCount} GPS pings older than ${RETENTION_DAYS} days`);
  }
  return res.rowCount;
}

function schedulePurge() {
  setTimeout(() => {
    purgeOldPings().catch(err => console.error('[purge] failed:', err.message));
    setInterval(() => {
      purgeOldPings().catch(err => console.error('[purge] failed:', err.message));
    }, 24 * 60 * 60 * 1000);
  }, 5 * 60 * 1000);
}

module.exports = { purgeOldPings, schedulePurge, RETENTION_DAYS };
