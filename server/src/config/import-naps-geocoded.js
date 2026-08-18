#!/usr/bin/env node
/**
 * Import NAPs from geocoded Excel file into database.
 * 
 * Usage: node src/config/import-naps-geocoded.js /path/to/file.xlsx
 * 
 * Excel columns (22 total):
 *   0: Location
 *   1: NAP ID
 *   2: Physical Status
 *   3: NAP Location (Indoor/Outdoor)
 *   4: Serving Building/Property/Tower
 *   5: Serving Floors
 *   6: NAP Address
 *   7: Latitude
 *   8: Longitude
 *   9: Discovered When
 *   10: Customer Type
 *   11: OLT ID
 *   12: OLT Port (cabinet)
 *   13: Ports Total
 *   14: Ports Assigned (working_lines)
 *   15: Ports Reserved
 *   16: Ports Defective
 *   17: Ports Contingency
 *   18: Ports Available (vacant_lines)
 *   19: PROVINCE_NAME (geocoded)
 *   20: CITY_NAME (geocoded)
 *   21: BRGY_NAME (geocoded)
 */

const fs = require('fs');
const { pool } = require('./database');

// Use read-only Excel parser
let XLSX;
try {
    XLSX = require('xlsx');
} catch (e) {
    console.error('xlsx module not found. Run: npm install xlsx');
    process.exit(1);
}

const BATCH_SIZE = 500;

function cleanValue(val, maxLen) {
    if (!val && val !== 0) return null;
    val = String(val).trim();
    if (val === 'null' || val === '#N/A' || val === 'None' || val === '') return null;
    if (maxLen && val.length > maxLen) val = val.substring(0, maxLen);
    return val;
}

function parseIntSafe(val) {
    if (!val && val !== 0) return 0;
    const n = parseInt(String(val).replace(/,/g, ''), 10);
    return isNaN(n) ? 0 : n;
}

function parseFloatSafe(val) {
    if (!val && val !== 0) return null;
    const n = parseFloat(String(val).replace(/,/g, ''));
    return isNaN(n) ? null : n;
}

async function importNaps(excelPath) {
    console.log(`Reading Excel: ${excelPath}`);
    
    if (!fs.existsSync(excelPath)) {
        console.error(`File not found: ${excelPath}`);
        process.exit(1);
    }

    const workbook = XLSX.readFile(excelPath, { type: 'file' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log(`Sheet: ${sheetName}`);
    console.log(`Total rows: ${data.length - 1}`);

    // Clear existing naps
    console.log('Clearing existing NAPs...');
    await pool.query('DELETE FROM naps');

    let imported = 0;
    let skipped = 0;
    let batch = [];

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || row.length < 19) {
            skipped++;
            continue;
        }

        const napId = cleanValue(row[1], 100);
        if (!napId) { skipped++; continue; }

        const lat = parseFloatSafe(row[7]);
        const lng = parseFloatSafe(row[8]);

        if (!lat || !lng) { skipped++; continue; }

        // Skip obviously invalid coordinates
        if (lat < 4 || lat > 21 || lng < 116 || lng > 127) { skipped++; continue; }

        batch.push({
            nap_id: napId,
            cabinet: cleanValue(row[12], 100),
            location_type: cleanValue(row[3], 50),
            building_served: cleanValue(row[4], 500),
            floors_served: cleanValue(row[5], 200),
            working_lines: parseIntSafe(row[14]),
            vacant_lines: parseIntSafe(row[18]),
            total_capacity: parseIntSafe(row[13]),
            cfs_region: cleanValue(row[19], 100),
            city_name: cleanValue(row[20], 100),
            province_name: cleanValue(row[19], 100),
            barangay_name: cleanValue(row[21], 100),
            dp_nap_lat: lat,
            dp_nap_long: lng,
            naps_status: cleanValue(row[2], 50),
            olt_id: cleanValue(row[11], 100),
            sell_status: cleanValue(row[2], 50),
        });

        if (batch.length >= BATCH_SIZE) {
            await insertBatch(batch);
            imported += batch.length;
            batch = [];
            if (imported % 10000 === 0) {
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

    // Deduplicate by nap_id within batch
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
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
        );
        values.push(
            nap.nap_id, nap.cabinet, nap.location_type, nap.building_served, nap.floors_served,
            nap.working_lines, nap.vacant_lines, nap.total_capacity, nap.cfs_region,
            nap.city_name, nap.province_name, nap.barangay_name, nap.dp_nap_lat, nap.dp_nap_long,
            nap.naps_status, nap.olt_id
        );
    }

    const query = `
        INSERT INTO naps (
            nap_id, cabinet, location_type, building_served, floors_served,
            working_lines, vacant_lines, total_capacity, cfs_region,
            city_name, province_name, barangay_name, dp_nap_lat, dp_nap_long,
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
            cfs_region = EXCLUDED.cfs_region,
            city_name = EXCLUDED.city_name,
            province_name = EXCLUDED.province_name,
            barangay_name = EXCLUDED.barangay_name,
            dp_nap_lat = EXCLUDED.dp_nap_lat,
            dp_nap_long = EXCLUDED.dp_nap_long,
            naps_status = EXCLUDED.naps_status,
            olt_id = EXCLUDED.olt_id,
            updated_at = NOW()
    `;

    await pool.query(query, values);
}

// Run
const excelPath = process.argv[2];
if (!excelPath) {
    console.error('Usage: node import-naps-geocoded.js /path/to/file.xlsx');
    process.exit(1);
}

importNaps(excelPath).catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
});
