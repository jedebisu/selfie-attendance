#!/usr/bin/env node
/**
 * Upload Standardized NAP Data to Database
 * Maps the cleaned CSV format to the existing naps table structure
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Parse NAP Address field
function parseNAPAddress(addressField) {
  const parts = {
    state: '',
    city: '',
    barangay: ''
  };
  
  if (!addressField) return parts;
  
  // Extract State
  const stateMatch = addressField.match(/State:\s*([^;]+)/i);
  if (stateMatch) parts.state = stateMatch[1].trim();
  
  // Extract City
  const cityMatch = addressField.match(/City:\s*([^;]+)/i);
  if (cityMatch) parts.city = cityMatch[1].trim();
  
  // Extract Barangay from Additional Address or Location
  const barangayMatch = addressField.match(/(?:BRGY\.|BARANGAY)\s*([^;,]+)/i);
  if (barangayMatch) {
    parts.barangay = barangayMatch[1].trim();
  }
  
  return parts;
}

// Map CSV row to database columns
function mapRowToDatabase(row) {
  const addressParts = parseNAPAddress(row['Nap Address']);
  
  // Calculate port values
  const portsTotal = parseInt(row['Ports Total']) || 0;
  const portsAssigned = parseInt(row['Ports Assigned']) || 0;
  const portsReserved = parseInt(row['Ports Reserved']) || 0;
  const portsDefective = parseInt(row['Ports Defective']) || 0;
  const portsAvailable = parseInt(row['Ports Available']) || 0;
  
  // Vacant lines = Available ports
  const vacantLines = portsAvailable;
  
  // Working lines = Assigned ports
  const workingLines = portsAssigned;
  
  return {
    nap_id: row['NAP ID']?.trim() || null,
    cabinet: row['Location']?.trim() || null,
    location_type: row['Nap Location']?.trim() || null,
    building_served: null, // Not in standardized format
    floors_served: null, // Not in standardized format
    working_lines: workingLines,
    vacant_lines: vacantLines,
    total_capacity: portsTotal,
    cfs_region: addressParts.state || null,
    city_name: addressParts.city || null,
    province_name: addressParts.state || null, // Use state as province
    dp_nap_lat: row['Latitude'] ? parseFloat(row['Latitude']) : null,
    dp_nap_long: row['Longitude'] ? parseFloat(row['Longitude']) : null,
    naps_status: row['Physical Status']?.trim() || null,
    olt_id: row['OLT ID']?.trim() || null,
    sell_status: null, // Not in standardized format
    barangay_name: addressParts.barangay || null
  };
}

async function uploadNAPData(csvFilePath) {
  console.log('========================================');
  console.log('NAP Data Upload to Database');
  console.log('========================================\n');
  
  const client = await pool.connect();
  
  try {
    console.log('✓ Connected to database');
    console.log(`  Database: ${process.env.DB_NAME}`);
    console.log(`  Host: ${process.env.DB_HOST}\n`);
    
    // Start transaction
    await client.query('BEGIN');
    
    // Get current count
    const countBefore = await client.query('SELECT COUNT(*) FROM naps');
    console.log(`Current NAPs in database: ${parseInt(countBefore.rows[0].count).toLocaleString()}\n`);
    
    console.log(`Reading CSV: ${path.basename(csvFilePath)}`);
    
    const records = [];
    const errors = [];
    let rowNumber = 0;
    
    // Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (row) => {
          rowNumber++;
          try {
            const mapped = mapRowToDatabase(row);
            
            // Validate required fields
            if (!mapped.nap_id) {
              errors.push({ row: rowNumber, error: 'Missing NAP ID', data: row });
              return;
            }
            
            records.push(mapped);
            
            if (records.length % 10000 === 0) {
              console.log(`  Processed ${records.length.toLocaleString()} records...`);
            }
          } catch (error) {
            errors.push({ row: rowNumber, error: error.message, data: row });
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    console.log(`✓ Read ${records.length.toLocaleString()} valid records`);
    
    if (errors.length > 0) {
      console.log(`⚠ Skipped ${errors.length} invalid records\n`);
    }
    
    // Ask for confirmation
    console.log('\nUpload Strategy:');
    console.log('  1. DELETE all existing NAPs');
    console.log('  2. INSERT new standardized data');
    console.log('  3. Rebuild indexes');
    console.log('');
    console.log('⚠ WARNING: This will replace ALL existing NAP data!');
    console.log('');
    
    // Check if running in interactive mode
    if (process.argv.includes('--confirm')) {
      console.log('--confirm flag provided, proceeding...\n');
    } else {
      console.log('To proceed, run with --confirm flag:');
      console.log(`  node ${path.basename(__filename)} "${csvFilePath}" --confirm\n`);
      await client.query('ROLLBACK');
      process.exit(0);
    }
    
    // Delete existing data
    console.log('Deleting existing NAP data...');
    const deleteResult = await client.query('DELETE FROM naps');
    console.log(`✓ Deleted ${deleteResult.rowCount.toLocaleString()} existing records\n`);
    
    // Insert new data in batches
    console.log('Inserting standardized NAP data...');
    const batchSize = 1000;
    let inserted = 0;
    let duplicates = 0;
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      for (const record of batch) {
        try {
          await client.query(`
            INSERT INTO naps (
              nap_id, cabinet, location_type, building_served, floors_served,
              working_lines, vacant_lines, total_capacity, cfs_region, city_name,
              province_name, dp_nap_lat, dp_nap_long, naps_status, olt_id,
              sell_status, barangay_name, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, $16, $17, NOW()
            )
          `, [
            record.nap_id,
            record.cabinet,
            record.location_type,
            record.building_served,
            record.floors_served,
            record.working_lines,
            record.vacant_lines,
            record.total_capacity,
            record.cfs_region,
            record.city_name,
            record.province_name,
            record.dp_nap_lat,
            record.dp_nap_long,
            record.naps_status,
            record.olt_id,
            record.sell_status,
            record.barangay_name
          ]);
          inserted++;
        } catch (error) {
          if (error.code === '23505') { // Duplicate key
            duplicates++;
          } else {
            console.error(`Error inserting NAP ${record.nap_id}:`, error.message);
          }
        }
      }
      
      console.log(`  Inserted ${inserted.toLocaleString()} / ${records.length.toLocaleString()} records...`);
    }
    
    console.log(`✓ Inserted ${inserted.toLocaleString()} records`);
    if (duplicates > 0) {
      console.log(`⚠ Skipped ${duplicates} duplicates`);
    }
    
    // Commit transaction
    await client.query('COMMIT');
    console.log('\n✓ Transaction committed');
    
    // Get final count
    const countAfter = await client.query('SELECT COUNT(*) FROM naps');
    console.log(`\nFinal NAPs in database: ${parseInt(countAfter.rows[0].count).toLocaleString()}`);
    
    // Show summary by region
    console.log('\nNAPs by Region:');
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
    const snapshotScript = path.join(__dirname, '../scripts/emit-nap-snapshot.js');
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
    console.error('\nTransaction rolled back. Database unchanged.');
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Main
if (require.main === module) {
  const csvFile = process.argv[2];
  
  if (!csvFile) {
    console.log('Usage: node upload-nap-data.js <csv_file> [--confirm]');
    console.log('');
    console.log('Example:');
    console.log('  node upload-nap-data.js ~/Downloads/NAP_Standardized_20261025_162340_standardized.csv --confirm');
    process.exit(1);
  }
  
  if (!fs.existsSync(csvFile)) {
    console.error(`Error: File not found: ${csvFile}`);
    process.exit(1);
  }
  
  uploadNAPData(csvFile).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { uploadNAPData, parseNAPAddress, mapRowToDatabase };
