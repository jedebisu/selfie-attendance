/* ==========================================================================
   naps:sync — refresh the naps table from the committed naps_export.csv.gz
   (upsert; never skips on a non-empty table). Runs on every Render deploy
   (render.yaml appends `npm run naps:sync` after db:seed) but exits in
   milliseconds when the export file is unchanged since the last import.

   Import source: server/src/config/naps_export.csv.gz — 23 comma-separated
   columns JAN going to the 2026-10-20 "NAP Facility Summary Report"
   (regenerate-naps-export.py). Column NAMES match naps table columns 1:1.
   Old 17-column exports are handled header-driven: unknown columns are
   simply not written.

   Idempotent schema: adds the six new columns for old databases:
     ports_reserved, ports_defective, ports_contingency (INT),
     discovered_when, customer_type, nap_address (TEXT)

   Usage: npm run naps:sync [-- --report-date 2026-10-20]
   ========================================================================== */
require('dotenv').config();
const { pool } = require('../src/config/database');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');

const GZ_PATH = path.join(__dirname, '..', 'src', 'config', 'naps_export.csv.gz');
const HASH_PATH = path.join(__dirname, '..', 'src', 'config', 'nap_export_hash.txt');
const REPORT_DATE_PATH = path.join(__dirname, '..', 'src', 'config', 'nap_report_date.txt');
const SAMPLE_NAP_ID = 'CEB_733_L915_N02A';
const BATCH_SIZE = 5000;

const INT_COLUMNS = new Set([
  'floors_served', 'working_lines', 'vacant_lines', 'total_capacity',
  'ports_reserved', 'ports_defective', 'ports_contingency',
]);
const TEXT_COLUMNS = new Set([
  'nap_id', 'cabinet', 'location_type', 'building_served', 'cfs_region',
  'city_name', 'province_name', 'naps_status', 'olt_id', 'sell_status',
  'barangay_name', 'discovered_when', 'customer_type', 'nap_address',
]);
const COORD_COLUMNS = new Set(['dp_nap_lat', 'dp_nap_long']);

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in src/__tests__/napsSync.test.js)
// ---------------------------------------------------------------------------

/** Parse the export CSV text into objects keyed by column name (header-driven:
 *  only columns present in the header appear on rows). */
function parseExport(csvText) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: false,
  });
  return records.map(coerceRow);
}

/** Coerce a single parsed record to insert values: ints → number (blank → 0),
 *  coords → float or NULL, text stays a string. */
function coerceRow(rec) {
  const out = {};
  for (const [name, raw] of Object.entries(rec)) {
    const val = typeof raw === 'string' ? raw.trim() : raw;
    if (INT_COLUMNS.has(name)) {
      out[name] = val === '' ? 0 : Math.round(Number(String(val).replace(',', '')));
    } else if (COORD_COLUMNS.has(name)) {
      const f = parseFloat(val);
      out[name] = Number.isFinite(f) ? f : null;
    } else if (TEXT_COLUMNS.has(name)) {
      out[name] = val === '' ? '' : String(val).replace(/^"|"$/g, '');
    } else {
      out[name] = val; // unexpected column: pass through untouched
    }
  }
  return out;
}

/** Idempotent schema assure: the six new columns for old databases, plus a
 *  widen of barangay_name (garbled report strings reach 142 chars, e.g. the
 *  TGG_030_L005_N60A address block; truncation would lose verbatim text). */
function columnsToAlter() {
  return `
    ALTER TABLE naps ADD COLUMN IF NOT EXISTS ports_reserved INT,
    ADD COLUMN IF NOT EXISTS ports_defective INT,
    ADD COLUMN IF NOT EXISTS ports_contingency INT,
    ADD COLUMN IF NOT EXISTS discovered_when TEXT,
    ADD COLUMN IF NOT EXISTS customer_type TEXT,
    ADD COLUMN IF NOT EXISTS nap_address TEXT,
    ALTER COLUMN barangay_name TYPE VARCHAR(200)
  `.replace(/\s+/g, ' ').trim();
}

/** Multi-row upsert SQL for the given column names (header-driven). */
function upsertSqlFor(colNames) {
  const cols = colNames.join(', ');
  const placeholders = colNames.map((_, i) => `$${i + 1}`).join(', ');
  const updates = colNames
    .filter((c) => c !== 'nap_id')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');
  return `
    INSERT INTO naps (${cols}) VALUES (${placeholders})
    ON CONFLICT (nap_id) DO UPDATE SET
      ${updates},
      updated_at = NOW()
  `;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  const reportDateArg = process.argv.includes('--report-date')
    ? process.argv[process.argv.indexOf('--report-date') + 1]
    : null;

  const client = await pool.connect();
  try {
    // 1) Hash gate — skip identical exports (fast no-op on every deploy).
    const currentHash = sha256File(GZ_PATH);
    const storedHash = fs.existsSync(HASH_PATH) ? fs.readFileSync(HASH_PATH, 'utf-8').trim() : '';
    let previouslySynced = false;

    // Fresh export AND a probe proves the new columns are populated? skip.
    // (Probe is failure-tolerant: on databases that predate the new columns
    // the query itself throws — treat that as "not synced" and continue.)
    let probe = null;
    if (currentHash === storedHash) {
      try {
        probe = await client.query(
          `SELECT nap_address, ports_reserved FROM naps WHERE nap_id = $1`,
          [SAMPLE_NAP_ID]
        );
      } catch (_) {
        probe = null;
      }
    }
    if (probe && probe.rows.length > 0 && probe.rows[0].nap_address) previouslySynced = true;
    if (previouslySynced) {
      console.log(`naps export unchanged (sha256 ${currentHash.slice(0, 12)}…) — import skipped.`);
      process.exit(0);
    }

    // 2) Idempotent schema migration.
    await client.query(columnsToAlter());

    // 3) Read + parse export.
    const csvText = require('zlib').gunzipSync(fs.readFileSync(GZ_PATH)).toString('utf-8');
    const rows = parseExport(csvText);
    console.log(`Parsed ${rows.length} rows from naps_export.csv.gz`);
    if (rows.length === 0) throw new Error('export is empty — refusing to wipe progress');

    // 4) Batch upsert in one transaction.
    const colNames = Object.keys(rows[0]);
    if (!colNames.includes('nap_id')) throw new Error('export has no nap_id column');
    const sql = upsertSqlFor(colNames);

    await client.query('BEGIN');
    for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
      const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);
      for (const row of batch) {
        const values = colNames.map((c) => (row[c] === undefined ? null : row[c]));
        await client.query(sql, values);
      }
      console.log(`  upserted ${Math.min(batchStart + BATCH_SIZE, rows.length)}/${rows.length}…`);
    }
    await client.query('COMMIT');
    console.log(`Successfully upserted ${rows.length} NAPs.`);

    // 5) Indexes (idempotent, mirrors import-naps-production.js).
    await client.query('CREATE INDEX IF NOT EXISTS idx_naps_coords ON naps(dp_nap_lat, dp_nap_long)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_naps_nap_id ON naps(nap_id)');

    // 6) Stamp the hash (successful sync) + optional report date.
    fs.writeFileSync(HASH_PATH, currentHash + '\n');
    const stampDate = reportDateArg
      || (fs.existsSync(REPORT_DATE_PATH) ? fs.readFileSync(REPORT_DATE_PATH, 'utf-8').trim() : null);
    if (stampDate) fs.writeFileSync(REPORT_DATE_PATH, stampDate + '\n');
    console.log('Hash stamped — future deploys with this export are no-ops.');
    process.exit(0);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('naps:sync failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
  }
};

if (require.main === module) main();
module.exports = { parseExport, columnsToAlter, upsertSqlFor };
