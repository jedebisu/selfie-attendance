require('dotenv').config();
const { pool } = require('./database');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parse/sync');

const CSV_PATH = '/Users/yanggee/Downloads/NAP_DEPLOYMENT_FORMAT.csv';

// Only include Cebu and Bohol
const ALLOWED_PROVINCES = ['CEBU', 'BOHOL'];

const seedNaps = async () => {
  const client = await pool.connect();
  
  try {
    // Read CSV file
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const records = csv.parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`Found ${records.length} NAP records in CSV`);

    await client.query('BEGIN');

    // Clear existing NAP data
    await client.query('DELETE FROM naps');
    console.log('Cleared existing NAP data');

    let inserted = 0;
    let skipped = 0;
    let skippedProvince = 0;

    for (const record of records) {
      const napId = record['DP'];
      if (!napId) {
        skipped++;
        continue;
      }

      // Only include Cebu and Bohol
      const province = (record['PROVINCE_NAME'] || '').toUpperCase().trim();
      if (!ALLOWED_PROVINCES.some(p => province.includes(p))) {
        skippedProvince++;
        continue;
      }

      const lat = parseFloat(record['DP_NAP_LAT']);
      const lng = parseFloat(record['DP_NAP_LONG']);
      
      // Skip records without valid coordinates
      if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
        skipped++;
        continue;
      }

      try {
        await client.query(`
          INSERT INTO naps (
            nap_id, cabinet, location_type, building_served, floors_served,
            working_lines, vacant_lines, total_capacity, cfs_region,
            city_name, province_name, dp_nap_lat, dp_nap_long,
            naps_status, olt_id, sell_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
            dp_nap_lat = EXCLUDED.dp_nap_lat,
            dp_nap_long = EXCLUDED.dp_nap_long,
            naps_status = EXCLUDED.naps_status,
            olt_id = EXCLUDED.olt_id,
            sell_status = EXCLUDED.sell_status,
            updated_at = NOW()
        `, [
          napId,
          record['CABINET'] || null,
          record['LOCATION_TYPE'] || null,
          record['BULDING_SERVED'] || null,
          record['FLOOR_SERVED'] || null,
          parseInt(record['Working Lines']) || 0,
          parseInt(record['Vacant Lines']) || 0,
          parseInt(record['Total Capacity']) || 0,
          record['CFS_REGION'] || null,
          record['CITY_NAME'] || null,
          record['PROVINCE_NAME'] || null,
          lat,
          lng,
          record['SELL_STATUS'] || 'Unknown',
          record['CABINET'] || null,  // Using cabinet as olt_id
          record['SELL_STATUS'] || null
        ]);
        inserted++;
      } catch (err) {
        console.error(`Error inserting NAP ${napId}:`, err.message);
        skipped++;
      }
    }

    await client.query('COMMIT');
    console.log(`\nSeed completed:`);
    console.log(`  Inserted: ${inserted} (Cebu & Bohol only)`);
    console.log(`  Skipped (no coords): ${skipped}`);
    console.log(`  Skipped (other provinces): ${skippedProvince}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run seed
seedNaps()
  .then(() => {
    console.log('NAP seed completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('NAP seed failed:', error);
    process.exit(1);
  });
