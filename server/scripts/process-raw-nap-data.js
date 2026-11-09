#!/usr/bin/env node
/**
 * Universal NAP Data Processor
 * Simplified version - reads raw NAP exports and standardizes them
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { createObjectCsvWriter } = require('csv-writer');

// Reference format (our standard structure)
const STANDARD_COLUMNS = [
  'Location',
  'NAP ID',
  'Physical Status',
  'Nap Location',
  'Nap Address',
  'Latitude',
  'Longitude',
  'Discovered When',
  'OLT ID',
  'OLT Port',
  'Ports Total',
  'Ports Assigned',
  'Ports Reserved',
  'Ports Defective',
  'Ports Contignency',
  'Ports Available',
  '%'
];

// Column mapping intelligence
const COLUMN_MAPPINGS = {
  'Location': ['Location', 'location', 'NAP Location', 'Site', 'Cabinet'],
  'NAP ID': ['NAP ID', 'nap_id', 'NapID', 'ID', 'Facility ID', 'Facility Name'],
  'Physical Status': ['Physical Status', 'Status', 'naps_status', 'State', 'Operational Status'],
  'Nap Location': ['Nap Location', 'NAP Location', 'Location Type', 'Type', 'Indoor/Outdoor'],
  'Nap Address': ['Nap Address', 'NAP Address', 'Address', 'Full Address', 'Location Address'],
  'Latitude': ['Latitude', 'lat', 'dp_nap_lat', 'Lat', 'Y'],
  'Longitude': ['Longitude', 'long', 'lon', 'dp_nap_long', 'Long', 'X'],
  'Discovered When': ['Discovered When', 'Date Discovered', 'Created', 'Installation Date'],
  'OLT ID': ['OLT ID', 'olt_id', 'OLT', 'Equipment ID'],
  'OLT Port': ['OLT Port', 'Port', 'GPON Port', 'PON Port'],
  'Ports Total': ['Ports Total', 'Total Ports', 'total_capacity', 'Capacity'],
  'Ports Assigned': ['Ports Assigned', 'Assigned', 'Used Ports', 'working_lines'],
  'Ports Reserved': ['Ports Reserved', 'Reserved'],
  'Ports Defective': ['Ports Defective', 'Defective', 'Faulty'],
  'Ports Contignency': ['Ports Contignency', 'Contingency', 'Ports Contingency'],
  'Ports Available': ['Ports Available', 'Available', 'vacant_lines', 'Free Ports'],
  '%': ['%', 'Percentage', 'Status Indicator']
};

class UniversalNAPProcessor {
  constructor() {
    this.mapping = {};
    this.unmapped = [];
  }

  log(message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${timestamp}] ${message}`);
  }

  /**
   * Auto-detect column mappings
   */
  detectColumnMapping(rawHeaders) {
    const mapping = {};
    const unmapped = [];

    for (const stdCol of STANDARD_COLUMNS) {
      const possibleNames = COLUMN_MAPPINGS[stdCol] || [stdCol];
      let found = false;

      for (const rawHeader of rawHeaders) {
        const cleanRaw = rawHeader.trim();
        
        // Try exact match (case-insensitive)
        for (const possible of possibleNames) {
          if (cleanRaw.toLowerCase() === possible.toLowerCase()) {
            mapping[stdCol] = cleanRaw;
            found = true;
            break;
          }
        }
        
        if (found) break;
        
        // Try partial match
        for (const possible of possibleNames) {
          if (cleanRaw.toLowerCase().includes(possible.toLowerCase()) ||
              possible.toLowerCase().includes(cleanRaw.toLowerCase())) {
            mapping[stdCol] = cleanRaw;
            found = true;
            break;
          }
        }
        
        if (found) break;
      }

      if (!found) {
        unmapped.push(stdCol);
      }
    }

    return { mapping, unmapped };
  }

  /**
   * Standardize a single row
   */
  standardizeRow(rawRow) {
    const standardized = {};

    for (const stdCol of STANDARD_COLUMNS) {
      const rawCol = this.mapping[stdCol];
      
      if (rawCol && rawRow[rawCol] !== undefined) {
        let value = String(rawRow[rawCol]).trim();
        
        // Special handling for specific columns
        if (stdCol === 'Latitude' || stdCol === 'Longitude') {
          const num = parseFloat(value);
          value = isNaN(num) ? '' : num.toString();
        } else if (stdCol.startsWith('Ports ') && stdCol !== 'Ports Contignency') {
          const num = parseInt(value);
          value = isNaN(num) ? '0' : num.toString();
        }
        
        standardized[stdCol] = value;
      } else {
        standardized[stdCol] = '';
      }
    }

    return standardized;
  }

  /**
   * Process raw NAP file
   */
  async processRawFile(rawFilePath, outputDir) {
    this.log('========================================');
    this.log('Universal NAP Data Processor');
    this.log('========================================');
    this.log('');
    this.log(`Input: ${path.basename(rawFilePath)}`);

    // Read file content
    const content = fs.readFileSync(rawFilePath, 'utf8');
    
    // Detect delimiter from first few lines
    const sampleLines = content.split('\n').slice(0, 10).join('\n');
    const delimiter = sampleLines.includes(';') ? ';' : ',';
    this.log(`Detected delimiter: '${delimiter}'`);
    
    // Parse CSV properly handling multi-line quoted fields
    let records;
    
    try {
      records = parse(content, {
        delimiter: delimiter,
        bom: true,
        relax_column_count: true,
        skip_empty_lines: false,
        quote: '"',
        escape: '"'
      });
    } catch (error) {
      this.log(`ERROR parsing CSV: ${error.message}`);
      process.exit(1);
    }

    // Find data header row
    let dataStartIndex = -1;
    for (let i = 0; i < Math.min(records.length, 50); i++) {
      const row = records[i];
      const rowStr = row.join(' ').toLowerCase();
      if (rowStr.includes('location') && rowStr.includes('nap') && rowStr.includes('id')) {
        // Check if this row has actual header names
        if (row.some(cell => cell && (cell.toString().toLowerCase().includes('nap id') || cell.toString().toLowerCase() === 'location'))) {
          dataStartIndex = i;
          break;
        }
      }
    }

    if (dataStartIndex === -1) {
      // Try to find any header with NAP
      for (let i = 0; i < Math.min(records.length, 30); i++) {
        const row = records[i];
        if (row.some(cell => cell && cell.toString().toLowerCase().includes('nap id'))) {
          dataStartIndex = i;
          break;
        }
      }
    }

    if (dataStartIndex === -1) {
      dataStartIndex = 0; // Default to first row
      this.log('Could not find header row, using first line');
    } else {
      this.log(`Data header found at row: ${dataStartIndex + 1}`);
    }

    // Use records from dataStartIndex onward
    records = records.slice(dataStartIndex);

    if (records.length === 0) {
      this.log('ERROR: No data found in file');
      process.exit(1);
    }

    const rawHeaders = records[0];
    const rawData = records.slice(1);
    
    this.log(`Detected ${rawHeaders.length} columns in raw data`);
    this.log(`Found ${rawData.length} data rows`);

    // Map columns - use fixed positions for this Globe format
    this.mapping = {
      'Location': rawHeaders[0],
      'NAP ID': rawHeaders[1],
      'Physical Status': rawHeaders[2],
      'Nap Location': rawHeaders[3],
      'Nap Address': rawHeaders[6], // The quoted multi-line address
      'Latitude': rawHeaders[7],
      'Longitude': rawHeaders[8],
      'Discovered When': rawHeaders[9],
      'OLT ID': rawHeaders[11],
      'OLT Port': rawHeaders[12],
      'Ports Total': rawHeaders[13],
      'Ports Assigned': rawHeaders[14],
      'Ports Reserved': rawHeaders[15],
      'Ports Defective': rawHeaders[16],
      'Ports Contignency': rawHeaders[17],
      'Ports Available': rawHeaders[18],
      '%': ''
    };
    this.unmapped = ['%'];
    
    this.log(`Mapped ${Object.keys(this.mapping).length - 1}/${STANDARD_COLUMNS.length} columns`);

    // Process and deduplicate
    const recordsMap = new Map();
    const errors = [];
    let rowNum = 0;

    for (const row of rawData) {
      rowNum++;
      try {
        // Convert array row to object using headers
        const rowObj = {};
        rawHeaders.forEach((header, idx) => {
          rowObj[header] = row[idx] || '';
        });

        const standardized = this.standardizeRow(rowObj);
        const napId = standardized['NAP ID'];

        if (!napId) {
          errors.push({ row: rowNum, error: 'Missing NAP ID' });
          continue;
        }

        // Keep first occurrence (deduplicate)
        if (!recordsMap.has(napId)) {
          recordsMap.set(napId, standardized);
        }

        if (recordsMap.size % 10000 === 0) {
          this.log(`  Processed ${recordsMap.size.toLocaleString()} unique...`);
        }
      } catch (error) {
        errors.push({ row: rowNum, error: error.message });
      }
    }

    const totalRows = rowNum;
    const uniqueCount = recordsMap.size;
    const duplicatesRemoved = totalRows - uniqueCount + errors.length;

    this.log(`\n✓ Processed ${totalRows.toLocaleString()} rows`);
    this.log(`✓ Extracted ${uniqueCount.toLocaleString()} unique NAPs`);
    if (duplicatesRemoved > 0) {
      this.log(`  (Removed ${duplicatesRemoved} duplicates/errors)`);
    }
    if (errors.length > 0) {
      this.log(`⚠ ${errors.length} invalid rows skipped`);
    }

    // Write output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const outputFile = path.join(outputDir, `NAP_Standardized_${timestamp}.csv`);
    const outputDirPath = path.dirname(outputFile);
    
    if (!fs.existsSync(outputDirPath)) {
      fs.mkdirSync(outputDirPath, { recursive: true });
    }

    const csvWriter = createObjectCsvWriter({
      path: outputFile,
      header: STANDARD_COLUMNS.map(col => ({ id: col, title: col }))
    });

    await csvWriter.writeRecords(Array.from(recordsMap.values()));
    this.log(`\n✓ Wrote: ${outputFile}`);

    // Generate report
    const reportFile = outputFile.replace('.csv', '_report.txt');
    const report = [
      'NAP DATA STANDARDIZATION REPORT',
      '='.repeat(70),
      '',
      `Processed: ${new Date().toISOString()}`,
      `Source: ${path.basename(rawFilePath)}`,
      `Output: ${path.basename(outputFile)}`,
      '',
      'SUMMARY',
      '-'.repeat(70),
      `Raw rows processed: ${totalRows.toLocaleString()}`,
      `Unique NAPs extracted: ${uniqueCount.toLocaleString()}`,
      `Duplicates/errors removed: ${duplicatesRemoved}`,
      '',
      'COLUMN MAPPING',
      '-'.repeat(70),
    ];

    Object.entries(this.mapping).forEach(([stdCol, rawCol]) => {
      report.push(`${stdCol.padEnd(25)} ← ${rawCol}`);
    });

    if (this.unmapped.length > 0) {
      report.push('');
      report.push('Unmapped columns (left empty):');
      this.unmapped.forEach(col => report.push(`  - ${col}`));
    }

    fs.writeFileSync(reportFile, report.join('\n'));
    this.log(`✓ Report: ${reportFile}`);

    this.log('\n========================================');
    this.log('Processing Complete!');
    this.log('========================================\n');

    return {
      outputFile,
      reportFile,
      totalRows,
      uniqueRecords: uniqueCount,
      duplicatesRemoved
    };
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Universal NAP Data Processor');
    console.log('');
    console.log('Usage:');
    console.log('  node process-raw-nap-data.js <raw_file.csv> [output_directory]');
    console.log('');
    console.log('Examples:');
    console.log('  node process-raw-nap-data.js ~/Downloads/NAP_Facility_Summary_Report.csv');
    console.log('  node process-raw-nap-data.js raw-export.csv ~/Documents/NAP_Output');
    process.exit(0);
  }

  const rawFile = args[0];
  const outputDir = args[1] || path.dirname(rawFile);

  if (!fs.existsSync(rawFile)) {
    console.error(`Error: File not found: ${rawFile}`);
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const processor = new UniversalNAPProcessor();
  
  try {
    await processor.processRawFile(rawFile, outputDir);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { UniversalNAPProcessor };
