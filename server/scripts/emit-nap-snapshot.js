/* ==========================================================================
   emit-nap-snapshot.js — Option C fast-path data emitter.

   Writes a single static JSON file containing the FULL unfiltered Visayas
   pin set + availability summary. The frontend fetches this (edge-cached
   by the CDN) for the first paint, instead of hitting the slow DB-backed
   /map endpoint on every cold load.

   This is a CACHE, not the source of truth: the frontend cross-checks
   report_date against the live summary and falls back to /map when the
   snapshot is stale or missing. Safe to delete at any time.

   Usage: node scripts/emit-nap-snapshot.js [output-path]
   Default output: <repo>/server/public/nap-snapshot.json

   Wired into the deploy chain: run after naps:sync so the snapshot
   always reflects the latest committed NAP data.
   ========================================================================== */
require('dotenv').config({ path: __dirname + '/../.env' });
const { pool } = require('../src/config/database');
const fs = require('fs');
const path = require('path');
const { LOW_AVAILABILITY_THRESHOLD } = require('../src/routes/napcheck');

// Reuse the same Visayas WHERE clause the /map endpoint uses (single source
// of truth). Exported from napcheck.js.
const { VISAYAS_WHERE, COORD_SAFE } = require('../src/routes/napcheck');

const DEFAULT_OUT = path.join(__dirname, '..', 'public', 'nap-snapshot.json');

async function main() {
  const outPath = process.argv[2] || DEFAULT_OUT;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Read the report date the same way the route does.
  let reportDate = null;
  try {
    reportDate = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'nap_report_date.txt'), 'utf-8').trim() || null;
  } catch (_) {}

  const singleQuery = await pool.query(`
    SELECT
      id, nap_id, dp_nap_lat, dp_nap_long, vacant_lines,
      (SELECT 1) AS _cnt
    FROM naps
    WHERE ${VISAYAS_WHERE} AND ${COORD_SAFE}
  `);

  // Single-pass summary (mirrors the optimized /map summary).
  const summary = await pool.query(`
    SELECT
      COUNT(*)::int AS total_matching,
      SUM(CASE WHEN vacant_lines IS NULL THEN 1 ELSE 0 END)::int AS unknown,
      SUM(CASE WHEN vacant_lines = 0 THEN 1 ELSE 0 END)::int AS full,
      SUM(CASE WHEN vacant_lines > 0 AND vacant_lines <= ${LOW_AVAILABILITY_THRESHOLD} THEN 1 ELSE 0 END)::int AS warning,
      SUM(CASE WHEN vacant_lines > ${LOW_AVAILABILITY_THRESHOLD} THEN 1 ELSE 0 END)::int AS available
    FROM naps
    WHERE ${VISAYAS_WHERE} AND ${COORD_SAFE}
  `);

  const rows = singleQuery.rows.map((r) => [r.id, r.nap_id, r.dp_nap_lat, r.dp_nap_long, r.vacant_lines]);
  const s = summary.rows[0];

  const payload = {
    schema: 1,
    generated_at: new Date().toISOString(),
    report_date: reportDate,
    region: 'visayas',
    total: Number(s.total_matching),
    summary: {
      available: Number(s.available),
      warning: Number(s.warning),
      full: Number(s.full),
      unknown: Number(s.unknown),
    },
    low_availability_threshold: LOW_AVAILABILITY_THRESHOLD,
    cols: 'min',
    rows,
  };

  const json = JSON.stringify(payload);
  fs.writeFileSync(outPath, json, 'utf-8');
  console.log(`Snapshot written: ${outPath}`);
  console.log(`  ${rows.length} rows, ${json.length} bytes uncompressed`);
  console.log(`  report_date=${reportDate} summary=${JSON.stringify(payload.summary)}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
