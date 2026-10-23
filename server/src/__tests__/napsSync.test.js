// Tests for the hash-gated naps:sync import (import-naps-update.js).
// Pure-function tests only — DB behavior is verified by running the script itself.

const {
  parseExport,
  columnsToAlter,
  upsertSqlFor,
  buildBatchUpsert,
} = require('../../scripts/import-naps-update');

describe('parseExport — 23-column naps_export.csv.gz', () => {
  const EXPORT_CSV = [
    'nap_id,cabinet,location_type,building_served,floors_served,working_lines,vacant_lines,total_capacity,cfs_region,city_name,province_name,dp_nap_lat,dp_nap_long,naps_status,olt_id,sell_status,barangay_name,ports_reserved,ports_defective,ports_contingency,discovered_when,customer_type,nap_address',
    'CEB_T1_N01A,GPON_OLT-1/1/15,Outdoor,BLDG,2,9,7,16,VIS,CEBU CITY,VIS,10.4,123.9,In Service,OLT_01,,CABANGAHAN,0,0,0,09-30-2025 04-16,,"ZipCode: ; State: VIS; City: CONCEPCION, TARLAC; Additional Address Information: CABANGAHAN RD."',
    'CEB_T1_N01B,GPON_OLT-1/1/15,Outdoor,BLDG,,0,0,16,VIS,CEBU CITY,VIS,10.5,123.8,In Service,OLT_01,,CABANGAHAN,,, ,, , ',
  ].join('\n');

  it('parses nap_address verbatim across commas inside a quoted field', () => {
    const rows = parseExport(EXPORT_CSV);
    expect(rows[0].nap_id).toBe('CEB_T1_N01A');
    expect(rows[0].nap_address).toContain('CONCEPCION, TARLAC');
    expect(rows[0].nap_address).toContain('Additional Address Information: CABANGAHAN RD.');
  });

  it('coerces port numbers to integers and empty ports to 0', () => {
    const rows = parseExport(EXPORT_CSV);
    expect(rows[0].working_lines).toBe(9);
    expect(rows[0].vacant_lines).toBe(7);
    expect(rows[0].ports_reserved).toBe(0);
    expect(rows[1].working_lines).toBe(0);
    expect(rows[1].ports_reserved).toBe('' ? 0 : 0); // blank columns → 0
    expect(typeof rows[1].ports_contingency).toBe('number');
  });

  it('keeps blank text fields as empty strings', () => {
    const rows = parseExport(EXPORT_CSV);
    expect(rows[1].customer_type).toBe('');
    expect(rows[1].discovered_when).toBe('');
  });
});

describe('header-driven absence — old 17-column export', () => {
  const OLD_CSV = [
    'nap_id,cabinet,location_type,building_served,floors_served,working_lines,vacant_lines,total_capacity,cfs_region,city_name,province_name,dp_nap_lat,dp_nap_long,naps_status,olt_id,sell_status,barangay_name',
    'OLD_T1_N01,GPON 0/1/6,Outdoor,B,,2,1,16,NCR,QUEZON CITY,NCR,14.6,121.1,In Service,OLT_01,,BATASAN HILLS',
  ].join('\n');

  it('omits the six new columns entirely so the upsert does not touch them', () => {
    const rows = parseExport(OLD_CSV);
    expect(rows[0].nap_id).toBe('OLD_T1_N01');
    expect(Object.keys(rows[0])).not.toContain('ports_reserved');
    expect(Object.keys(rows[0])).not.toContain('nap_address');
  });
});

describe('buildBatchUpsert — chunked multi-row statements', () => {
  it('numbers placeholders across rows and flattens values in column order', () => {
    const cols = ['nap_id', 'working_lines', 'nap_address'];
    const rows = [
      { nap_id: 'A', working_lines: 3, nap_address: 'x, y' },
      { nap_id: 'B', working_lines: undefined, nap_address: null },
    ];
    const { sql, values } = buildBatchUpsert(cols, rows);
    expect(sql).toContain('($1, $2, $3), ($4, $5, $6)');
    expect(values).toEqual([
      'A', 3, 'x, y',
      'B', null, null,
    ]);
    expect(sql).toContain('ON CONFLICT (nap_id) DO UPDATE SET');
    expect(sql).toContain('nap_address = EXCLUDED.nap_address');
  });

  it('max batch size keeps parameter count under the Postgres limit', () => {
    // 1000 rows x 23 cols = 23000 parameters < 65535
    const cols = Array.from({ length: 23 }, (_, i) => `c${i}`);
    const row = Object.fromEntries(cols.map((c) => [c, 1]));
    const { sql } = buildBatchUpsert(cols, Array(1000).fill(row));
    const params = sql.match(/\$\d+/g).length;
    expect(params).toBe(23000);
    expect(params).toBeLessThanOrEqual(65535);
  });
});

describe('columnsToAlter + upsertSqlFor', () => {
  it('ALTER statement lists all six new columns idempotently', () => {
    const sql = columnsToAlter();
    for (const name of ['ports_reserved', 'ports_defective', 'ports_contingency', 'discovered_when', 'customer_type', 'nap_address']) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${name}`);
    }
  });

  it('upsert SQL drives by nap_id and writes every mapped column', () => {
    const sql = upsertSqlFor(['nap_id', 'working_lines', 'ports_reserved']);
    expect(sql).toContain('INSERT INTO naps');
    expect(sql).toContain('ON CONFLICT (nap_id) DO UPDATE SET');
    expect(sql).toContain('working_lines = EXCLUDED.working_lines');
    expect(sql).toContain('ports_reserved = EXCLUDED.ports_reserved');
    expect(sql).toContain('updated_at = NOW()');
  });
});
