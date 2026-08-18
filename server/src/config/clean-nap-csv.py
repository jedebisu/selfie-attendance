#!/usr/bin/env python3
"""
Clean NAP Facility Summary Report CSV to match DEPLOYMENT.xlsx format.

Usage: python3 clean-nap-csv.py input.csv output.csv

CSV input (semicolon-delimited, 24 columns):
  0: Location (parent NAP ID)
  1: NAP ID (with suffix A/B)
  2: Physical Status
  3: NAP Location (Indoor/Outdoor)
  4: Serving Building/Property/Tower
  5: Serving Floors
  6-11: NAP Address (split across cols)
  12: Latitude
  13: Longitude
  14: Discovered When
  15: Customer Type
  16: OLT ID
  17: OLT Port (cabinet)
  18: Ports Total
  19: Ports Assigned
  20: Ports Reserved
  21: Ports Defective
  22: Ports Contingency
  23: Ports Available (with trailing commas)

Excel output (53 columns):
  0: TECH_2
  1: CABINET
  2: DP
  3: LOCATION_TYPE
  4: BULDING_SERVED
  5: FLOOR_SERVED
  6: DISTANCE_FROM_CABINET
  7: Working Lines
  8: Vacant Lines
  9: Total Capacity
  10: CFS_CLUSTER
  11: SUPER_VENDOR
  12: CFS_AREA
  13: CFS_REGION
  14: FO_LEAD
  15: FO_HEAD
  16: CFS_REGION_HEAD
  17: COM_DATE
  18: DP_LOCATION
  19: OLT_LOCATION
  20: SELL_STATUS
  21: REMARKS
  22: LOCATION_TAGGING
  23-27: AB, C1, C2, D, E
  28: TOTAL_DEMAND
  29: DOMINANT_SEC
  30: SALES_AREA
  31: SALES_AREA_NAME
  32: SALES_TERRITORY
  33: SALES_TERRITORY_NAME
  34: SALES_REGION
  35: BRGY_NAME
  36: CITY_NAME
  37: PROVINCE_NAME
  38: VENDOR_ID
  39: MDU_ID
  40: DEVELOPMENT_COMMON_ID
  41: DEVELOPER
  42: GOLD_CABINET
  43: BUILDING_NAME
  44: DP_NAP_LAT
  45: DP_NAP_LONG
  46: DISPOSITION
  47: Demand
  48: Sellable
  49: BARANGAY_PSGC
  50: PRIO_PER_TER
  51: DISPOSITION
  52: UTIL
"""

import csv
import re
import sys


def extract_from_address(address_parts):
    """Extract city, province, barangay from address fields."""
    full_address = ';'.join(address_parts)

    # Extract city
    city = None
    city_match = re.search(r'City:\s*([^;"]+)', full_address, re.IGNORECASE)
    if city_match:
        city = city_match.group(1).strip().strip('"').strip()
        # Handle "CITY OF X" format
        if city.startswith('CITY OF '):
            city = city[8:]
        # Some have trailing region: "CEBU CITY, CEBU"
        if ',' in city:
            city = city.split(',')[0].strip()

    # Extract province/state
    province = None
    state_match = re.search(r'State:\s*([^;"]+)', full_address, re.IGNORECASE)
    if state_match:
        province = state_match.group(1).strip().strip('"').strip()

    # Extract barangay from address
    brgy = None
    brgy_match = re.search(r'BRGY\.?\s*([^;"]+)', full_address, re.IGNORECASE)
    if brgy_match:
        brgy = brgy_match.group(1).strip().strip('"').strip()

    return city, province, brgy


def clean_value(val, max_len=None):
    """Clean a value: strip quotes, whitespace, truncate if needed."""
    if not val:
        return ''
    val = val.strip().strip('"').strip()
    if val in ('null', '#N/A', 'None', ''):
        return ''
    if max_len and len(val) > max_len:
        val = val[:max_len]
    return val


def parse_int(val):
    """Parse integer, return 0 if invalid."""
    if not val:
        return 0
    val = val.strip().replace(',', '')
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def parse_float(val):
    """Parse float, return empty string if invalid."""
    if not val:
        return ''
    val = val.strip().replace(',', '')
    try:
        f = float(val)
        return str(f) if f != 0 else ''
    except (ValueError, TypeError):
        return ''


def main():
    if len(sys.argv) < 3:
        print('Usage: python3 clean-nap-csv.py input.csv output.csv')
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    # Excel headers (53 columns)
    headers = [
        'TECH_2', 'CABINET', 'DP', 'LOCATION_TYPE', 'BULDING_SERVED',
        'FLOOR_SERVED', 'DISTANCE_FROM_CABINET', 'Working Lines', 'Vacant Lines',
        'Total Capacity', 'CFS_CLUSTER', 'SUPER_VENDOR', 'CFS_AREA', 'CFS_REGION',
        'FO_LEAD', 'FO_HEAD', 'CFS_REGION_HEAD', 'COM_DATE', 'DP_LOCATION',
        'OLT_LOCATION', 'SELL_STATUS', 'REMARKS', 'LOCATION_TAGGING',
        'AB', 'C1', 'C2', 'D', 'E', 'TOTAL_DEMAND', 'DOMINANT_SEC',
        'SALES_AREA', 'SALES_AREA_NAME', 'SALES_TERRITORY', 'SALES_TERRITORY_NAME',
        'SALES_REGION', 'BRGY_NAME', 'CITY_NAME', 'PROVINCE_NAME', 'VENDOR_ID',
        'MDU_ID', 'DEVELOPMENT_COMMON_ID', 'DEVELOPER', 'GOLD_CABINET',
        'BUILDING_NAME', 'DP_NAP_LAT', 'DP_NAP_LONG', 'DISPOSITION', 'Demand',
        'Sellable', 'BARANGAY_PSGC', 'PRIO_PER_TER', 'DISPOSITION', 'UTIL'
    ]

    print(f'Reading: {input_path}')
    
    # Count lines first
    with open(input_path, 'r', encoding='utf-8-sig') as f:
        total_lines = sum(1 for _ in f) - 1  # minus header
    print(f'Total data lines: {total_lines}')

    written = 0
    skipped = 0

    with open(input_path, 'r', encoding='utf-8-sig') as fin, \
         open(output_path, 'w', newline='', encoding='utf-8') as fout:
        
        writer = csv.writer(fout)
        
        # Write header
        writer.writerow(headers)
        
        # Skip header line
        next(fin)
        
        for line_num, raw_line in enumerate(fin, start=2):
            # Use raw semicolon split (not csv.reader) to handle address field correctly
            row = raw_line.rstrip('\r\n').split(';')
            
            # Handle both 19-col (no address) and 24-col (with address) rows
            if len(row) < 19:
                skipped += 1
                continue
            
            nap_id = clean_value(row[1])
            if not nap_id:
                skipped += 1
                continue

            lat = parse_float(row[12])
            lng = parse_float(row[13])
            
            # Skip if no coordinates
            if not lat or not lng:
                skipped += 1
                continue

            # Skip obviously invalid coordinates
            try:
                lat_f = float(lat)
                lng_f = float(lng)
                if lat_f < 4 or lat_f > 21 or lng_f < 116 or lng_f > 127:
                    skipped += 1
                    continue
            except ValueError:
                skipped += 1
                continue

            # Extract address from columns 6-11 if available (24-col format)
            # or use empty address for 19-col format
            if len(row) >= 24:
                address_parts = row[6:12]
            else:
                address_parts = [''] * 6
            
            city, province, brgy = extract_from_address(address_parts)
            
            # Build output row (53 columns matching DEPLOYMENT.xlsx)
            out_row = [
                clean_value(row[0]),           # 0: TECH_2 (Location)
                clean_value(row[17]),          # 1: CABINET (OLT Port)
                nap_id,                        # 2: DP (NAP ID)
                clean_value(row[3]),           # 3: LOCATION_TYPE
                clean_value(row[4]),           # 4: BULDING_SERVED
                clean_value(row[5]),           # 5: FLOOR_SERVED
                '',                            # 6: DISTANCE_FROM_CABINET (not in CSV)
                parse_int(row[19]),            # 7: Working Lines
                parse_int(row[23]),            # 8: Vacant Lines
                parse_int(row[18]),            # 9: Total Capacity
                '',                            # 10: CFS_CLUSTER
                '',                            # 11: SUPER_VENDOR
                '',                            # 12: CFS_AREA
                province or '',                # 13: CFS_REGION
                '',                            # 14: FO_LEAD
                '',                            # 15: FO_HEAD
                '',                            # 16: CFS_REGION_HEAD
                clean_value(row[14]),          # 17: COM_DATE
                '',                            # 18: DP_LOCATION
                clean_value(row[16]),          # 19: OLT_LOCATION
                clean_value(row[2]),           # 20: SELL_STATUS
                '',                            # 21: REMARKS
                '',                            # 22: LOCATION_TAGGING
                '',                            # 23: AB
                '',                            # 24: C1
                '',                            # 25: C2
                '',                            # 26: D
                '',                            # 27: E
                '',                            # 28: TOTAL_DEMAND
                '',                            # 29: DOMINANT_SEC
                '',                            # 30: SALES_AREA
                '',                            # 31: SALES_AREA_NAME
                '',                            # 32: SALES_TERRITORY
                '',                            # 33: SALES_TERRITORY_NAME
                '',                            # 34: SALES_REGION
                brgy or '',                    # 35: BRGY_NAME
                city or '',                    # 36: CITY_NAME
                province or '',                # 37: PROVINCE_NAME
                clean_value(row[15]),          # 38: VENDOR_ID (Customer Type)
                '',                            # 39: MDU_ID
                '',                            # 40: DEVELOPMENT_COMMON_ID
                '',                            # 41: DEVELOPER
                '',                            # 42: GOLD_CABINET
                clean_value(row[4]),           # 43: BUILDING_NAME
                lat,                           # 44: DP_NAP_LAT
                lng,                           # 45: DP_NAP_LONG
                '',                            # 46: DISPOSITION
                '',                            # 47: Demand
                '',                            # 48: Sellable
                '',                            # 49: BARANGAY_PSGC
                '',                            # 50: PRIO_PER_TER
                '',                            # 51: DISPOSITION
                '',                            # 52: UTIL
            ]
            
            writer.writerow(out_row)
            written += 1
            
            if written % 10000 == 0:
                print(f'  Progress: {written} written, {skipped} skipped...')

    print(f'\nDone!')
    print(f'  Written: {written}')
    print(f'  Skipped: {skipped}')
    print(f'  Output: {output_path}')


if __name__ == '__main__':
    main()
