#!/usr/bin/env python3
"""
Regenerate server/src/config/naps_export.csv.gz from a fresh
"NAP Facility Summary Report" CSV (semicolon-delimited).

Outputs the 17-column, comma-separated format that production auto-imports
via import-naps-production.js.

Usage: python3 regenerate-naps-export.py input.csv [output.csv.gz]

CSV input (semicolon-delimited, 19-24 columns):
  0: Location (parent NAP ID)
  1: NAP ID (with suffix A/B)
  2: Physical Status
  3: NAP Location (Indoor/Outdoor)
  4: Serving Building/Property/Tower
  5: Serving Floors
  6-11: NAP Address (split across cols, contains embedded semicolons)
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
  23: Ports Available

Output (17 columns, comma-separated, gzipped):
  nap_id, cabinet, location_type, building_served, floors_served,
  working_lines, vacant_lines, total_capacity, cfs_region, city_name,
  province_name, dp_nap_lat, dp_nap_long, naps_status, olt_id,
  sell_status, barangay_name
"""

import gzip
import re
import sys


def extract_from_address(address_parts):
    """Extract city, province, barangay from address fields."""
    full_address = ';'.join(address_parts)

    city = None
    city_match = re.search(r'City:\s*([^;"]+)', full_address, re.IGNORECASE)
    if city_match:
        city = city_match.group(1).strip().strip('"').strip()
        if city.startswith('CITY OF '):
            city = city[8:]
        if ',' in city:
            city = city.split(',')[0].strip()

    province = None
    state_match = re.search(r'State:\s*([^;"]+)', full_address, re.IGNORECASE)
    if state_match:
        province = state_match.group(1).strip().strip('"').strip()

    brgy = None
    brgy_match = re.search(r'BRGY\.?\s*([^;"]+)', full_address, re.IGNORECASE)
    if brgy_match:
        brgy = brgy_match.group(1).strip().strip('"').strip()

    return city, province, brgy


def clean_value(val, max_len=None):
    if not val:
        return ''
    val = val.strip().strip('"').strip()
    if val in ('null', '#N/A', 'None', ''):
        return ''
    if max_len and len(val) > max_len:
        val = val[:max_len]
    return val


def parse_int(val):
    if not val:
        return 0
    val = val.strip().replace(',', '')
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return 0


def parse_float(val):
    if not val:
        return ''
    val = val.strip().replace(',', '')
    try:
        f = float(val)
        return str(f) if f != 0 else ''
    except (ValueError, TypeError):
        return ''


HEADERS = [
    'nap_id', 'cabinet', 'location_type', 'building_served', 'floors_served',
    'working_lines', 'vacant_lines', 'total_capacity', 'cfs_region',
    'city_name', 'province_name', 'dp_nap_lat', 'dp_nap_long', 'naps_status',
    'olt_id', 'sell_status', 'barangay_name',
]


def main():
    if len(sys.argv) < 2:
        print('Usage: python3 regenerate-naps-export.py input.csv [output.csv.gz]')
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else 'naps_export.csv.gz'

    with open(input_path, 'r', encoding='utf-8-sig', errors='replace') as f:
        total_lines = sum(1 for _ in f)
    print(f'Total lines: {total_lines}')

    written = 0
    skipped = 0
    rows = {}

    with open(input_path, 'r', encoding='utf-8-sig', errors='replace') as fin:

        # Locate header row (report files have leading title rows)
        header_found = False
        for raw_line in fin:
            if 'NAP ID' in raw_line and 'Latitude' in raw_line:
                header_found = True
                break

        if not header_found:
            print('ERROR: could not find header row in input')
            sys.exit(1)

        for line_num, raw_line in enumerate(fin, start=1):
            row = raw_line.rstrip('\r\n').split(';')

            if len(row) < 19:
                skipped += 1
                continue

            nap_id = clean_value(row[1])
            if not nap_id:
                skipped += 1
                continue

            lat = parse_float(row[12])
            lng = parse_float(row[13])
            if not lat or not lng:
                skipped += 1
                continue

            try:
                lat_f = float(lat)
                lng_f = float(lng)
                if lat_f < 4 or lat_f > 21 or lng_f < 116 or lng_f > 127:
                    skipped += 1
                    continue
            except ValueError:
                skipped += 1
                continue

            if len(row) >= 24:
                address_parts = row[6:12]
            else:
                address_parts = [''] * 6

            city, province, brgy = extract_from_address(address_parts)
            province = province or ''

            fields = [
                nap_id,                                    # nap_id
                clean_value(row[17], 100),                 # cabinet (OLT Port)
                clean_value(row[3], 50),                   # location_type
                clean_value(row[4], 500),                  # building_served
                clean_value(row[5], 200),                  # floors_served
                str(parse_int(row[19])),                   # working_lines
                str(parse_int(row[23])),                   # vacant_lines
                str(parse_int(row[18])),                   # total_capacity
                province,                                  # cfs_region
                city[:100] if city else '',                # city_name
                province,                                  # province_name
                lat,                                       # dp_nap_lat
                lng,                                       # dp_nap_long
                clean_value(row[2], 50),                   # naps_status
                clean_value(row[16], 100),                 # olt_id
                '',                                        # sell_status
                brgy or '',                                # barangay_name
            ]

            # Deduplicate by nap_id, keeping the LAST occurrence
            rows[nap_id] = fields
            written += 1

            if written % 50000 == 0:
                print(f'  Progress: {written} rows scanned, {skipped} skipped...')

    with gzip.open(output_path, 'wt', encoding='utf-8', newline='') as fout:
        out_line = ','.join(HEADERS) + '\n'
        fout.write(out_line)
        for nap_id in rows:
            fields = rows[nap_id]
            quoted = []
            for val in fields:
                if ',' in val or '"' in val or '\n' in val:
                    val = '"' + val.replace('"', '""') + '"'
                quoted.append(val)
            fout.write(','.join(quoted) + '\n')

    print(f'\nDone!')
    print(f'  Written: {len(rows)} (unique nap_ids from {written} rows)')
    print(f'  Skipped: {skipped}')
    print(f'  Output: {output_path}')


if __name__ == '__main__':
    main()
