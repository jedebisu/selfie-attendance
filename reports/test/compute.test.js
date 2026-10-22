// Tests for reports/src/compute.js — the pure dashboard data model.
// Behavior mirrored from the FSM Apps Script (VALIDATION sheet, OUTPUT_HEADERS).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  parseSheetDate,
  normalizeWorkOrder,
  classifyWorkOrder,
  computeDashboard
} from '../src/compute.js';

// Fixture: a small VALIDATION export with messy real-world wrinkles —
// header whitespace/casing, lowercase values, quoted commas, a duplicate
// work order, an unclassifiable job order, a blank job order row, and
// mixed date formats. Column order matches OUTPUT_HEADERS.
const CSV_TEXT = [
  ' JOB ORDER ,RESULT,SUBSCRIBER,CUSTOMER ADDRESS,CUSTOMER CONTACT,PLAN AMOUNT,AREA,TERRITORY,FACILITY,STATUS,DATE APPS GEN,LAST UPDATE,AGENT CODE,AGENT NAME,CHANNEL',
  'gfp01234,found,"Dela Cruz, Maria","12 Rizal St., Project 4, Quezon City",09171234567,1299,quezon city,NCR-1,SM North Edsa,Completed,10/19/26,10/21/26,AGR-1013,"Reyes, Ana",FIELD SELLING',
  'GFP01234,FOUND,"Dela Cruz, Maria","12 Rizal St., Project 4, Quezon City",09171234567,1299,quezon city,NCR-1,SM North Edsa,Completed,10/19/26,10/21/26,AGR-1013,"Reyes, Ana",FIELD SELLING',
  'WQ-88213,FOUND,"Chua, Winston","17 San Rafael St., Pasig City",09178811223,1699,PASIG,NCR-3,Robinsons Galleria,ONGOING,10/20/26,10/21/26,,,',
  ',FOUND,"Orphan Row","1 Somewhere St., Caloocan",09170001122,999,CALOOCAN,NCR-2,Trinoma,Completed,10/19/26,10/21/26,,,',
  'GLS26091,NOT FOUND,,,,,,, ,,,,,,',
  '70211309,FOUND,"Reyes, Carlo","210 Aurora Blvd., Quezon City",09174567890,1299,Makati,NCR-1,Trinoma,Ongoing,10/20/26,10/20/26,AGR-2077,"Cruz, Pedro",ONLINE',
  'gfp01235,FOUND,"Villanueva, Marco","77 Kalayaan Ave., Quezon City",09175678901,1699,Pasig,NCR-3,SM Megamall,Completed,10/21/26,10/21/26,AGR-1013,"Reyes, Ana",FIELD SELLING',
  'GLS26092,FOUND,"Flores, Dennis","145J EDSA, Mandaluyong",09179012345,1699,Taguig,NCR-3,Market! Market!,"Completed ",10/22/26,10/22/26,AGR-2077,"Cruz, Pedro",ONLINE'
].join('\n');

test('parseCsv keeps quoted commas together', () => {
  const out = parseCsv(CSV_TEXT);
  assert.equal(out[1][2], 'Dela Cruz, Maria');
  assert.equal(out[1][3], '12 Rizal St., Project 4, Quezon City');
});

test('computeDashboard maps columns case-insensitively (messy headers)', () => {
  const result = computeDashboard(parseCsv(CSV_TEXT));
  // If header mapping failed, every count would be 0.
  assert.equal(result.checked, 7);
});

test('unclassified job orders are counted as checked/found but excluded from type totals', () => {
  const result = computeDashboard(parseCsv(CSV_TEXT));
  // WQ-88213 is FOUND but starts with neither GFP, GLS, nor 7.
  assert.equal(result.gfp, 3);
  assert.equal(result.gah, 2);
  assert.equal(result.total, 5);
  assert.equal(result.found, 6);
  assert.equal(result.notFound, 1);
  // status/area tallies must also exclude the unclassified row (ONGOING/quezon city etc.)
  const statusLabels = result.statusCount.map((entry) => entry.label);
  assert.ok(!statusLabels.includes('ONGOING'), 'unclassified row leaked into status tally');
});

test('blank job orders are excluded from checked', () => {
  const result = computeDashboard(parseCsv(CSV_TEXT));
  // 8 data rows, one has a blank JOB ORDER -> 7 checked.
  assert.equal(result.checked, 7);
  assert.ok(Math.abs(result.matchRate - 6 / 7) < 1e-9);
});

test('duplicate work orders are each counted', () => {
  const result = computeDashboard(parseCsv(CSV_TEXT));
  // GFP01234 appears twice (found), contributing 2 to gfp.
  assert.equal(result.gfp, 3);
});

test('breakdown tallies count FOUND, classified rows only', () => {
  const result = computeDashboard(parseCsv(CSV_TEXT));
  const byLabel = (list, label) => list.find((entry) => entry.label === label);
  assert.equal(byLabel(result.statusCount, 'Completed').count, 4);
  assert.equal(byLabel(result.statusCount, 'Ongoing').count, 1);
  assert.equal(byLabel(result.areaCount, 'quezon city').count, 2);
  assert.equal(byLabel(result.areaCount, 'Pasig').count, 1);
  assert.equal(result.statusCount[0].count, 4, 'lists sorted by count descending');
});

test('agents are grouped, sorted by total then name, and unclassified rows excluded', () => {
  const result = computeDashboard(parseCsv(CSV_TEXT));
  // AGR-1013 (Reyes, Ana): 3 GFP (rows 1, 2 and 7); AGR-2077 (Cruz, Pedro): 2 GAH.
  assert.equal(result.agents.length, 2);
  assert.deepEqual(result.agents[0], { agentCode: 'AGR-1013', agentName: 'Reyes, Ana', channel: 'FIELD SELLING', gfp: 3, gah: 0, total: 3 });
  assert.deepEqual(result.agents[1], { agentCode: 'AGR-2077', agentName: 'Cruz, Pedro', channel: 'ONLINE', gfp: 0, gah: 2, total: 2 });
});

test('agent totals tie-break alphabetically and same code groups across types', () => {
  const header = parseCsv(CSV_TEXT)[0];
  const zulu = ['GLS001', 'FOUND', '', '', '', '', 'Makati', '', '', 'Completed', '10/21/26', '10/20/26', 'AGR-999', 'Zulu, Zed', 'ONLINE'];
  const abel = ['GFP002', 'FOUND', '', '', '', '', 'Pasig', '', '', 'Completed', '10/21/26', '10/21/26', 'AGR-999', 'Abel, Ada', 'FIELD SELLING'];
  const result = computeDashboard([header, zulu, abel]);
  assert.equal(result.agents.length, 1, 'same agent code groups into one entry');
  // Faithful to the Apps Script: the first-seen row carries agentName; later
  // rows update only totals and a non-empty channel.
  assert.deepEqual(result.agents[0], { agentCode: 'AGR-999', agentName: 'Zulu, Zed', channel: 'FIELD SELLING', gfp: 1, gah: 1, total: 2 });
});

test('dataAsOf is the max LAST UPDATE date in the file', () => {
  const result = computeDashboard(parseCsv(CSV_TEXT));
  assert.equal(result.dataAsOf.getFullYear(), 2026);
  assert.equal(result.dataAsOf.getMonth(), 9);
  assert.equal(result.dataAsOf.getDate(), 22);
});

test('parseSheetDate handles M/D/YY', () => {
  const d = parseSheetDate('10/21/26');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 21);
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
});

test('parseSheetDate handles M/D/YYYY and ISO dates', () => {
  const mdyyyy = parseSheetDate('2/3/2026');
  assert.equal(mdyyyy.getFullYear(), 2026);
  assert.equal(mdyyyy.getMonth(), 1);
  assert.equal(mdyyyy.getDate(), 3);
  const iso = parseSheetDate('2026-10-21');
  assert.equal(iso.getFullYear(), 2026);
  assert.equal(iso.getMonth(), 9);
  assert.equal(iso.getDate(), 21);
});

test('parseSheetDate returns null for junk', () => {
  assert.equal(parseSheetDate('not a date'), null);
  assert.equal(parseSheetDate(''), null);
  assert.equal(parseSheetDate(undefined), null);
});

test('normalize + classify mirror the Apps Script rules', () => {
  assert.equal(normalizeWorkOrder('  gfp123 '), 'GFP123');
  assert.equal(normalizeWorkOrder(undefined), '');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('GLS26091')), 'GAH');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('7-abcdef')), 'GAH');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('GFP01234')), 'GFP');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('MOBILE-1')), '');
  assert.equal(classifyWorkOrder(''), '');
});
