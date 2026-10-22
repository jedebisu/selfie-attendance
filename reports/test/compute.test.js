// Tests for reports/src/compute.js — v2, target-driven (the CORRECT
// "Globe Broadband Performance Dashboard" Apps Script semantics):
//   - work orders are matched by trimmed-uppercase job order number
//   - classify: GFP* -> GFP, GLS*/7* -> GAH, else unclassified
//   - ACTUAL = rows with STATUS (trimmed, uppercased) === 'COMPLETED'
//   - NOT FOUND = RESULT === 'NOT FOUND'
//   - targets from per-BDE TARGETS tab; territory targets distributed
//     by each territory's share of completions; daily performance by
//     day-of-month of LAST UPDATE for completed rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCsv,
  parseSheetDate,
  normalizeWorkOrder,
  normalizeHeader,
  classifyWorkOrder,
  detectFeedType,
  computeDashboard,
  parseBdeTargets,
  parseBspbTargets,
  parseAgentPool
} from '../src/compute.js';

// ---------------- shared fixtures ----------------

const V_HEADERS =
  'JOB ORDER,RESULT,SUBSCRIBER,CUSTOMER ADDRESS,CUSTOMER CONTACT,PLAN AMOUNT,AREA,TERRITORY,FACILITY,STATUS,DATE APPS GEN,LAST UPDATE,AGENT CODE,AGENT NAME,CHANNEL';

const V_TEXT = [
  V_HEADERS,
  'GFP0101,FOUND,"Reyes, Ana","12 Rizal St., City",09171234567,1299,T1,TERR-1,FAC-1,Completed,10/03/26,10/05/26,AGT-001,"Reyes, Ana",EBISU STORE',
  'GLS0102,FOUND,"Lim, Grace","1 Park Ave",09171111111,1699,T1,TERR-1,FAC-1,ONGOING,10/03/26,10/10/26,AGT-001,"Reyes, Ana",EBISU STORE',
  '7099103,FOUND,"Cruz, Pablo","2 Sea Rd",09172222222,2499,T2,TERR-2,FAC-2,COMPLETED,10/08/26,10/10/26,AGT-002,"Cruz, Pablo",DIGITAL',
  'GFP0104,NOT FOUND,,,,,,,,,,,,',
  '   ,FOUND,"Orphan Row","1 Somewhere St.",09170001122,999,T1,TERR-1,FAC-1,Completed,10/19/26,10/21/26,,,',
  'WQ-9001,FOUND,"Chua, Winst","17 San Rafael St.",09178811223,1699,T1,TERR-1,FAC-1, completed ,10/14/26,10/20/26,,,',
  'GFP0105,FOUND,"Villa, Marco","77 Kalayaan Ave.",09175678901,1699,T2,TERR-2,FAC-2,Completed,10/25/26,10/28/26,AGT-001,"Reyes, Ana",EBISU STORE'
].join('\n');

const BDE_TARGETS_TEXT = [
  '"BDE","GFP TARGET","GAH TARGET","TOTAL"',
  '"ROXANNE","1,362","445","1,807"',
  '"KIRK","1,110","425","1,535"'
].join('\n');

const BBSP_TARGETS_TEXT = [
  '"BBSP","GFP TARGET","GAH TARGET","TOTAL TARGET"',
  '"STORE A","200","35","235"',
  '"STORE B","400","72","472"'
].join('\n');

const AGENT_POOL_TEXT = [
  '"BBSP","AGENT CODE","AGENT NAME","BDE"',
  '"STORE A","AGT-001","Reyes, Ana","ROXANNE"',
  '"STORE B","AGT-002","Cruz, Pablo","KIRK"'
].join('\n');

// ---------------- kept v1 mechanics pins ----------------

test('parseCsv keeps quoted commas together', () => {
  const out = parseCsv(V_TEXT);
  assert.equal(out[1][2], 'Reyes, Ana');
  assert.equal(out[1][3], '12 Rizal St., City');
});

test('parseCsv tolerates a UTF-8 BOM on the header row', () => {
  const out = parseCsv('\uFEFF' + V_TEXT);
  assert.equal(out[0][0], 'JOB ORDER');
});

test('computeDashboard maps columns case-insensitively (messy headers)', () => {
  const out = parseCsv(V_TEXT.replace('JOB ORDER', ' job order '));
  assert.equal(computeDashboard(out).kpis.totalOrders, 6);
});

test('parseSheetDate handles M/D/YY', () => {
  const d = parseSheetDate('10/21/26');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 21);
});

test('parseSheetDate returns null for junk', () => {
  assert.equal(parseSheetDate('not a date'), null);
  assert.equal(parseSheetDate(''), null);
});

test('normalize + classify mirror the Apps Script rules', () => {
  assert.equal(normalizeWorkOrder('  gfp123 '), 'GFP123');
  assert.equal(normalizeWorkOrder(undefined), '');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('GLS26091')), 'GAH');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('7-abcdef')), 'GAH');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('GFP-202609025OUQWN-2')), 'GFP');
  assert.equal(classifyWorkOrder(normalizeWorkOrder('MOBILE-1')), '');
  assert.equal(normalizeHeader('  AGENT CODE '), 'agentcode');
});

// ---------------- v2 pins (Review Focus) ----------------

test('ACTUAL counts only STATUS COMPLETED (mixed case tolerated), not FOUND rows', () => {
  const result = computeDashboard(parseCsv(V_TEXT));
  // completed: r1('Completed'), r3('COMPLETED'), r6(' completed '), r7('Completed')
  // NOT completed: r2(ONGOING), r4(NOT FOUND, blank status); blank job order row excluded
  assert.equal(result.kpis.actual, 4);
  assert.equal(result.kpis.totalOrders, 6);
  assert.equal(result.records.length, 6);
});

test('COMPLETED is independent of RESULT: unclassified WQ-9001 counts as actual', () => {
  const result = computeDashboard(parseCsv(V_TEXT));
  assert.equal(result.kpis.notFound, 1);
  // r2 is FOUND but ONGOING -> not actual. r4 NOT FOUND -> not actual.
  // 6 records: completed = r1, r3, r6 (unclassified still counts), r7 = 4.
  assert.equal(result.kpis.actual, 4);
});

test('comma-formatted targets parse ("1,362" -> 1362)', () => {
  const targets = parseBdeTargets(parseCsv(BDE_TARGETS_TEXT));
  assert.equal(targets.byBde.ROXANNE.total, 1807);
  assert.equal(targets.byBde.ROXANNE.gfp, 1362);
  assert.equal(targets.byBde.ROXANNE.gah, 445);
  assert.equal(targets.byBde.KIRK.total, 1535);
  assert.equal(targets.total, 3342);
});

test('TARGETS header variants: TOTAL and TARGET both accepted, missing total falls back', () => {
  const asTarget = parseBdeTargets(parseCsv('"BDE","GFP TARGET","GAH TARGET","TARGET"\n"X","10","20","30"'));
  assert.equal(asTotalaux(asTarget), 30);
  const asTotal = parseBdeTargets(parseCsv('"BDE","GFP TARGET","GAH TARGET","TOTAL"\n"X","10","20","30"'));
  assert.equal(asTotalaux(asTotal), 30);
  const noTotal = parseBdeTargets(parseCsv('"BDE","GFP TARGET","GAH TARGET"\n"X","10","20"'));
  assert.equal(asTotalaux(noTotal), 30, 'falls back to gfp+gah');
});
function asTotalaux(targets) {
  return Object.values(targets.byBde)[0].total;
}

test('BBSP TARGETS parse into a keyed map', () => {
  const bsp = parseBspbTargets(parseCsv(BBSP_TARGETS_TEXT));
  assert.deepEqual(bsp['STORE A'], { total: 235, gfp: 200, gah: 35 });
  assert.deepEqual(bsp['STORE B'], { total: 472, gfp: 400, gah: 72 });
});

test('AGENT POOL maps agent code AND normalized name to BBSP + BDE', () => {
  const pool = parseAgentPool(parseCsv(AGENT_POOL_TEXT));
  assert.deepEqual(pool.byAgent['AGT-001'], { bbsp: 'STORE A', bde: 'ROXANNE' });
  assert.deepEqual(pool.byAgent['reyes, ana'.toUpperCase()], { bbsp: 'STORE A', bde: 'ROXANNE' });
  assert.deepEqual(pool.byAgent['AGT-002'], { bbsp: 'STORE B', bde: 'KIRK' });
});

test('monthly target equals the sum of per-BDE totals and achievement is actual/target', () => {
  const result = computeDashboard(parseCsv(V_TEXT), {
    bdeTargets: parseBdeTargets(parseCsv(BDE_TARGETS_TEXT))
  });
  assert.equal(result.kpis.target, 3342);
  assert.equal(result.monthlyTarget.remaining, 3342 - 4);
  assert.ok(Math.abs(result.kpis.achievement - 4 / 3342) < 1e-12);
});

test('without targets fed, target panels degrade gracefully', () => {
  const result = computeDashboard(parseCsv(V_TEXT));
  assert.equal(result.kpis.target, 0);
  assert.equal(result.kpis.achievement, 0);
  assert.equal(result.monthlyTarget.remaining, 0);
});

test('territory performance: actual = completed per territory, target = share of monthly total', () => {
  const result = computeDashboard(parseCsv(V_TEXT), {
    bdeTargets: parseBdeTargets(parseCsv(BDE_TARGETS_TEXT))
  });
  // completed per territory: TERR-1 = r1 + r6 = 2, TERR-2 = r3 + r7 = 2
  const t1 = result.territoryPerformance.find((t) => t.territory === 'TERR-1');
  const t2 = result.territoryPerformance.find((t) => t.territory === 'TERR-2');
  assert.equal(t1.actual, 2);
  assert.equal(t2.actual, 2);
  // 3342 * (2/4) = 1671 each; shares must sum to the monthly total (+- rounding)
  assert.equal(Math.round(t1.target + t2.target) <= 3342 && Math.abs((t1.target + t2.target) - 3342) <= 2, true);
});

test('daily performance has one entry per day WITH completed data, keyed by day-of-month', () => {
  const result = computeDashboard(parseCsv(V_TEXT));
  // completed last updates: 10/05 (day 5), 10/10 (day 10), 10/20 (day 20), 10/28 (day 28)
  assert.deepEqual(result.dailyPerformance, [
    { day: '5', actual: 1 },
    { day: '10', actual: 1 },
    { day: '20', actual: 1 },
    { day: '28', actual: 1 }
  ]);
});

test('records carry BBSP + BDE matched via agent code then name (AGENT POOL wins as BDE source)', () => {
  const result = computeDashboard(parseCsv(V_TEXT), {
    agentPool: parseAgentPool(parseCsv(AGENT_POOL_TEXT))
  });
  const byJob = Object.fromEntries(result.records.map((r) => [r.jobOrder, r]));
  assert.equal(byJob['GFP0101'].bbsp, 'STORE A');
  assert.equal(byJob['GFP0101'].bde, 'ROXANNE');
  assert.equal(byJob['7099103'].bbsp, 'STORE B');
  assert.equal(byJob['7099103'].bde, 'KIRK');
  assert.equal(byJob['WQ-9001'].bbsp, '');
  assert.equal(byJob['WQ-9001'].bde, '');
});

test('per-BDE and per-BBSP actuals count completed rows matched through AGENT POOL', () => {
  const result = computeDashboard(parseCsv(V_TEXT), {
    agentPool: parseAgentPool(parseCsv(AGENT_POOL_TEXT))
  });
  // completed: r1(AGT-001->STORE A/ROXANNE), r3(AGT-002->STORE B/KIRK),
  //            r6(none), r7(AGT-001->STORE A/ROXANNE)
  assert.equal(result.bdeActuals.ROXANNE, 2);
  assert.equal(result.bdeActuals.KIRK, 1);
  assert.equal(result.bbspActuals['STORE A'], 2);
  assert.equal(result.bbspActuals['STORE B'], 1);
});

test('monthLabel and daysElapsed come from the data, not the wall clock', () => {
  const result = computeDashboard(parseCsv(V_TEXT));
  assert.equal(result.monthLabel, 'OCT 2026'); // max LAST UPDATE 10/28/26
  const asOf = result.dataAsOf;
  assert.equal(asOf.getFullYear(), 2026);
  assert.equal(asOf.getMonth(), 9);
  assert.equal(asOf.getDate(), 28);
  assert.equal(result.daysElapsed, 28);
  assert.ok(Math.abs(result.kpis.dailyAverage - 4 / 28) < 1e-12);
});

// ---------------- feed recognition (Task 8 pin) ----------------

test('detectFeedType classifies each tab shape and rejects unknown headers', () => {
  const norm = (row) => row.map(normalizeHeader);
  assert.equal(detectFeedType(norm(parseCsv(V_TEXT)[0])), 'validation');
  assert.equal(detectFeedType(norm(parseCsv(BDE_TARGETS_TEXT)[0])), 'bdeTargets');
  assert.equal(detectFeedType(norm(parseCsv(BBSP_TARGETS_TEXT)[0])), 'bspbTargets');
  assert.equal(detectFeedType(norm(parseCsv(AGENT_POOL_TEXT)[0])), 'agentPool');
  assert.equal(detectFeedType(['hello', 'world']), null);
  assert.equal(detectFeedType(norm(parseCsv('"BBSP","SOMETHING ELSE"\n"a","b"')[0])), null);
});

// ---------------- v3 pins: tech targets, DCOS, filters ----------------

const BDE = { bdeTargets: parseBdeTargets(parseCsv(BDE_TARGETS_TEXT)) };
const POOL = { agentPool: parseAgentPool(parseCsv(AGENT_POOL_TEXT)) };

test('tech actuals and scoped tech targets (GFP 2,472 · GAH 870 = 3,342)', () => {
  const result = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL });
  assert.equal(result.kpis.gfpActual, 2);        // r1 + r7
  assert.equal(result.kpis.gahActual, 1);        // r3 (7099…)
  assert.equal(result.kpis.gfpTarget, 2472);     // 1362 + 1110
  assert.equal(result.kpis.gahTarget, 870);      // 445 + 425
  assert.equal(result.kpis.target, 3342);
  assert.equal(result.kpis.actual, 4);           // includes unclassified r6
});

test('DCOS 1 = day 1–15 @ 60%, req daily 0 once the window has passed', () => {
  const r = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL });
  const w1 = r.dcos.find((w) => w.name === 'DCOS 1');
  const gfp = w1.rows.find((row) => row.tech === 'GFP');
  const gah = w1.rows.find((row) => row.tech === 'GAH');
  const grand = w1.rows.find((row) => row.tech === 'Grand Total');
  // completed in days 1-15: r1 GFP (10/05), r3 GAH (10/10)
  assert.equal(gfp.installed, 1);
  assert.equal(gah.installed, 1);
  assert.ok(Math.abs(gfp.target - 1483.2) < 1e-9);   // 2472 * 0.6
  assert.ok(Math.abs(gah.target - 522) < 1e-9);
  assert.ok(Math.abs(grand.target - 2005.2) < 1e-9);
  assert.ok(Math.abs(grand.variance - 2003.2) < 1e-9);
  // dataAsOf day 28 > window end 15 → 0 remaining days → req daily 0
  assert.equal(grand.reqDaily, 0);
});

test('DCOS 2 = day 16–31 @ 40% with working req-daily', () => {
  const r = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL });
  const w2 = r.dcos.find((w) => w.name === 'DCOS 2');
  const gfp = w2.rows.find((row) => row.tech === 'GFP');
  const grand = w2.rows.find((row) => row.tech === 'Grand Total');
  assert.equal(gfp.installed, 1);                // r7 (10/28)
  assert.ok(Math.abs(gfp.target - 988.8) < 1e-9); // 2472 * 0.4
  assert.equal(grand.installed, 2);              // r6 (10/20) + r7 (10/28)
  assert.ok(Math.abs(grand.target - 1336.8) < 1e-9);
  // remaining = 31 - 28 = 3 days; grand variance = 1336.8 - 2
  assert.ok(Math.abs(grand.reqDaily - (1336.8 - 2) / 3) < 1e-9);
});

test('MTD rows carry trend from the previous fed month (same filters), else null', () => {
  const noPrev = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL });
  assert.equal(noPrev.dcos.find((w) => w.name === 'MTD').rows.find((row) => row.tech === 'GFP').trend, null);

  const r2 = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL, prev: { kpis: { gfpActual: 298, gahActual: 0 } } });
  const mtd2 = r2.dcos.find((w) => w.name === 'MTD');
  assert.equal(mtd2.rows.find((row) => row.tech === 'GFP').trend, 298);
  assert.equal(mtd2.rows.find((row) => row.tech === 'GFP').trendAch, 298 / 2472);
  assert.equal(mtd2.rows.find((row) => row.tech === 'GAH').trend, 0);
});

test('MTD exposes GFP/GAH average daily (installed ÷ days elapsed)', () => {
  const r = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL });
  const mtd = r.dcos.find((w) => w.name === 'MTD');
  assert.ok(Math.abs(mtd.avgDaily.gfp - 2 / 28) < 1e-12);
  assert.ok(Math.abs(mtd.avgDaily.gah - 1 / 28) < 1e-12);
});

test('BDE filter re-scopes records and targets', () => {
  const r = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL }, { bde: 'KIRK' });
  assert.equal(r.records.length, 1);             // only r3 (AGT-002)
  assert.equal(r.kpis.actual, 1);
  assert.equal(r.kpis.gahActual, 1);
  assert.equal(r.kpis.gfpTarget, 1110);          // KIRK only
  assert.equal(r.kpis.gahTarget, 425);
  assert.equal(r.kpis.target, 1535);
});

test('TECH filter narrows target to that tech column', () => {
  const r = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL }, { tech: 'GAH' });
  assert.equal(r.kpis.actual, 1);
  assert.equal(r.kpis.target, 870);              // blended w/o BDE filter but tech GAH
});

test('BBSP filter uses the BBSP target row', () => {
  const r = computeDashboard(parseCsv(V_TEXT), {
    ...BDE, ...POOL, bspbTargets: parseBspbTargets(parseCsv(BBSP_TARGETS_TEXT))
  }, { bbsp: 'STORE A' });
  assert.equal(r.records.length, 3);             // r1 + r2(ongoing) + r7 — same agent
  assert.equal(r.kpis.actual, 2);
  assert.equal(r.kpis.target, 235);
  assert.equal(r.kpis.gfpTarget, 200);
});

test('search matches subscriber, territory, agent, and job order (case-insensitive)', () => {
  const bySub = computeDashboard(parseCsv(V_TEXT), { ...POOL }, { search: 'reyes, ana' });
  assert.equal(bySub.records.length, 3);         // r1, r2(Lim? no—'Reyes, Ana' agentname on r1,r2? r2 agent is AGT-001 too), r7
  const byTerritory = computeDashboard(parseCsv(V_TEXT), { ...POOL }, { search: 'terr-2' });
  assert.equal(byTerritory.records.length, 2);   // r3, r7
  const byJob = computeDashboard(parseCsv(V_TEXT), { ...POOL }, { search: 'wq-9001' });
  assert.equal(byJob.records.length, 1);
  assert.equal(byJob.records[0].jobOrder, 'WQ-9001');
});

test('agent productivity aggregates completed rows per agent with BBSP + BDE', () => {
  const r = computeDashboard(parseCsv(V_TEXT), { ...POOL });
  const reyes = r.agentProductivity.find((a) => a.agentCode === 'AGT-001');
  assert.equal(reyes.gfp, 2);
  assert.equal(reyes.total, 2);
  assert.equal(reyes.bbsp, 'STORE A');
  assert.equal(reyes.bde, 'ROXANNE');
  const cruz = r.agentProductivity.find((a) => a.agentCode === 'AGT-002');
  assert.equal(cruz.gah, 1);
  assert.equal(cruz.total, 1);
  assert.equal(r.agentProductivity.length, 2);   // agents with zero completions omitted
});

test('by-area performance distributes the scoped target by completion share', () => {
  const r = computeDashboard(parseCsv(V_TEXT), { ...BDE, ...POOL });
  const t1 = r.areaPerformance.find((a) => a.area === 'T1');
  const t2 = r.areaPerformance.find((a) => a.area === 'T2');
  assert.equal(t1.actual, 2);                    // r1 + r6
  assert.equal(t2.actual, 2);                    // r3 + r7
  assert.equal(Math.abs(t1.target - 1671) <= 1, true);
  assert.equal(Math.abs(t2.target - 1671) <= 1, true);
});
