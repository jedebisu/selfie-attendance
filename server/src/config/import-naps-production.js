require('dotenv').config();
const { pool } = require('./database');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CSV_PATH = path.join(__dirname, 'naps_export.csv.gz');

const importNaps = async () => {
  const client = await pool.connect();

  try {
    // Check if NAPs already imported
    const countResult = await client.query('SELECT COUNT(*) FROM naps');
    const count = parseInt(countResult.rows[0].count);

    if (count > 0) {
      console.log(`NAPs table already has ${count} rows. Skipping import.`);
      return;
    }

    console.log('NAPs table is empty. Importing from CSV...');

    // Decompress
    const csvPath = CSV_PATH.replace('.gz', '');
    execSync(`gunzip -c "${CSV_PATH}" > "${csvPath}"`);

    // Count lines
    const fileStream = fs.createReadStream(csvPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let lineCount = 0;
    for await (const _ of rl) {
      lineCount++;
    }

    const totalRows = lineCount - 1; // minus header
    console.log(`Total rows to import: ${totalRows}`);

    // Import in batches
    const BATCH_SIZE = 5000;
    const fileStream2 = fs.createReadStream(csvPath);
    const rl2 = readline.createInterface({ input: fileStream2, crlfDelay: Infinity });

    let imported = 0;
    let batch = [];
    let headerSkipped = false;

    await client.query('BEGIN');

    for await (const line of rl2) {
      if (!headerSkipped) {
        headerSkipped = true;
        continue;
      }

      // Parse CSV line (simple comma split, handles basic quoting)
      const fields = parseCSVLine(line);
      if (fields.length < 17) continue;

      batch.push(fields);

      if (batch.length >= BATCH_SIZE) {
        await insertBatch(client, batch);
        imported += batch.length;
        batch = [];
        console.log(`Imported ${imported}/${totalRows} rows...`);
      }
    }

    if (batch.length > 0) {
      await insertBatch(client, batch);
      imported += batch.length;
    }

    await client.query('COMMIT');
    console.log(`Successfully imported ${imported} NAPs!`);

    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_naps_coords ON naps(dp_nap_lat, dp_nap_long)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_naps_nap_id ON naps(nap_id)');
    console.log('Indexes created.');

    // Cleanup temp file
    fs.unlinkSync(csvPath);
    console.log('Temp CSV removed.');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Import failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function insertBatch(client, batch) {
  const values = [];
  const placeholders = [];

  batch.forEach((fields, i) => {
    const offset = i * 17;
    placeholders.push(`(${Array.from({ length: 17 }, (_, j) => `$${offset + j + 1}`).join(',')})`);
    values.push(
      fields[0] || null,  // nap_id
      fields[1] || null,  // cabinet
      fields[2] || null,  // location_type
      fields[3] || null,  // building_served
      fields[4] || null,  // floors_served
      parseInt(fields[5]) || 0,  // working_lines
      parseInt(fields[6]) || 0,  // vacant_lines
      parseInt(fields[7]) || 0,  // total_capacity
      fields[8] || null,  // cfs_region
      fields[9] || null,  // city_name
      fields[10] || null, // province_name
      parseFloat(fields[11]) || null, // dp_nap_lat
      parseFloat(fields[12]) || null, // dp_nap_long
      fields[13] || null, // naps_status
      fields[14] || null, // olt_id
      fields[15] || null, // sell_status
      fields[16] || null  // barangay_name
    );
  });

  await client.query(`
    INSERT INTO naps (nap_id, cabinet, location_type, building_served, floors_served,
      working_lines, vacant_lines, total_capacity, cfs_region, city_name, province_name,
      dp_nap_lat, dp_nap_long, naps_status, olt_id, sell_status, barangay_name)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (nap_id) DO NOTHING
  `, values);
}

// Run
importNaps()
  .then(() => {
    console.log('Import completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  });
