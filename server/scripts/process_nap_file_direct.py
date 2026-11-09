#!/usr/bin/env python3
"""
Direct NAP File Processor
Processes the NAP Facility Summary Report CSV and uploads to database
"""

import csv
import sys
import psycopg2
from datetime import datetime
import re

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'selfie_attendance',
    'user': 'your_user',  # Replace with your actual DB user
    'password': 'your_password'  # Replace with your actual DB password
}

# Standard column mapping
STANDARD_COLUMNS = [
    'Location', 'NAP ID', 'Physical Status', 'Nap Location', 'Nap Address',
    'Latitude', 'Longitude', 'Discovered When', 'OLT ID', 'OLT Port',
    'Ports Total', 'Ports Assigned', 'Ports Reserved', 'Ports Defective',
    'Ports Contignency', 'Ports Available', '%'
]

# Column mapping from source to standard
COLUMN_MAPPING = {
    'Location': 'Location',
    'NAP ID': 'NAP ID',
    'Physical Status': 'Physical Status',
    'Nap Location': ' NAP Location',
    'Nap Address': 'NAP Address',
    'Latitude': 'Latitude',
    'Longitude': 'Longitude',
    'Discovered When': 'Discovered When',
    'OLT ID': 'OLT ID',
    'OLT Port': 'OLT Port',
    'Ports Total': 'Ports Total',
    'Ports Assigned': 'Ports Assigned',
    'Ports Reserved': 'Ports Reserved',
    'Ports Defective': 'Ports Defective',
    'Ports Contingency': 'Ports Contingency',
    'Ports Available': 'Ports Available'
}

def parse_address(address_field):
    """Extract address components from the structured field"""
    parts = {
        'state': '',
        'city': '',
        'barangay': ''
    }
    
    if not address_field:
        return parts
    
    # Extract State
    state_match = re.search(r'State:\s*([^;]+)', address_field, re.IGNORECASE)
    if state_match:
        parts['state'] = state_match.group(1).strip()
    
    # Extract City
    city_match = re.search(r'City:\s*([^;]+)', address_field, re.IGNORECASE)
    if city_match:
        parts['city'] = city_match.group(1).strip()
    
    # Extract Barangay
    barangay_match = re.search(r'(?:BRGY\.|BARANGAY)\s*([^;,]+)', address_field, re.IGNORECASE)
    if barangay_match:
        parts['barangay'] = barangay_match.group(1).strip()
    
    return parts

def map_row_to_database(row):
    """Map a row from the source format to database format"""
    # Map columns
    mapped = {}
    for std_col, src_col in COLUMN_MAPPING.items():
        if src_col in row:
            mapped[std_col] = row[src_col]
        else:
            mapped[std_col] = ''
    
    # Parse address
    address_parts = parse_address(mapped['Nap Address'])
    
    # Calculate port values
    ports_total = int(mapped['Ports Total']) if mapped['Ports Total'] else 0
    ports_assigned = int(mapped['Ports Assigned']) if mapped['Ports Assigned'] else 0
    ports_available = int(mapped['Ports Available']) if mapped['Ports Available'] else 0
    
    # Prepare database record
    db_record = {
        'nap_id': mapped['NAP ID'],
        'cabinet': mapped['Location'],
        'location_type': mapped['Nap Location'],
        'building_served': None,
        'floors_served': None,
        'working_lines': ports_assigned,
        'vacant_lines': ports_available,
        'total_capacity': ports_total,
        'cfs_region': address_parts['state'],
        'city_name': address_parts['city'],
        'province_name': address_parts['state'],  # Using state as province
        'dp_nap_lat': float(mapped['Latitude']) if mapped['Latitude'] else None,
        'dp_nap_long': float(mapped['Longitude']) if mapped['Longitude'] else None,
        'naps_status': mapped['Physical Status'],
        'olt_id': mapped['OLT ID'],
        'sell_status': None,
        'barangay_name': address_parts['barangay']
    }
    
    return db_record

def process_file(input_file):
    """Process the NAP file and return records ready for database"""
    print(f"Processing file: {input_file}")
    
    # Read CSV
    with open(input_file, 'r', encoding='utf-8-sig') as f:
        # Skip header rows
        for _ in range(5):  # Skip 5 header rows
            next(f)
        
        # Read data
        reader = csv.DictReader(f, delimiter=';')
        records = []
        duplicates = set()
        errors = []
        
        for row_num, row in enumerate(reader, start=1):
            try:
                # Map to database format
                db_record = map_row_to_database(row)
                
                # Check for duplicates
                if db_record['nap_id'] in duplicates:
                    errors.append(f"Duplicate NAP ID at row {row_num}: {db_record['nap_id']}")
                    continue
                
                duplicates.add(db_record['nap_id'])
                records.append(db_record)
                
                if row_num % 10000 == 0:
                    print(f"  Processed {row_num} rows...")
            except Exception as e:
                errors.append(f"Error at row {row_num}: {str(e)}")
                continue
    
    print(f"\n✓ Processed {len(records)} records")
    if errors:
        print(f"⚠ {len(errors)} errors encountered")
    
    return records, errors

def upload_to_database(records):
    """Upload records to database"""
    print("\nUploading to database...")
    
    try:
        # Connect to database
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        # Start transaction
        cursor.execute("BEGIN")
        
        # Count existing records
        cursor.execute("SELECT COUNT(*) FROM naps")
        existing_count = cursor.fetchone()[0]
        print(f"Existing NAPs in database: {existing_count}")
        
        # Prepare UPSERT query
        upsert_query = """
        INSERT INTO naps (
            nap_id, cabinet, location_type, building_served, floors_served,
            working_lines, vacant_lines, total_capacity, cfs_region, city_name,
            province_name, dp_nap_lat, dp_nap_long, naps_status, olt_id,
            sell_status, barangay_name, updated_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, NOW()
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
        """
        
        # Upload records in batches
        inserted = 0
        updated = 0
        failed = 0
        
        for record in records:
            try:
                cursor.execute(upsert_query, (
                    record['nap_id'], record['cabinet'], record['location_type'],
                    record['building_served'], record['floors_served'],
                    record['working_lines'], record['vacant_lines'], record['total_capacity'],
                    record['cfs_region'], record['city_name'], record['province_name'],
                    record['dp_nap_lat'], record['dp_nap_long'], record['naps_status'],
                    record['olt_id'], record['sell_status'], record['barangay_name']
                ))
                
                # Check if it was inserted or updated
                if cursor.rowcount > 0:
                    inserted += 1
                else:
                    updated += 1
                
                if (inserted + updated) % 10000 == 0:
                    print(f"  Processed {inserted + updated} records...")
            except Exception as e:
                print(f"Error uploading record {record['nap_id']}: {str(e)}")
                failed += 1
        
        # Commit transaction
        conn.commit()
        
        # Get final count
        cursor.execute("SELECT COUNT(*) FROM naps")
        final_count = cursor.fetchone()[0]
        
        print(f"\n✓ Upload complete")
        print(f"✓ Inserted {inserted} new records")
        print(f"✓ Updated {updated} existing records")
        print(f"✓ Failed {failed} records")
        print(f"✓ Final NAP count: {final_count}")
        
        # Show summary by region
        cursor.execute("""
        SELECT cfs_region, COUNT(*)::int as count
        FROM naps
        WHERE cfs_region IS NOT NULL AND cfs_region != ''
        GROUP BY cfs_region
        ORDER BY count DESC
        LIMIT 15
        """
        )
        
        print("\nTop 15 Regions:")
        for row in cursor.fetchall():
            print(f"  {row[0].ljust(30)} {row[1]:,}")
        
        # Close connection
        cursor.close()
        conn.close()
        
        return True
        
    except Exception as e:
        print(f"Database error: {str(e)}")
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python process_nap_file_direct.py <input_file.csv>")
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    if not os.path.exists(input_file):
        print(f"Error: File not found: {input_file}")
        sys.exit(1)
    
    # Process file
    records, errors = process_file(input_file)
    
    if errors:
        print("\nErrors encountered:")
        for error in errors[:10]:  # Show first 10 errors
            print(f"  - {error}")
        if len(errors) > 10:
            print(f"  - ... and {len(errors)-10} more")
    
    # Upload to database
    if records:
        success = upload_to_database(records)
        if success:
            print("\n✅ Success! Database updated with new NAP data.")
        else:
            print("\n❌ Database upload failed.")
    else:
        print("\n❌ No records to upload.")

if __name__ == "__main__":
    import os
    main()
