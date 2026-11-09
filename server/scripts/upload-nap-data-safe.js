#!/usr/bin/env node
/**
 * Safe NAP Data Upload with Duplicate Handling
 * Handles duplicates by keeping the first occurrence or using UPSERT
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

function parseNAPAddress(addressField) {
  const parts = { state: '', city: '', barangay: '' };
  if (!addressField) return parts;
  
  const stateMatch = addressField.match(/State:\s*([^;]+)/i);
  if (stateMatch) parts.state = stateMatch[1].trim();
  
  const cityMatch = addressField.match(/City:\s*([^;]+)/i);
  if (cityMatch) parts.city = cityMatch[1].trim();
  
  const barangayMatch = addressField.match(/(?:BRGY\.|BARANGAY)\s*([^;,]+)/i);
  if (barangayMatch) parts.barangay = barangayMatch[1].trim();
  
  return parts;
}

function mapRowToDatabase(row) {
  const addressParts = parseNAPAddress(row['Nap Address']);
  
  const portsTotal = parseInt(row['Ports Total']) || 0;
  const portsAssigned = parseInt(row['Ports Assigned']) || 0;
  const portsAvailable = parseInt(row['Ports Available']) || 0;
  
  return {
    nap_id: row['NAP ID']?.trim() || null,
    cabinet: row['Location']?.trim() || null,
    location_type: row['Nap Location']?.trim() || null,
    building_served: null,
    floors_served: null,
    working_lines: portsAssigned,
    vacant_lines: portsAvailable,
    total_capacity: portsTotal,
    cfs_region: addressParts.state || null,
    city_name: addressParts.city || null,
    province_name: addressParts.state || null,
    dp_nap_lat: row['Latitude'] ? parseFloat(row['Latitude']) : null,
    dp_nap_long: row['Longitude'] ? parseFloat(row['Longitude']) : null,
    naps_status: row['Physical Status']?.trim() || null,
    olt_id: row['OLT ID']?.trim() || null,
    sell_status: null,
    barangay_name: addressParts.barangay || null
  };
}

async function uploadNAPData(csvFilePath, mode = 'upsert') {
  console.log('========================================');
  console.log('Safe NAP Data Upload');
  console.log('========================================\n');
  
  const client = await pool.connect();
  
  try {
    console.log('✓ Connected to database');
    console.log(`  Database: ${process.env.DB_NAME}`);
    console.log(`  Mode: ${mode}\n`);
    
    const countBefore = await client.query('SELECT COUNT(*) FROM naps');
    console.log(`Current NAPs in database: ${parseInt(countBefore.rows[0].count).toLocaleString()}\n`);
    
    console.log(`Reading CSV: ${path.basename(csvFilePath)}`);
    
    const records = new Map(); // Use Map to automatically handle duplicates
    const errors = [];
    let rowNumber = 0;
    let duplicatesInCSV = 0;
    
    // Read CSV and deduplicate
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          rowNumber++;
          try {
            const mapped = mapRowToDatabase(row);
            
            if (!mapped.nap_id) {
              errors.push({ row: rowNumber, error: 'Missing NAP ID' });
              return;
            }
            
            // Keep first occurrence of each NAP ID
            if (records.has(mapped.nap_id)) {
              duplicatesInCSV++;
            } else {
              records.set(mapped.nap_id, mapped);
            }
            
            if (records.size % 10000 === 0) {
              console.log(`  Processed ${records.size.toLocaleString()} unique records...`);
            }
          } catch (error) {
            errors.push({ row: rowNumber, error: error.message });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    console.log(`✓ Read ${records.size.toLocaleString()} unique NAP records`);
    
    if (duplicatesInCSV > 0) {
      console.log(`  (Removed ${duplicatesInCSV} duplicate NAP IDs from CSV)`);
    }
    
    if (errors.length > 0) {
      console.log(`⚠ Skipped ${errors.length} invalid records\n`);
    }
    
    // Confirm
    if (!process.argv.includes('--confirm')) {
      console.log('\nUpload Strategy (UPSERT mode):');
      console.log('  1. INSERT new NAP records');
      console.log('  2. UPDATE existing NAPs with new data');
      console.log('  3. Keep NAPs not in CSV (safe)');
      console.log('');
      console.log('To proceed, run with --confirm flag:');
      console.log(`  node ${path.basename(__filename)} "${csvFilePath}" --confirm\n`);
      process.exit(0);
    }
    
    console.log('\nStarting UPSERT...');
    await client.query('BEGIN');
    
    const recordArray = Array.from(records.values());
    const batchSize = 1000;
    let inserted = 0;
    let updated = 0;
    let failed = 0;
    
    for (let i = 0; i < recordArray.length; i += batchSize) {
      const batch = recordArray.slice(i, i + batchSize);
      
      for (const record of batch) {
        try {
          // UPSERT: INSERT or UPDATE if exists
          const result = await client.query(`
            INSERT INTO naps (
              nap_id, cabinet, location_type, building_served, floors_served,
              working_lines, vacant_lines, total_capacity, cfs_region, city_name,
              province_name, dp_nap_lat, dp_nap_long, naps_status, olt_id,
              sell_status, barangay_name, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, NOW()
            )
            ON CONFLICT (nap_id) DO UPDATE SET
              cabinet = EXCLUDED.cabinet,
              location_type = EXCLUDED.location_type,
              working_lines = EXCLUDED.working_lines,
              vacant_lines = EXCLUDED.vacant_lines,
              total_capacity = EXCLUDED.total_capacity,
              cfs_region = EXCLUDED.cfs_region,
              city_name = EXCLUDED.city_name,
              province_name = EXCLUDED.province_name,
              dp_nap_lat = EXCLUDED.dp_nap_lat,
              dp_nap_long = EXCLUDED.dp_nap_long,
              naps_status = EXCLUDED.naps_status,
              olt_id = EXCLUDED.olt_id,
              barangay_name = EXCLUDED.barangay_name,
              updated_at = NOW()
            RETURNING (xmax = 0) AS inserted
          `, [
            record.nap_id, record.cabinet, record.location_type, record.building_served,
            record.floors_served, record.working_lines, record.vacant_lines,
            record.total_capacity, record.cfs_region, record.city_name,
            record.province_name, record.dp_nap_lat, record.dp_nap_long,
            record.naps_status, record.olt_id, record.sell_status,
            record.barangay_name
          ]);
          
          if (result.rows[0].inserted) {
            inserted++;
          } else {
            updated++;
          }
        } catch (error) {
          console.error(`Error upserting NAP ${record.nap_id}:`, error.message);
          failed++;
        }
      }
      
      const total = inserted + updated;
      if (total % 10000 === 0) {
        console.log(`  Processed ${total.toLocaleString()} / ${recordArray.length.toLocaleString()} records...`);
      }
    }
    
    console.log(`\n✓ Inserted ${inserted.toLocaleString()} new records`);
    console.log(`✓ Updated ${updated.toLocaleString()} existing records`);
    if (failed > 0) {
      console.log(`⚠ Failed ${failed} records`);
    }
    
    await client.query('COMMIT');
    console.log('\n✓ Transaction committed');
    
    const countAfter = await client.query('SELECT COUNT(*) FROM naps');
    console.log(`\nFinal NAPs in database: ${parseInt(countAfter.rows[0].count).toLocaleString()}`);
    
    // Show summary by region
    console.log('\nTop 15 Regions:');
    const regionStats = await client.query(`
      SELECT cfs_region, COUNT(*)::int as count
      FROM naps
      WHERE cfs_region IS NOT NULL AND cfs_region != ''
      GROUP BY cfs_region
      ORDER BY count DESC
      LIMIT 15
    `);
    
    regionStats.rows.forEach(row => {
      console.log(`  ${row.cfs_region.padEnd(30)} ${row.count.toLocaleString()}`);
    });
    
    // Regenerate snapshot
    console.log('\nRegenerating NAP snapshot...');
    const snapshotScript = path.join(__dirname, 'emit-nap-snapshot.js');
    if (fs.existsSync(snapshotScript)) {
      const { execSync } = require('child_process');
      execSync(`node "${snapshotScript}"`, { stdio: 'inherit' });
      console.log('✓ Snapshot regenerated');
    }
    
    console.log('\n========================================');
    console.log('Upload Complete!');
    console.log('========================================\n');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Error:', error.message);
    console.error('\nTransaction rolled back.');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Main
if (require.main === module) {
  const csvFile = process.argv[2];
  
  if (!csvFile) {
    console.log('Usage: node upload-nap-data-safe.js <csv_file> [--confirm]');
    console.log('');
    console.log('Example:');
    console.log('  node upload-nap-data-safe.js ~/Downloads/NAP_Standardized_*.csv --confirm');
    process.exit(1);
  }
  
  if (!fs.existsSync(csvFile)) {
    console.error(`Error: File not found: ${csvFile}`);
    process.exit(1);
  }
  
  uploadNAPData(csvFile, 'upsert').catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { uploadNAPData };
