#!/usr/bin/env node
/* ==========================================================================
   fix-nap-addresses.js — Option A: geocoded address correction for NAPs
   whose city_name was mislabelled in the source report.

   Rules (per owner direction, 2026-10-24):
   - Only rows where city_name claims a city but barangay_name is empty.
   - Only rows whose reverse-geocoded locality differs from the claimed
     city (case-insensitive) — i.e. the label is provably wrong.
   - Set barangay_name to the OSM-verified locality, city_name to the
     OSM-verified city.
   - Dry-run by default: prints a preview report, writes nothing.
   - Pass --apply to actually UPDATE the database.

   Rate-limit: Photon allows ~1 req/s free tier → 350 ms between calls.
   Idempotent: re-running after a successful apply produces 0 changes.
   ========================================================================== */
require('dotenv').config({ path: __dirname + '/../.env' });
const { pool } = require(__dirname + '/../src/config/database');

const DRY = !process.argv.includes('--apply');
const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));
const THRESH = 8; // LOW_AVAILABILITY_THRESHOLD (not used here, just context)

async function reverseGeocode(lat, lng) {
  // Nominatim (OSM, no key, fair-use: 1 req/s). Photon has been down.
  const nomUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`;
  const r2 = await fetch(nomUrl, { headers: { 'User-Agent': 'nap-check-data-quality/1.0 (contact: support@ebisudps.com)' } });
  if (!r2.ok) throw new Error(`Nominatim HTTP ${r2.status}`);
  const d2 = await r2.json();
  const a = d2.address || {};
  // Philippine admin levels: state=province, city/town/village=city,
  // suburb/quarter/barangay=barangay
  const city = (a.city || a.town || a.village || a.county || '').trim();
  const barangay = (a.suburb || a.quarter || a.neighbourhood || '').trim();
  return { barangay, city, state: (a.state || '').trim(), source: 'nominatim' };
}

async function main() {
  // 1) Target population: CEBU CITY rows without a barangay, outside the
  //    Cebu City bounding box — the ones most likely mislabelled.
  const q = await pool.query(`
    SELECT nap_id, dp_nap_lat, dp_nap_long, city_name, barangay_name
    FROM naps
    WHERE city_name ILIKE '%CEBU CITY%'
      AND (barangay_name IS NULL OR TRIM(barangay_name) = '')
      AND NOT (dp_nap_lat BETWEEN 10.25 AND 10.45 AND dp_nap_long BETWEEN 123.60 AND 124.00)
      AND dp_nap_lat IS NOT NULL AND dp_nap_long IS NOT NULL
    ORDER BY nap_id
  `);
  console.log(`Target rows: ${q.rows.length} (CEBU CITY, no barangay, outside Cebu City bbox)`);

  const fixes = [];
  let skipped = 0;
  for (let i = 0; i < q.rows.length; i++) {
    const row = q.rows[i];
    let geo;
    try {
      geo = await reverseGeocode(row.dp_nap_lat, row.dp_nap_long);
    } catch (_) {
      skipped++;
      if ((i + 1) % 25 === 0) console.log(`  progress ${i + 1}/${q.rows.length} (skipped ${skipped})`);
      await SLEEP(400);
      continue;
    }
    await SLEEP(350); // respect Photon's free-tier rate limit

    // Only fix when OSM disagrees with the claimed city.
    const claimed = row.city_name.toLowerCase();
    const actual = (geo.city || '').toLowerCase();
    if (!actual || claimed.includes(actual) || actual.includes(claimed)) continue;
    // A fix is only durable if it targets rows whose *source* label is
    // "CEBU CITY" (a known mislabel). Rows already corrected in a prior
    // apply (city_name now = actual, e.g. "Balamban") are skipped: their
    // claimed/actual match, so re-running is a safe no-op.

    fixes.push({
      nap_id: row.nap_id,
      from_city: row.city_name,
      to_city: geo.city || 'BALAMBAN',
      to_barangay: geo.barangay || null,
      state: geo.state,
      lat: row.dp_nap_lat,
      lng: row.dp_nap_long,
    });
    if ((i + 1) % 25 === 0) console.log(`  progress ${i + 1}/${q.rows.length} (fixes so far: ${fixes.length})`);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`FIXES: ${fixes.length}   SKIPPED/NO-DISCREPANCY: ${q.rows.length - fixes.length - skipped}   PHOTON-ERRORS: ${skipped}`);
  console.log('='.repeat(60));
  fixes.forEach((f) => {
    console.log(`  ${f.nap_id}  ${f.from_city} → ${f.to_city} (${f.to_barangay || 'no brgy'})  [${f.state}]  ${f.lat}, ${f.lng}`);
  });

  if (DRY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to commit.');
    await pool.end();
    return;
  }

  const updateResults = [];
  for (const f of fixes) {
    const r = await pool.query(
      `UPDATE naps SET city_name = $1, barangay_name = COALESCE(NULLIF(TRIM(barangay_name), ''), $2), updated_at = NOW() WHERE nap_id = $3`,
      [f.to_city, f.to_barangay, f.nap_id]
    );
    updateResults.push({ nap_id: f.nap_id, rows: r.rowCount });
  }
  const totalRows = updateResults.reduce((s, x) => s + x.rows, 0);
  console.log(`\nAPPLIED ${totalRows} row updates (${fixes.length} NAPs).`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
