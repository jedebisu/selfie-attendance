#!/bin/bash
# One-command NAP Database update.
#
# Usage:
#   bash update-nap-database.sh "/path/to/NAP Facility Summary Report-MON-DD-YYYY HH-MM.csv"
#
# Steps performed:
#   1. Regenerate server/src/config/naps_export.csv.gz from the report file
#      and stamp the report date (from the file name) into nap_report_date.txt
#   2. Commit + push to GitHub (the live server then serves the new date)
#   3. Upsert the NAP data into the Supabase database (safe, add/update only)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CSV="${1:-}"
PSQL=/opt/homebrew/bin/psql

if [ -z "$CSV" ]; then
  echo "ERROR: missing report file."
  echo "Usage: bash update-nap-database.sh \"/path/to/NAP Facility Summary Report-09-20-2026 14-22.csv\""
  exit 1
fi

if [ ! -f "$CSV" ]; then
  echo "ERROR: file not found: $CSV"
  exit 1
fi

echo "==> Step 1/3: regenerating naps_export.csv.gz and stamping report date..."
cd "$SCRIPT_DIR"
python3 server/src/config/regenerate-naps-export.py "$CSV" server/src/config/naps_export.csv.gz || exit 1
cd "$SCRIPT_DIR"

echo ""
echo "==> Step 2/3: committing and pushing to GitHub (server auto-redeploys the new date)..."
cd "$SCRIPT_DIR"
git add server/src/config/naps_export.csv.gz server/src/config/nap_report_date.txt
git commit -m "Update NAP database from new facility report" || echo "  (nothing to commit — report unchanged?)"
git push origin main || exit 1

echo ""
echo "==> Step 3/3: syncing NAP data into Supabase (upsert, add/update only)..."
cd "$SCRIPT_DIR/server"

DB_URL="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL not found in server/.env"
  exit 1
fi

gunzip -c src/config/naps_export.csv.gz > /tmp/nap_import.csv || exit 1

echo "  Preparing staging table..."
"$PSQL" "$DB_URL" > /tmp/nap_import_step1.log 2>&1 <<'SQL' || { echo "ERROR loading stage (see /tmp/nap_import_step1.log)"; exit 1; }
SET statement_timeout = 0;
DROP TABLE IF EXISTS nap_stage;
CREATE TABLE nap_stage (
  nap_id text, cabinet text, location_type text, building_served text,
  floors_served text, working_lines integer, vacant_lines integer,
  total_capacity integer, cfs_region text, city_name text, province_name text,
  dp_nap_lat numeric, dp_nap_long numeric, naps_status text, olt_id text,
  sell_status text, barangay_name text
);
\copy nap_stage (nap_id, cabinet, location_type, building_served, floors_served, working_lines, vacant_lines, total_capacity, cfs_region, city_name, province_name, dp_nap_lat, dp_nap_long, naps_status, olt_id, sell_status, barangay_name) FROM '/tmp/nap_import.csv' WITH (FORMAT csv, HEADER true);
CREATE INDEX nap_stage_nap_id_idx ON nap_stage (nap_id);
SELECT 'stage_rows=' || COUNT(*) FROM nap_stage;
SQL

TOTAL="$(cd "$SCRIPT_DIR/server" && "$PSQL" -A "$DB_URL" -c "SELECT COUNT(*) FROM nap_stage;" 2>/dev/null | head -1 | tr -d '[:space:]')"
echo "  Source rows: ${TOTAL:-0}"

BEFORE="$(cd "$SCRIPT_DIR/server" && "$PSQL" -A "$DB_URL" -c "SELECT COUNT(*) FROM naps;" 2>/dev/null | head -1 | tr -d '[:space:]')"
echo "  naps rows before: ${BEFORE:-0}"

echo "  Widening barangay column (safe if already done)..."
"$PSQL" "$DB_URL" > /dev/null 2>&1 <<'SQL' || echo "  (note: ALTER skipped)"
ALTER TABLE naps ALTER COLUMN barangay_name TYPE varchar(255);
SQL

echo "  Upserting data (one pass, add/update only)..."
"$PSQL" "$DB_URL" > /tmp/nap_import_upsert.log 2>&1 <<'SQL' || { echo "ERROR upserting (see /tmp/nap_import_upsert.log)"; exit 1; }
SET statement_timeout = 0;
INSERT INTO naps (nap_id, cabinet, location_type, building_served, floors_served,
  working_lines, vacant_lines, total_capacity, cfs_region, city_name, province_name,
  dp_nap_lat, dp_nap_long, naps_status, olt_id, sell_status, barangay_name)
SELECT nap_id, cabinet, location_type, building_served, floors_served,
  working_lines, vacant_lines, total_capacity, cfs_region, city_name, province_name,
  dp_nap_lat, dp_nap_long, naps_status, olt_id, sell_status, barangay_name
FROM nap_stage
ON CONFLICT (nap_id) DO UPDATE SET
  cabinet = EXCLUDED.cabinet, location_type = EXCLUDED.location_type,
  building_served = EXCLUDED.building_served, floors_served = EXCLUDED.floors_served,
  working_lines = EXCLUDED.working_lines, vacant_lines = EXCLUDED.vacant_lines,
  total_capacity = EXCLUDED.total_capacity, cfs_region = EXCLUDED.cfs_region,
  city_name = EXCLUDED.city_name, province_name = EXCLUDED.province_name,
  dp_nap_lat = EXCLUDED.dp_nap_lat, dp_nap_long = EXCLUDED.dp_nap_long,
  naps_status = EXCLUDED.naps_status, olt_id = EXCLUDED.olt_id,
  sell_status = EXCLUDED.sell_status, barangay_name = EXCLUDED.barangay_name,
  updated_at = NOW();
DROP TABLE IF EXISTS nap_stage;
SQL

AFTER="$(cd "$SCRIPT_DIR/server" && "$PSQL" -A "$DB_URL" -c "SELECT COUNT(*) FROM naps;" 2>/dev/null | head -1 | tr -d '[:space:]')"
echo "  naps rows after:  ${AFTER:-0}"

echo ""
echo "======================================"
echo " DONE. New report date was stamped:"
cat src/config/nap_report_date.txt
echo "======================================"