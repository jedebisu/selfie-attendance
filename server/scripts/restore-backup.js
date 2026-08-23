#!/usr/bin/env node
/**
 * Restore database from a backup JSON dump.
 *
 * Usage:
 *   node scripts/restore-backup.js <path-or-URL-to-backup.json> --yes
 *
 * WARNING: This REPLACES the contents of users, attendance, leave_requests
 * and location_pings with the backup data. Sessions are left untouched.
 * Run against the right environment!
 */
require('dotenv').config();
const fs = require('fs');
const https = require('https');
const http = require('http');
const { pool } = require('../src/config/database');

async function loadDump(src) {
  if (/^https?:\/\//.test(src)) {
    console.log(`Downloading ${src} ...`);
    return new Promise((resolve, reject) => {
      (src.startsWith('https') ? https : http).get(src, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }).on('error', reject);
    });
  }
  return fs.readFileSync(src, 'utf8');
}

async function main() {
  const src = process.argv[2];
  const confirmed = process.argv.includes('--yes');

  if (!src) {
    console.error('Usage: node scripts/restore-backup.js <path-or-URL> --yes');
    process.exit(1);
  }
  if (!confirmed) {
    console.error('Refusing to restore without --yes (this wipes current table data).');
    process.exit(1);
  }

  const dump = JSON.parse(await loadDump(src));
  const tables = ['users', 'attendance', 'leave_requests', 'location_pings'];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Reverse order so FK references are cleared cleanly; CASCADE for safety.
    for (const t of [...tables].reverse()) {
      await client.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
    }
    for (const t of tables) {
      const def = dump.tables[t];
      if (!def || !def.rows.length) continue;
      const cols = def.columns;
      let count = 0;
      for (const row of def.rows) {
        await client.query(
          `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`,
          cols.map(c => row[c] === undefined ? null : row[c])
        );
        count++;
      }
      // Reset id sequences to max(id)
      if (cols.includes('id')) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 1))`
        );
      }
      console.log(`${t}: restored ${count} rows`);
    }
    await client.query('COMMIT');
    console.log('Restore complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Restore FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main();
