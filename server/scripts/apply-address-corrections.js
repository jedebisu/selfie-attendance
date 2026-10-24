#!/usr/bin/env node
/* ==========================================================================
   apply-address-corrections.js
   Patches naps_export.csv.gz in place with owner-confirmed locality fixes.
   This makes the correction durable across re-imports (the hash gate sees
   a new CSV, re-imports, and the corrected city/barangay values stick).

   Each correction is a row-level override keyed by nap_id.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const csvParse = require('csv-parse/sync');

const CSV_GZ = path.join(__dirname, '..', 'src', 'config', 'naps_export.csv.gz');
const HASH_FILE = path.join(__dirname, '..', 'src', 'config', 'nap_export_hash.txt');

// Owner-confirmed corrections (OSM reverse-geocoded + owner review).
// city_name + barangay_name overrides for specific nap_ids.
const CORRECTIONS = [
  // Balamban (Aliwanay / Baliwagan) — were mislabelled "CEBU CITY"
  { nap_id: 'BAL_001_L902_N02A', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L903_N02A', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L904_N02A', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L905_N01A', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L905_N01B', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L905_N02A', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L905_N02B', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L906_N02A', city_name: 'Balamban', barangay_name: 'Aliwanay' },
  { nap_id: 'BAL_001_L907_N01A', city_name: 'Balamban', barangay_name: 'Baliwagan' },
  { nap_id: 'BAL_001_L907_N01B', city_name: 'Balamban', barangay_name: 'Baliwagan' },
  { nap_id: 'BAL_001_L908_N01A', city_name: 'Balamban', barangay_name: 'Baliwagan' },
  { nap_id: 'BAL_001_L909_N01A', city_name: 'Balamban', barangay_name: 'Baliwagan' },
  // Argao
  { nap_id: 'ARG_001_L902_N02A', city_name: 'Argao', barangay_name: 'Poblacion' },
  { nap_id: 'ARG_001_L904_N02A', city_name: 'Argao', barangay_name: 'Poblacion' },
  { nap_id: 'ARG_001_L908_N01A', city_name: 'Argao', barangay_name: 'Canbanua' },
  { nap_id: 'ARG_001_L908_N02A', city_name: 'Argao', barangay_name: 'Poblacion' },
  { nap_id: 'ARG_001_L913_N01A', city_name: 'Argao', barangay_name: 'Poblacion' },
  { nap_id: 'ARG_001_L914_N01A', city_name: 'Argao', barangay_name: 'Poblacion' },
  { nap_id: 'ARG_001_L914_N02A', city_name: 'Argao', barangay_name: 'Poblacion' },
  // Bantayan
  { nap_id: 'BAN_101_L901_N01A', city_name: 'Bantayan', barangay_name: 'Binaobao' },
  // Carmen
  { nap_id: 'CRM_701_L903_N02A', city_name: 'Carmen', barangay_name: 'Cogon East' },
  { nap_id: 'CRM_701_L904_N01A', city_name: 'Carmen', barangay_name: 'Cogon East' },
  { nap_id: 'CRM_701_L904_N02A', city_name: 'Carmen', barangay_name: 'Cogon East' },
  { nap_id: 'CRM_701_L905_N01A', city_name: 'Carmen', barangay_name: 'Cogon East' },
  { nap_id: 'CRM_701_L906_N01A', city_name: 'Carmen', barangay_name: 'Cogon West' },
  { nap_id: 'CRM_701_L906_N02A', city_name: 'Carmen', barangay_name: 'Cogon West' },
  { nap_id: 'CRM_701_L907_N01A', city_name: 'Carmen', barangay_name: 'Cogon West' },
  { nap_id: 'CRM_701_L908_N01A', city_name: 'Carmen', barangay_name: 'Cogon East' },
  { nap_id: 'CRM_701_L908_N02A', city_name: 'Carmen', barangay_name: 'Cogon West' },
  // Daanbantayan
  { nap_id: 'DAA_101_L901_N01A', city_name: 'Daanbantayan', barangay_name: 'Poblacion' },
  { nap_id: 'DAA_101_L904_N01A', city_name: 'Daanbantayan', barangay_name: 'Poblacion' },
  // Dalaguete
  { nap_id: 'DAL_001_L905_N01A', city_name: 'Dalaguete', barangay_name: 'Poblacion' },
  { nap_id: 'DAL_001_L907_N02A', city_name: 'Dalaguete', barangay_name: 'Poblacion' },
  { nap_id: 'DAL_001_L908_N02A', city_name: 'Dalaguete', barangay_name: 'Poblacion' },
  { nap_id: 'DAL_001_L909_N01A', city_name: 'Dalaguete', barangay_name: 'Poblacion' },
  { nap_id: 'DAL_001_L912_N02A', city_name: 'Dalaguete', barangay_name: 'Poblacion' },
  { nap_id: 'DAL_001_L913_N01A', city_name: 'Dalaguete', barangay_name: 'Poblacion' },
];

// Column indexes (0-based) in the export CSV
const COL_NAP_ID = 0;
const COL_CITY = 9;
const COL_BRGY = 16;

function main() {
  const raw = zlib.gunzipSync(fs.readFileSync(CSV_GZ));
  const csvText = raw.toString('utf-8');
  const records = csvParse.parse(csvText, { columns: false, skip_empty_lines: true, bom: true });
  const header = records.shift(); // first row = header
  const cityIdx = header.indexOf('city_name');
  const brgyIdx = header.indexOf('barangay_name');
  const idIdx = header.indexOf('nap_id');
  console.log(`Header cols: nap_id=${idIdx}, city_name=${cityIdx}, barangay_name=${brgyIdx}`);

  const byId = new Map(CORRECTIONS.map((c) => [c.nap_id, c]));
  let applied = 0;
  for (const row of records) {
    const napId = row[idIdx];
    const fix = byId.get(napId);
    if (fix) {
      row[cityIdx] = fix.city_name;
      if (fix.barangay_name) row[brgyIdx] = fix.barangay_name;
      applied++;
    }
  }
  console.log(`Applied ${applied} of ${CORRECTIONS.length} corrections.`);
  if (applied < CORRECTIONS.length) {
    const missing = CORRECTIONS.filter((c) => !records.some((r) => r[idIdx] === c.nap_id)).map((c) => c.nap_id);
    console.log('  Missing nap_ids:', missing.join(', ') || '(none)');
  }

  // Re-serialize (RFC 4180: quote when needed). csv-stringify is not in
  // the dependency tree, so serialize manually.
  const quote = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const outLines = [header.map(quote).join(',')];
  for (const row of records) outLines.push(row.map(quote).join(','));
  const outCsv = outLines.join('\n') + '\n';
  fs.writeFileSync(CSV_GZ, zlib.gzipSync(Buffer.from(outCsv, 'utf-8')));

  // Update the hash gate so the next deploy re-imports the corrected CSV
  const crypto = require('crypto');
  const newHash = crypto.createHash('sha256').update(zlib.gzipSync(Buffer.from(outCsv, 'utf-8'))).digest('hex');
  if (fs.existsSync(HASH_FILE)) {
    fs.writeFileSync(HASH_FILE, newHash + '\n');
    console.log(`Hash file updated → ${newHash.slice(0, 12)}… (next deploy will re-import)`);
  }
  console.log('Done.');
}

main();
