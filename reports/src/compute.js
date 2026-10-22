// Pure dashboard data model for EBISU Sales Report — v2, target-driven.
// Mirrors the CORRECT "Globe Broadband Performance Dashboard" Apps Script:
//   - VALIDATION rows (15 OUTPUT_HEADERS columns) are the records
//   - classify: GFP* -> GFP, GLS*/7* -> GAH, else unclassified
//   - ACTUAL = rows with STATUS (trimmed, uppercased) === 'COMPLETED'
//   - NOT FOUND = RESULT === 'NOT FOUND' (completed-ness is independent of result)
//   - monthly target = sum of per-BDE targets (TARGETS tab)
//   - territory targets = monthly target distributed by completion share
//   - daily performance = completions by day-of-month of LAST UPDATE
//   - per-record BBSP/BDE from the AGENT POOL tab (no separate BDE tab exists)
// Deliberate deviations (documented in the plan): monthLabel/daysElapsed come
// from the data (max LAST UPDATE), not the viewer's wall clock.
import Papa from 'papaparse';

export function normalizeHeader(header) {
  return String(header || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

export function normalizeWorkOrder(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function classifyWorkOrder(normalizedJobOrder) {
  const job = String(normalizedJobOrder ?? '');
  if (job.startsWith('GFP')) return 'GFP';
  if (job.startsWith('GLS') || job.startsWith('7')) return 'GAH';
  return '';
}

// Google Sheets displays dates as MM/dd/yy in this workbook. Accepts
// M/D/YY, M/D/YYYY, YYYY-MM-DD, and anything the JS Date constructor
// understands. Returns a local-midnight Date or null.
export function parseSheetDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
    const date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
    return isNaN(date.getTime()) ? null : date;
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function parseCsv(text) {
  const result = Papa.parse(String(text ?? ''), { skipEmptyLines: 'greedy' });
  return result.data;
}

/** "1,362" -> 1362; anything non-numeric becomes 0 (script parity). */
function numberFrom(value) {
  const cleaned = String(value ?? '').replace(/[^\d.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function firstPresent(colMap, names) {
  for (const name of names) {
    if (colMap[name] !== undefined) return colMap[name];
  }
  return undefined;
}

/** TARGETS tab rows -> { total, byBde: { [bde]: { total, gfp, gah } } }. */
export function parseBdeTargets(rows) {
  const result = { total: 0, byBde: {} };
  if (!Array.isArray(rows) || rows.length < 2) return result;

  const headers = rows[0].map(normalizeHeader);
  const col = {};
  headers.forEach((h, i) => { col[h] = i; });
  const gfpCol = col.gfptarget;
  const gahCol = col.gahtarget;
  const totalCol = firstPresent(col, ['target', 'totaltarget', 'total']);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const bde = String(row[0] || '').trim();
    if (!bde) continue;
    const gfp = gfpCol !== undefined ? numberFrom(row[gfpCol]) : 0;
    const gah = gahCol !== undefined ? numberFrom(row[gahCol]) : 0;
    let total = totalCol !== undefined ? numberFrom(row[totalCol]) : 0;
    if (total === 0 && gfp + gah > 0) total = gfp + gah;
    result.byBde[bde] = { total, gfp, gah };
    result.total += total;
  }
  return result;
}

/** BBSP TARGETS tab rows -> { [bbsp]: { total, gfp, gah } }. */
export function parseBspbTargets(rows) {
  const targets = {};
  if (!Array.isArray(rows) || rows.length < 2) return targets;

  const headers = rows[0].map(normalizeHeader);
  const col = {};
  headers.forEach((h, i) => { col[h] = i; });
  const gfpCol = firstPresent(col, ['gfptarget', 'gfp']);
  const gahCol = firstPresent(col, ['gahtarget', 'gah']);
  const totalCol = firstPresent(col, ['totaltarget', 'target', 'total']);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const bbsp = String(row[0] || '').trim();
    if (!bbsp) continue;
    const gfp = gfpCol !== undefined ? numberFrom(row[gfpCol]) : 0;
    const gah = gahCol !== undefined ? numberFrom(row[gahCol]) : 0;
    let total = totalCol !== undefined ? numberFrom(row[totalCol]) : 0;
    if (total === 0 && gfp + gah > 0) total = gfp + gah;
    targets[bbsp] = { total, gfp, gah };
  }
  return targets;
}

/**
 * AGENT POOL tab rows (BBSP | AGENT CODE | AGENT NAME | BDE) ->
 * one merged lookup keyed by agent code AND uppercased agent name,
 * each carrying { bbsp, bde }. (The script keeps two maps; merged is
 * equivalent for every consumer and easier to test.)
 */
export function parseAgentPool(rows) {
  const pool = { bbsps: [], byAgent: {}, bdes: [] };
  if (!Array.isArray(rows) || rows.length < 2) return pool;

  const headers = rows[0].map(normalizeHeader);
  const BDE_COL = headers.indexOf('bde');
  const bbspSet = {}, bdeSet = {};
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const bbsp = String(row[0] || '').trim();
    if (!bbsp) continue;
    const code = normalizeWorkOrder(row[1]);
    const name = String(row[2] || '').trim();
    const bde = BDE_COL === -1 ? '' : String(row[BDE_COL] || '').trim();
    if (bde) bdeSet[bde] = 1;
    bbspSet[bbsp] = 1;
    const entry = { bbsp, bde };
    if (code) pool.byAgent[code] = entry;
    if (name) pool.byAgent[name.toUpperCase()] = entry;
  }
  pool.bbsps = Object.keys(bbspSet).sort();
  pool.bdes = Object.keys(bdeSet).sort();
  return pool;
}

/**
 * Which feed is this? Takes a normalised HEADER ROW (array) and returns
 * 'validation' | 'bdeTargets' | 'bspbTargets' | 'agentPool' | null.
 * Used to route dragged files to the right store automatically.
 */
export function detectFeedType(headerRow) {
  const h = (Array.isArray(headerRow) ? headerRow : []).map(normalizeHeader);
  if (!h.length) return null;
  const has = (name) => h.includes(name);
  const first = h[0];

  if (has('joborder') && has('result')) return 'validation';
  if (first === 'bde' && (has('gfptarget') || has('gahtarget') || has('target'))) return 'bdeTargets';
  if (first === 'bbsp' && (has('gfptarget') || has('gahtarget'))) return 'bspbTargets';
  if (first === 'bbsp' && has('agentcode')) return 'agentPool';
  return null;
}

const COMPLETED_STATUS = 'COMPLETED';
const RESULT_NOT_FOUND = 'NOT FOUND';

/**
 * Build every figure the dashboard needs.
 * @param data String[][] — parsed VALIDATION CSV (header row + rows)
 * @param extras { bdeTargets, bspbTargets, agentPool } — optional parsed feeds
 */
export function computeDashboard(data, extras = {}) {
  const withTargets = extras.bdeTargets || parseBdeTargets([]);
  const target = withTargets.total;

  const monthLabelFor = (date) => date
    ? date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()
    : '';

  const blankResult = {
    monthLabel: '',
    dataAsOf: null,
    daysElapsed: 0,
    kpis: { totalOrders: 0, actual: 0, target, achievement: 0, dailyAverage: 0, notFound: 0 },
    monthlyTarget: { total: target, actual: 0, remaining: Math.max(target, 0) },
    bdeTargets: withTargets.byBde,
    bbspTargets: extras.bspbTargets || {},
    bdeActuals: {},
    bbspActuals: {},
    territoryPerformance: [],
    dailyPerformance: [],
    records: []
  };
  if (!Array.isArray(data) || data.length < 2) return blankResult;

  const headers = data[0].map(normalizeHeader);
  const idx = (name) => headers.indexOf(name);
  const JOB = idx('joborder');
  const RESULT = idx('result');
  if (JOB === -1) throw new Error('Missing JOB ORDER column in the VALIDATION CSV.');
  if (RESULT === -1) throw new Error('Missing RESULT column in the VALIDATION CSV.');
  const SUBSCRIBER = idx('subscriber');
  const ADDRESS = idx('customeraddress');
  const CONTACT = idx('customercontact');
  const PLAN = idx('planamount');
  const AREA = idx('area');
  const TERRITORY = idx('territory');
  const FACILITY = idx('facility');
  const STATUS = idx('status');
  const DATE_GEN = idx('dateappsgen');
  const LAST_UPDATE = idx('lastupdate');
  const AGENT_CODE = idx('agentcode');
  const AGENT_NAME = idx('agentname');
  const CHANNEL = idx('channel');

  const str = (row, index) => {
    const value = index === -1 ? undefined : row[index];
    return String(value ?? '').trim();
  };
  const pool = extras.agentPool || parseAgentPool([]);

  const records = [];
  let actual = 0, notFound = 0;
  let dataAsOf = null;
  const dayCount = {}, territoryActual = {}, bdeActuals = {}, bbspActuals = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const jobOrder = normalizeWorkOrder(row[JOB]);
    if (!jobOrder) continue;

    const status = str(row, STATUS);
    const result = str(row, RESULT).toUpperCase();
    const isCompleted = status.toUpperCase() === COMPLETED_STATUS;
    if (result === RESULT_NOT_FOUND) notFound++;

    const agentCode = str(row, AGENT_CODE);
    const agentName = str(row, AGENT_NAME);
    const poolEntry = pool.byAgent[agentCode] || (agentName ? pool.byAgent[agentName.toUpperCase()] : undefined);

    records.push({
      jobOrder,
      tech: classifyWorkOrder(jobOrder),
      result,
      subscriber: str(row, SUBSCRIBER),
      customerAddress: str(row, ADDRESS),
      customerContact: str(row, CONTACT),
      planAmount: str(row, PLAN),
      area: str(row, AREA),
      territory: str(row, TERRITORY),
      facility: str(row, FACILITY),
      status,
      dateAppsGen: str(row, DATE_GEN),
      lastUpdate: str(row, LAST_UPDATE),
      agentCode,
      agentName: agentName || agentCode,
      channel: str(row, CHANNEL),
      bbsp: poolEntry ? poolEntry.bbsp : '',
      bde: poolEntry ? poolEntry.bde : ''
    });

    const lastUpdate = parseSheetDate(LAST_UPDATE === -1 ? '' : row[LAST_UPDATE]);
    if (lastUpdate && (!dataAsOf || lastUpdate > dataAsOf)) dataAsOf = lastUpdate;

    if (isCompleted) {
      actual++;
      const territory = str(row, TERRITORY) || 'BLANK';
      territoryActual[territory] = (territoryActual[territory] || 0) + 1;
      if (lastUpdate) {
        const day = lastUpdate.getDate();
        dayCount[day] = (dayCount[day] || 0) + 1;
      }
      if (poolEntry) {
        const keyCode = agentCode || agentName.toUpperCase();
        const matched = pool.byAgent[keyCode] || (agentName ? pool.byAgent[agentName.toUpperCase()] : undefined);
        if (matched) {
          if (matched.bde) bdeActuals[matched.bde] = (bdeActuals[matched.bde] || 0) + 1;
          if (matched.bbsp) bbspActuals[matched.bbsp] = (bbspActuals[matched.bbsp] || 0) + 1;
        }
      }
    }
  }

  const daysElapsed = dataAsOf ? dataAsOf.getDate() : 0;
  const territoryPerformance = Object.keys(territoryActual)
    .map((t) => ({
      territory: t,
      actual: territoryActual[t],
      target: target > 0 ? Math.round(target * (territoryActual[t] / Math.max(actual, 1))) : 0
    }))
    .sort((a, b) => b.actual - a.actual);

  const dailyPerformance = [];
  for (let day = 1; day <= 31; day++) {
    if (dayCount[day]) dailyPerformance.push({ day: String(day), actual: dayCount[day] });
  }

  return {
    monthLabel: monthLabelFor(dataAsOf),
    dataAsOf,
    daysElapsed,
    kpis: {
      totalOrders: records.length,
      actual,
      target,
      achievement: target > 0 ? actual / target : 0,
      dailyAverage: daysElapsed > 0 ? actual / daysElapsed : 0,
      notFound
    },
    monthlyTarget: { total: target, actual, remaining: Math.max(target - actual, 0) },
    bdeTargets: withTargets.byBde,
    bbspTargets: extras.bspbTargets || {},
    bdeActuals,
    bbspActuals,
    territoryPerformance,
    dailyPerformance,
    records
  };
}
