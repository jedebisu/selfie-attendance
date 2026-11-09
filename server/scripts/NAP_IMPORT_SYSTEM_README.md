# NAP Data Import System

## Overview
Automated system to standardize and import NAP data from any raw export format into the EBISU database.

**Last Updated:** October 25, 2026

---

## Quick Start

### One-Command Import
Simply feed any raw NAP export file and the system will automatically standardize and upload it:

```bash
cd ~/selfie-attendance/server
./scripts/import-nap-data.sh ~/Downloads/NAP_Facility_Summary_Report.csv
```

That's it! The system will:
1. ✅ Auto-detect the file format and column structure
2. ✅ Standardize to reference format (17 columns)
3. ✅ Remove duplicate NAP IDs automatically
4. ✅ Upload clean data to database (UPSERT mode)
5. ✅ Regenerate map snapshot
6. ✅ Update mobile app data instantly

---

## What This System Does

### Intelligent Processing
- **Auto-detects** column names (handles variations like "NAP ID", "nap_id", "Facility ID")
- **Skips** report header rows automatically
- **Maps** columns intelligently to standard format
- **Removes** duplicates (keeps first occurrence)
- **Validates** coordinates and port counts
- **Archives** original files safely

### Standard Output Format
```
Location, NAP ID, Physical Status, Nap Location, Nap Address,
Latitude, Longitude, Discovered When, OLT ID, OLT Port,
Ports Total, Ports Assigned, Ports Reserved, Ports Defective,
Ports Contignency, Ports Available, %
```

### Supported Input Formats
- ✅ NAP Facility Summary Report (Globe export)
- ✅ Any CSV/semicolon-delimited file with NAP data
- ✅ Files with header rows (auto-skipped)
- ✅ Files with varying column names (auto-mapped)

---

## Step-by-Step Usage

### Option 1: Fully Automated (Recommended)
```bash
# One command does everything
./scripts/import-nap-data.sh ~/Downloads/your_raw_nap_file.csv
```

### Option 2: Manual Control

#### Step 1: Standardize Raw Data
```bash
node scripts/process-raw-nap-data.js ~/Downloads/raw_file.csv
```
**Output:** 
- `NAP_Standardized_YYYY-MM-DD_HH-MM-SS.csv`
- Processing report with column mappings

#### Step 2: Upload to Database
```bash
node scripts/upload-nap-data-safe.js path/to/standardized.csv --confirm
```
**What happens:**
- Inserts new NAPs
- Updates existing NAPs with fresh data
- Keeps NAPs not in the file (safe)
- Regenerates map snapshot automatically

---

## Files and Scripts

### Main Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `import-nap-data.sh` | One-command import | `./import-nap-data.sh <file>` |
| `process-raw-nap-data.js` | Standardize raw data | `node process-raw-nap-data.js <file>` |
| `upload-nap-data-safe.js` | Upload to database | `node upload-nap-data-safe.js <file> --confirm` |
| `remove-duplicate-naps.js` | Remove duplicates | `node remove-duplicate-naps.js <file>` |

### Helper Scripts

| Script | Purpose |
|--------|---------|
| `emit-nap-snapshot.js` | Regenerate map snapshot |

---

## How It Works

### 1. Column Detection
The system recognizes these column name variations:

```javascript
'NAP ID' → ['NAP ID', 'nap_id', 'NapID', 'ID', 'Facility ID']
'Latitude' → ['Latitude', 'lat', 'dp_nap_lat', 'Lat', 'Y']
'Ports Total' → ['Ports Total', 'Total Ports', 'total_capacity', 'Capacity']
// ... and more
```

### 2. Header Row Detection
Automatically skips report headers like:
```
NAP Facility Summary Report
Object: DataFlow
Specified Report Parameters
...
```

Finds the actual data starting with column headers.

### 3. Duplicate Handling
When multiple rows have the same NAP ID:
- **Keeps:** First occurrence
- **Removes:** Subsequent duplicates
- **Reports:** Which NAP IDs were duplicated

### 4. Database UPSERT
```sql
INSERT INTO naps (...)
VALUES (...)
ON CONFLICT (nap_id) DO UPDATE SET
  -- Updates all fields with new data
```

**Safe mode:** Existing NAPs not in your file are preserved.

---

## Output Files

### After Processing

**Standardized CSV:**
```
~/Downloads/NAP_Standardized_2026-10-25_09-26-10.csv
```
- Clean, deduplicated data
- Standard column order
- Ready for database upload

**Processing Report:**
```
~/Downloads/NAP_Standardized_2026-10-25_09-26-10_report.txt
```
Contains:
- Column mappings used
- Rows processed vs. unique NAPs
- Duplicates removed
- Validation issues

**Deduplication Report** (if duplicates found):
```
~/Downloads/NAP_Standardized_*_dedup_report.txt
```
Lists all duplicate NAP IDs and how many times they appeared.

### Archived Files
Original raw files are automatically copied to:
```
~/Documents/NAP_Archive/
```

---

## Database Impact

### What Gets Updated

**New NAPs** (INSERT):
- NAPs with IDs not in database

**Existing NAPs** (UPDATE):
- All field values refreshed with new data
- `updated_at` timestamp updated

**Preserved NAPs:**
- NAPs in database but not in your file remain unchanged

### Current Database Stats
As of October 25, 2026:
- **Total NAPs:** 321,643
- **Last import:** Standardized file with 321,620 unique NAPs
- **Database:** selfie_attendance (PostgreSQL)
- **API:** https://selfie-api-sqgh.onrender.com/api

---

## Mobile App Integration

### Automatic Updates
The EBISU T&A mobile app automatically uses the updated data:

**Affected Features:**
- ✅ NAP Search
- ✅ Nearest NAP lookup
- ✅ NAP details view
- ✅ Map markers and availability
- ✅ Port capacity data

**No app update required** - changes are immediate via API.

---

## Troubleshooting

### Issue: "Column not found"
**Solution:** The system auto-maps common variations. If a column isn't recognized, check the processing report to see what was mapped.

### Issue: "Duplicate NAP IDs"
**Solution:** This is normal! The system automatically keeps the first occurrence and removes duplicates. Check the dedup report for details.

### Issue: "Transaction rolled back"
**Solution:** Use `upload-nap-data-safe.js`. It handles duplicates properly with UPSERT.

### Issue: "File not processing"
**Checklist:**
1. Is it a CSV or semicolon-delimited file?
2. Does it contain NAP ID column?
3. Is the file at least 1 KB in size?
4. Check the first 10 rows manually

---

## Advanced Usage

### Custom Output Directory
```bash
node scripts/process-raw-nap-data.js input.csv ~/custom/output/dir
```

### Preview Before Upload
```bash
# Process but don't upload
node scripts/process-raw-nap-data.js input.csv

# Review the output, then upload manually
node scripts/upload-nap-data-safe.js output.csv --confirm
```

### Check What Will Change (Dry Run)
```bash
# Without --confirm flag, shows what would happen
node scripts/upload-nap-data-safe.js standardized.csv
```

---

## Reference Format

### Standard Columns (in order)

1. **Location** - Cabinet/site code (e.g., "CEB_062_L901_N01")
2. **NAP ID** - Unique identifier (e.g., "CEB_062_L901_N01A")
3. **Physical Status** - Operational state (e.g., "In Service", "Planned")
4. **Nap Location** - Indoor/Outdoor
5. **Nap Address** - Full structured address
6. **Latitude** - Decimal degrees
7. **Longitude** - Decimal degrees
8. **Discovered When** - Installation/discovery date
9. **OLT ID** - Optical Line Terminal ID
10. **OLT Port** - Port assignment
11. **Ports Total** - Total capacity
12. **Ports Assigned** - Currently in use
13. **Ports Reserved** - Reserved for future
14. **Ports Defective** - Faulty ports
15. **Ports Contignency** - Contingency ports
16. **Ports Available** - Free to assign
17. **%** - Status indicator

---

## Examples

### Example 1: Import Latest Export
```bash
cd ~/selfie-attendance/server
./scripts/import-nap-data.sh ~/Downloads/NAP\ Facility\ Summary\ Report-10-25-2026.csv
```

### Example 2: Process Multiple Files
```bash
for file in ~/Downloads/NAP*.csv; do
  ./scripts/import-nap-data.sh "$file"
done
```

### Example 3: Get Help
```bash
# Show usage
node scripts/process-raw-nap-data.js

# Show what the script does
./scripts/import-nap-data.sh
```

---

## System Requirements

### Dependencies (Already Installed)
- Node.js 14+
- PostgreSQL database
- npm packages:
  - `csv-parser`
  - `csv-writer`
  - `pg` (PostgreSQL client)
  - `dotenv`

### Environment Variables (.env)
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=selfie_attendance
DB_USER=your_user
DB_PASSWORD=your_password
```

---

## Safety Features

### Built-in Protections
- ✅ **Confirmation required** for database changes (--confirm flag)
- ✅ **Transaction rollback** on any error
- ✅ **Original files archived** (never deleted)
- ✅ **UPSERT mode** (safe updates, no data loss)
- ✅ **Duplicate detection** before upload
- ✅ **Validation reports** for review

### What Can't Go Wrong
- Original raw files are never modified
- Database changes are transactional (all-or-nothing)
- Existing NAPs not in your file are preserved
- All operations are logged with timestamps

---

## Support

### Log Files
Processing logs are automatically created in the same directory as output files.

### Database Check
```bash
# Count NAPs
node -e "require('dotenv').config(); const {Pool}=require('pg'); new Pool().query('SELECT COUNT(*) FROM naps').then(r=>console.log('NAPs:',r.rows[0].count)).finally(()=>process.exit())"

# Check latest updates
node -e "require('dotenv').config(); const {Pool}=require('pg'); new Pool().query('SELECT nap_id, updated_at FROM naps ORDER BY updated_at DESC LIMIT 5').then(r=>console.table(r.rows)).finally(()=>process.exit())"
```

### Manual Snapshot Regeneration
```bash
node scripts/emit-nap-snapshot.js
```

---

## Future Enhancements

Potential additions to the system:
- [ ] Web UI for drag-and-drop upload
- [ ] Email notifications when import completes
- [ ] Scheduled automatic imports from network location
- [ ] Data quality dashboard
- [ ] Export to Excel with charts
- [ ] Integration with other EBISU systems

---

## Changelog

### October 25, 2026
- ✅ Created universal NAP import system
- ✅ Intelligent column mapping
- ✅ Automatic duplicate removal
- ✅ One-command import script
- ✅ Safe UPSERT database upload
- ✅ Comprehensive documentation

---

**Questions?** Check the troubleshooting section or review the processing reports generated after each import.

**System Location:** `/Users/yanggee/selfie-attendance/server/scripts/`
