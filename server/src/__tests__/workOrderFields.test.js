const {
  detectField,
  autoMapColumns,
  parseDate,
  dateOnly,
} = require('../utils/workOrderFields');
const { mapRows } = require('../utils/workOrderImport');

describe('work order field/date mapping (Date Dropdown fix)', () => {
  it('detects createdOn/updatedOn headers as date_created/last_updated', () => {
    expect(detectField('createdOn')).toBe('date_created');
    expect(detectField('updatedOn')).toBe('last_updated');
    expect(detectField('Created On')).toBe('date_created');
  });

  it('still refuses appointment alias collisions', () => {
    expect(detectField('appointmentid')).toBeNull();
    expect(detectField('ordercreatedate')).toBeNull();
    expect(detectField('lastupdatedate')).toBeNull();
    expect(detectField('appointmentdate')).toBe('appointment');
  });

  it('autoMaps a business-file header row', () => {
    const headers = ['Work Order Number', 'createdOn', 'updatedOn', 'appointment', 'cabinetId'];
    const mapping = autoMapColumns(headers);
    expect(mapping['1']).toBe('date_created');
    expect(mapping['2']).toBe('last_updated');
    expect(mapping['3']).toBe('appointment');
  });

  it('parses MM-DD-YYYY with time into the written calendar date (no TZ drift)', () => {
    expect(parseDate('10-10-2026 15:47:46')).toBe('2026-10-10 15:47:46');
    expect(parseDate('10-10-2026')).toBe('2026-10-10 00:00:00');
  });

  it('parses naive ISO datetimes as written calendar dates', () => {
    expect(parseDate('2026-10-10 15:47:46')).toBe('2026-10-10 15:47:46');
    expect(parseDate('2026-10-10T15:47:46')).toBe('2026-10-10 15:47:46');
  });

  it('converts explicit-timezone strings to that offset wall-clock', () => {
    expect(parseDate('2026-10-10T15:47:46Z')).toBe('2026-10-10 15:47:46');
    expect(parseDate('2026-10-10T07:47:46+08:00')).toBe('2026-10-10 07:47:46');
    expect(parseDate('2026-10-09T23:47:46+08:00')).toBe('2026-10-09 23:47:46');
  });

  it('rejects invalid times', () => {
    expect(parseDate('10-10-2026 25:00:00')).toBeNull();
  });

  it('coerces appointment as date-only strings', () => {
    expect(dateOnly('10-10-2026 08:00:00')).toBe('2026-10-10');
  });

  it('maps rows end-to-end so createdOn feeds date_created, not extras', () => {
    const headers = ['Work Order Number', 'createdOn', 'updatedOn', 'appointment'];
    const mapping = autoMapColumns(headers);
    const rawRows = [
      {
        rowNumber: 2,
        cells: {
          0: 'GFP-20261010TEST01-2',
          1: '10-10-2026 15:47:46',
          2: '10-10-2026 16:28:29',
          3: '10-10-2026 08:00:00',
        },
      },
    ];
    const out = mapRows(headers, rawRows, mapping);
    expect(out).toHaveLength(1);
    expect(out[0].data.date_created).toBe('10-10-2026 15:47:46');
    expect(out[0].data.last_updated).toBe('10-10-2026 16:28:29');
    expect(out[0].data.appointment).toBe('10-10-2026 08:00:00');
    expect(out[0].extras.createdOn).toBeUndefined();
    expect(out[0].extras.updatedOn).toBeUndefined();
  });
});