#!/usr/bin/env node
/**
 * Import NAPs from "NAP Facility Summary Report" CSV into database.
 * 
 * Usage: node src/config/import-naps-facility.js /path/to/file.csv
 * 
 * CSV is semicolon-delimited. Report header (row 5 in raw exports) has 19
 * columns; the NAP Address field (col 6) contains embedded semicolons, so
 * parsed rows have variable column counts. The 12 trailing fields after the
 * address are always:
 *   -12: Latitude
 *   -11: Longitude
 *   -10: Discovered When
 *   -9: Customer Type
 *   -8: OLT ID
 *   -7: OLT Port (cabinet)
 *   -6: Ports Total
 *   -5: Ports Assigned
 *   -4: Ports Reserved
 *   -3: Ports Defective
 *   -2: Ports Contingency
 *   -1: Ports Available
 * Fixed columns: 0 Location, 1 NAP ID, 2 Physical Status, 3 NAP Location,
 * 4 Serving Building, 5 Serving Floors, 6..-13 NAP Address.
 * Backward compatible with the older 24-column export (address at 6-11).
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('./database');

const BATCH_SIZE = 500;

function extractFromAddress(addressParts) {
  // Combine all address parts (6-11) into one string
  const fullAddress = addressParts.join(';');

  // Extract city: "City: QUEZON CITY" or "City: QUEZON CITY, NCR"
  let city = null;
  const cityMatch = fullAddress.match(/City:\s*([^;"]+)/i);
  if (cityMatch) {
    city = cityMatch[1].trim().replace(/"/g, '').trim();
    // Some cities have region appended: "CEBU CITY, CEBU" -> take before comma
    if (city.includes(',')) {
      city = city.split(',')[0].trim();
    }
  }

  // Extract region from State field: "State: NCR", "State: VIS", etc.
  let region = null;
  const stateMatch = fullAddress.match(/State:\s*([^;"]+)/i);
  if (stateMatch) {
    region = stateMatch[1].trim().replace(/"/g, '').trim();
  }

  return { city, region };
}

function cleanValue(val, maxLen) {
  if (!val) return null;
  val = val.trim().replace(/^"|"$/g, '').trim();
  if (!val) return null;
  if (maxLen && val.length > maxLen) val = val.substring(0, maxLen);
  return val;
}

function parseIntSafe(val) {
  if (!val) return 0;
  val = val.trim().replace(/,/g, '');
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

function parseFloatSafe(val) {
  if (!val) return null;
  val = val.trim().replace(/,/g, '');
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

async function importNaps(csvPath) {
  console.log(`Reading CSV: ${csvPath}`);
  
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  
  // Find the column header row (handles report files with leading title rows,
  // e.g. rows 0-4 in the raw NAP Facility Summary Report export)
  let headerIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('NAP ID') && lines[i].includes('Latitude')) {
      headerIdx = i;
      break;
    }
  }
  const dataLines = lines.slice(headerIdx + 1).filter(l => l.trim());
  console.log(`Total data lines: ${dataLines.length}`);

  let imported = 0;
  let skipped = 0;
  let batch = [];

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i].replace(/\r/g, '');
    const parts = line.split(';');

    // The NAP Address field (col 6) contains embedded semicolons, so the raw
    // split count varies per row. Anchor from the end: the 12 trailing fields
    // after the address are always lat, lng, discovered, customer type,
    // OLT ID, OLT Port, ports total, assigned, reserved, defective,
    // contingency, available.
    if (parts.length < 19) {
      skipped++;
      continue;
    }

    const napId = cleanValue(parts[1]);
    if (!napId) { skipped++; continue; }

    const lat = parseFloatSafe(parts[parts.length - 12]);
    const lng = parseFloatSafe(parts[parts.length - 11]);

    // Skip NAPs without coordinates
    if (!lat || !lng) { skipped++; continue; }

    // Skip obviously invalid coordinates (outside Philippines)
    if (lat < 4 || lat > 21 || lng < 116 || lng > 127) { skipped++; continue; }

    const { city, region } = extractFromAddress(parts.slice(6, parts.length - 12));

    batch.push({
      nap_id: napId,
      cabinet: cleanValue(parts[parts.length - 7], 100),
      location_type: cleanValue(parts[3], 50),
      building_served: cleanValue(parts[4], 500),
      floors_served: cleanValue(parts[5], 200),
      working_lines: parseIntSafe(parts[parts.length - 5]),
      vacant_lines: parseIntSafe(parts[parts.length - 1]),
      total_capacity: parseIntSafe(parts[parts.length - 6]),
      cfs_region: region || null,
      city_name: city ? (city.length > 100 ? city.substring(0, 100) : city) : null,
      province_name: region || null,
      dp_nap_lat: lat,
      dp_nap_long: lng,
      naps_status: cleanValue(parts[2], 50),
      olt_id: cleanValue(parts[parts.length - 8], 100),
      sell_status: cleanValue(parts[2], 50),
    });

    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch);
      imported += batch.length;
      batch = [];
      if (imported % 5000 === 0) {
        console.log(`  Progress: ${imported} imported, ${skipped} skipped...`);
      }
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    await insertBatch(batch);
    imported += batch.length;
  }

  console.log(`\nDone!`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Skipped: ${skipped}`);
  
  const result = await pool.query('SELECT COUNT(*) FROM naps');
  console.log(`  Total NAPs in DB: ${result.rows[0].count}`);
  
  await pool.end();
}

async function insertBatch(batch) {
  if (batch.length === 0) return;

  // Deduplicate by nap_id within batch (keep last occurrence)
  const deduped = new Map();
  for (const nap of batch) {
    deduped.set(nap.nap_id, nap);
  }
  const uniqueNaps = Array.from(deduped.values());

  const values = [];
  const placeholders = [];
  let idx = 1;

  for (const nap of uniqueNaps) {
    placeholders.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
    );
    values.push(
      nap.nap_id, nap.cabinet, nap.location_type, nap.building_served, nap.floors_served,
      nap.working_lines, nap.vacant_lines, nap.total_capacity, nap.cfs_region,
      nap.city_name, nap.province_name, nap.dp_nap_lat, nap.dp_nap_long,
      nap.naps_status, nap.olt_id
    );
  }

  const query = `
    INSERT INTO naps (
      nap_id, cabinet, location_type, building_served, floors_served,
      working_lines, vacant_lines, total_capacity, cfs_region,
      city_name, province_name, dp_nap_lat, dp_nap_long,
      naps_status, olt_id
    ) VALUES ${placeholders.join(', ')}
    ON CONFLICT (nap_id) DO UPDATE SET
      cabinet = EXCLUDED.cabinet,
      location_type = EXCLUDED.location_type,
      building_served = EXCLUDED.building_served,
      floors_served = EXCLUDED.floors_served,
      working_lines = EXCLUDED.working_lines,
      vacant_lines = EXCLUDED.vacant_lines,
      total_capacity = EXCLUDED.total_capacity,
      city_name = EXCLUDED.city_name,
      province_name = EXCLUDED.province_name,
      dp_nap_lat = EXCLUDED.dp_nap_lat,
      dp_nap_long = EXCLUDED.dp_nap_long,
      naps_status = EXCLUDED.naps_status,
      olt_id = EXCLUDED.olt_id,
      updated_at = NOW()
  `;

  await pool.query(query, values);
}

// Run
const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node import-naps-facility.js /path/to/file.csv');
  process.exit(1);
}

importNaps(csvPath).catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
