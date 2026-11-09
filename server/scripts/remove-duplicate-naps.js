#!/usr/bin/env node
/**
 * Remove duplicate NAP IDs from standardized CSV
 * Keeps the first occurrence of each NAP ID
 */

const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');

async function removeDuplicates(inputFile) {
  console.log('========================================');
  console.log('NAP CSV Duplicate Removal');
  console.log('========================================\n');
  
  console.log(`Input file: ${path.basename(inputFile)}`);
  
  const records = new Map();
  const duplicates = [];
  const dupCounts = {};
  let rowNumber = 0;
  let headers = null;
  
  // Read CSV
  await new Promise((resolve, reject) => {
    fs.createReadStream(inputFile)
      .pipe(csv())
      .on('headers', (h) => {
        headers = h;
      })
      .on('data', (row) => {
        rowNumber++;
        const napId = row['NAP ID']?.trim();
        
        if (!napId) {
          console.log(`  Warning: Row ${rowNumber} has no NAP ID, skipping`);
          return;
        }
        
        if (records.has(napId)) {
          duplicates.push({ row: rowNumber, napId });
          dupCounts[napId] = (dupCounts[napId] || 0) + 1;
        } else {
          records.set(napId, row);
        }
        
        if (rowNumber % 50000 === 0) {
          console.log(`  Processed ${rowNumber.toLocaleString()} rows...`);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });
  
  console.log(`\n✓ Read ${rowNumber.toLocaleString()} total rows`);
  console.log(`✓ Found ${records.size.toLocaleString()} unique NAP IDs`);
  
  if (duplicates.length > 0) {
    console.log(`⚠ Found ${duplicates.length} duplicate NAP IDs\n`);
    console.log('Duplicate NAP IDs (first 20):');
    
    // Count duplicates per NAP ID
    const dupCounts = {};
    duplicates.forEach(d => {
      dupCounts[d.napId] = (dupCounts[d.napId] || 0) + 1;
    });
    
    Object.entries(dupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .forEach(([napId, count]) => {
        console.log(`  ${napId.padEnd(30)} (${count + 1} occurrences, kept first)`);
      });
  } else {
    console.log('✓ No duplicates found!\n');
  }
  
  // Generate output filename
  const inputPath = path.parse(inputFile);
  const outputFile = path.join(
    inputPath.dir,
    `${inputPath.name}_deduped${inputPath.ext}`
  );
  
  // Write deduplicated CSV
  console.log(`\nWriting deduplicated CSV: ${path.basename(outputFile)}`);
  
  const csvWriter = createObjectCsvWriter({
    path: outputFile,
    header: headers.map(h => ({ id: h, title: h }))
  });
  
  await csvWriter.writeRecords(Array.from(records.values()));
  
  console.log(`✓ Wrote ${records.size.toLocaleString()} unique records`);
  
  // Create summary report
  const reportFile = outputFile.replace('.csv', '_dedup_report.txt');
  const report = [
    'NAP CSV DEDUPLICATION REPORT',
    '='.repeat(70),
    '',
    `Date: ${new Date().toISOString()}`,
    `Input: ${path.basename(inputFile)}`,
    `Output: ${path.basename(outputFile)}`,
    '',
    'SUMMARY',
    '-'.repeat(70),
    `Total rows in input: ${rowNumber.toLocaleString()}`,
    `Unique NAP IDs: ${records.size.toLocaleString()}`,
    `Duplicates removed: ${duplicates.length}`,
    '',
    'DUPLICATE NAP IDs',
    '-'.repeat(70),
  ];
  
  if (duplicates.length > 0) {
    Object.entries(dupCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([napId, count]) => {
        report.push(`${napId.padEnd(30)} ${count + 1} occurrences (kept 1st)`);
      });
  } else {
    report.push('None');
  }
  
  report.push('');
  report.push('='.repeat(70));
  report.push('Deduplication kept the FIRST occurrence of each NAP ID.');
  report.push('Original file was not modified.');
  
  fs.writeFileSync(reportFile, report.join('\n'));
  console.log(`✓ Report saved: ${path.basename(reportFile)}`);
  
  console.log('\n========================================');
  console.log('Deduplication Complete!');
  console.log('========================================\n');
  console.log(`Output file: ${outputFile}`);
  console.log(`Report file: ${reportFile}`);
  console.log('\nNext step: Upload the deduplicated file to database');
  console.log(`  node scripts/upload-nap-data-safe.js "${outputFile}" --confirm\n`);
  
  return {
    inputFile,
    outputFile,
    reportFile,
    totalRows: rowNumber,
    uniqueRecords: records.size,
    duplicatesRemoved: duplicates.length
  };
}

// Main
if (require.main === module) {
  const inputFile = process.argv[2];
  
  if (!inputFile) {
    console.log('Usage: node remove-duplicate-naps.js <input_csv>');
    console.log('');
    console.log('Example:');
    console.log('  node remove-duplicate-naps.js ~/Downloads/NAP_Standardized_*.csv');
    process.exit(1);
  }
  
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File not found: ${inputFile}`);
    process.exit(1);
  }
  
  removeDuplicates(inputFile).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { removeDuplicates };
