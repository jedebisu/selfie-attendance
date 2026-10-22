// Pure dashboard data model for EBISU Sales Report — v3, target-driven,
// mirroring the DEPLOYED Apps Script implementation (T6A-style layout):
//   - VALIDATION rows (15 OUTPUT_HEADERS columns) are the records
//   - classify: GFP* -> GFP, GLS*/7* -> GAH, else unclassified
//   - ACTUAL = rows with STATUS (trimmed, uppercased) === 'COMPLETED'
//   - NOT FOUND = RESULT === 'NOT FOUND' (completed-ness is independent of result)
//   - monthly target = sum of per-BDE targets (TARGETS tab), split per tech
//   - DCOS windows: day 1–15 @ 60% / day 16–31 @ 40% / MTD @ 100%
//   - Req Daily = variance ÷ remaining window days (0 once the window passed)
//   - Trend (vol) = previous fed month's COMPLETED count for that tech;
//     Trend Ach = trend ÷ this row's target (— when no previous month fed)
//   - global filters (BDE / BBSP / TECH / search) re-slice records AND targets
//   - per-record BBSP/BDE from the AGENT POOL tab (no separate BDE tab exists)
// Deliberate deviations (documented in the plan): monthLabel/daysElapsed come
// from the data (max LAST UPDATE), not the viewer's wall clock. Grand Total
// rows count ALL completed work orders (incl. unclassified), so MTD reconciles
// with the KPI cards.
import Papa from 'papaparse';

// Monday-Sunday calendar weeks across one month, partial first/last weeks
// clamped to the real month end. A 30-day month starting Tuesday yields
// day counts 6,7,7,7,3 (the deployed sheet's Days row).
export function calendarWeeks(date) {
  if (!date) return [];
  const year = date.getFullYear();
  const month = date.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const count = Math.ceil((offset + daysInMonth) / 7);
  const weeks = [];
  for (let n = 0; n < count; n++) {
    const anchoredStart = n * 7 - offset + 1;
    const start = Math.max(1, anchoredStart);
    const end = Math.min(anchoredStart + 6, daysInMonth);
    weeks.push({ week: `WK${n + 1}`, start, end, days: end - start + 1 });
  }
  return weeks;
}

// Relative change as a fraction of the base; null when there is no usable
// base (missing or zero) so the render layer shows "—" instead of Infinity.
// Single helper covers both the weekly "vs Last Week" chips (average daily
// vs previous week / LM rate) and any other relative change in the app.
export function pctChange(current, previous) {
  return previous > 0 ? (current - previous) / previous : null;
}

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

// Deployed-script windows: DCOS 1 = first half at 60%, DCOS 2 = rest at 40%.
const DCOS_WINDOWS = [
  { name: 'DCOS 1', startDay: 1, endDay: 15, share: 0.6 },
  { name: 'DCOS 2', startDay: 16, endDay: 31, share: 0.4 }
];
const MTD_WINDOW = { name: 'MTD', startDay: 1, endDay: 31, share: 1 };

/** 2005.2 -> "2,005.2"; 3342 -> "3,342" (insight strings). */
function fmtNum(n) {
  const rounded = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function matchFilters(rowBag, filters) {
  if (filters.bde && rowBag.bde !== filters.bde) return false;
  if (filters.bbsp && rowBag.bbsp !== filters.bbsp) return false;
  if (filters.tech && rowBag.tech !== filters.tech) return false;
  if (filters.search) {
    const needle = String(filters.search).trim().toLowerCase();
    const haystack = [
      rowBag.jobOrder, rowBag.subscriber, rowBag.customerAddress, rowBag.territory,
      rowBag.area, rowBag.facility, rowBag.bbsp, rowBag.bde,
      rowBag.agentName, rowBag.agentCode, rowBag.channel
    ].join(' | ').toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Build every figure the dashboard needs.
 * @param data String[][] — parsed VALIDATION CSV (header row + rows)
 * @param extras { bdeTargets, bspbTargets, agentPool, prev } — optional parsed
 *   feeds; prev = the previous month's computeDashboard result (same filters)
 * @param filters { bde, bbsp, tech, search } — '' means All
 */
export function computeDashboard(data, extras = {}, filters = {}) {
  const bdeTargets = extras.bdeTargets || parseBdeTargets([]);
  const bbspTargets = extras.bspbTargets || {};
  const pool = extras.agentPool || parseAgentPool([]);

  // ---- scoped tech targets (filters re-slice the target universe) ----
  let techTarget = { gfp: 0, gah: 0 };
  if (filters.bbsp) {
    const row = bbspTargets[filters.bbsp];
    if (row) techTarget = { gfp: row.gfp, gah: row.gah };
  } else if (filters.bde) {
    const row = bdeTargets.byBde[filters.bde];
    if (row) techTarget = { gfp: row.gfp, gah: row.gah };
  } else {
    for (const row of Object.values(bdeTargets.byBde)) {
      techTarget.gfp += row.gfp;
      techTarget.gah += row.gah;
    }
  }
  const scopedTarget = (tech) => {
    if (tech === 'GFP') return techTarget.gfp;
    if (tech === 'GAH') return techTarget.gah;
    return techTarget.gfp + techTarget.gah;
  };
  const target = scopedTarget(filters.tech || '');

  const monthLabelFor = (date) => date
    ? date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()
    : '';

  const blankResult = {
    monthLabel: '',
    dataAsOf: null,
    daysElapsed: 0,
    kpis: {
      totalOrders: 0, actual: 0, gfpActual: 0, gahActual: 0,
      target, gfpTarget: techTarget.gfp, gahTarget: techTarget.gah,
      achievement: 0, dailyAverage: 0, notFound: 0
    },
    monthlyTarget: { total: target, actual: 0, remaining: Math.max(target, 0) },
    bdeTargets: bdeTargets.byBde,
    bbspTargets,
    bdeActuals: {},
    bbspActuals: {},
    territoryPerformance: [],
    areaPerformance: [],
    dailyPerformance: [],
    agentProductivity: [],
    dcos: [],
    pace: { days: [], actual: [], targetPace: [] },
    monthDays: 0,
    weeklyBlocks: { weeks: [], appsGen: [], installed: [] },
    appsGenMonthly: { total: 0, gfp: 0, gah: 0 },
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

  const records = [];
  let actual = 0, gfpActual = 0, gahActual = 0, notFound = 0;
  let dataAsOf = null;
  const dayCount = {}, territoryActual = {}, areaActual = {}, bdeActuals = {}, bbspActuals = {};
  // per-day tallies driving the deployed-style weekly blocks:
  //   appsGen* = ALL committed rows by DATE APPS GEN (TOTAL/GFP/GAH)
  //   gfpDays/gahDays = completed rows by LAST UPDATE, per technology
  const appsGenDays = {}, appsGenGfp = {}, appsGenGah = {}, gfpDays = {}, gahDays = {};
  const agentBags = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const jobOrder = normalizeWorkOrder(row[JOB]);
    if (!jobOrder) continue;

    const status = str(row, STATUS);
    const result = str(row, RESULT).toUpperCase();
    const isCompleted = status.toUpperCase() === COMPLETED_STATUS;
    const tech = classifyWorkOrder(jobOrder);

    const agentCode = str(row, AGENT_CODE);
    const agentName = str(row, AGENT_NAME);
    const poolEntry = pool.byAgent[agentCode] || (agentName ? pool.byAgent[agentName.toUpperCase()] : undefined);
    const record = {
      jobOrder,
      tech,
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
    };

    if (!matchFilters(record, filters)) continue;
    records.push(record);
    if (result === RESULT_NOT_FOUND) notFound++;

    const lastUpdate = parseSheetDate(record.lastUpdate);
    if (lastUpdate && (!dataAsOf || lastUpdate > dataAsOf)) dataAsOf = lastUpdate;

    const genDate = parseSheetDate(record.dateAppsGen);
    if (genDate) {
      const gday = genDate.getDate();
      appsGenDays[gday] = (appsGenDays[gday] || 0) + 1;
      if (tech === 'GFP') appsGenGfp[gday] = (appsGenGfp[gday] || 0) + 1;
      if (tech === 'GAH') appsGenGah[gday] = (appsGenGah[gday] || 0) + 1;
    }

    if (isCompleted) {
      actual++;
      if (tech === 'GFP') gfpActual++;
      if (tech === 'GAH') gahActual++;

      const territory = record.territory || 'BLANK';
      territoryActual[territory] = (territoryActual[territory] || 0) + 1;
      const area = record.area || 'BLANK';
      areaActual[area] = (areaActual[area] || 0) + 1;

      if (lastUpdate) {
        const day = lastUpdate.getDate();
        dayCount[day] = (dayCount[day] || 0) + 1;
        if (tech === 'GFP') gfpDays[day] = (gfpDays[day] || 0) + 1;
        if (tech === 'GAH') gahDays[day] = (gahDays[day] || 0) + 1;
      }

      // Every completing agent appears in productivity, even when the pool
      // cannot attribute them (BBSP/BDE stay blank in that case).
      if (agentCode || agentName) {
        const key = agentCode || agentName.toUpperCase();
        if (!agentBags[key]) {
          agentBags[key] = {
            agentCode,
            agentName: record.agentName,
            bbsp: record.bbsp,
            bde: record.bde,
            gfp: 0, gah: 0, total: 0
          };
        }
        agentBags[key].gfp += tech === 'GFP' ? 1 : 0;
        agentBags[key].gah += tech === 'GAH' ? 1 : 0;
        agentBags[key].total += 1;
      }

      if (poolEntry) {
        if (record.bde) bdeActuals[record.bde] = (bdeActuals[record.bde] || 0) + 1;
        if (record.bbsp) bbspActuals[record.bbsp] = (bbspActuals[record.bbsp] || 0) + 1;
      }
    }
  }

  const daysElapsed = dataAsOf ? dataAsOf.getDate() : 0;

  // ---- DCOS / MTD windows ----
  const prevKpis = extras.prev && extras.prev.kpis ? extras.prev.kpis : null;
  const prevTotals = prevKpis
    ? { GFP: prevKpis.gfpActual || 0, GAH: prevKpis.gahActual || 0, 'Grand Total': (prevKpis.gfpActual || 0) + (prevKpis.gahActual || 0) }
    : null;

  const completedInWindow = (w, endDay) => {
    const counts = { GFP: 0, GAH: 0, 'Grand Total': 0 };
    for (const record of records) {
      if (record.status.toUpperCase() !== COMPLETED_STATUS) continue;
      const date = parseSheetDate(record.lastUpdate);
      if (!date) continue;
      const day = date.getDate();
      if (day < w.startDay || day > endDay) continue;
      counts[record.tech] = (counts[record.tech] || 0) + 1;
      counts['Grand Total'] += 1;
    }
    return counts;
  };

  const buildWindow = (w) => {
    const monthEnd = dataAsOf
      ? new Date(dataAsOf.getFullYear(), dataAsOf.getMonth() + 1, 0).getDate()
      : 31;
    const endDay = Math.min(w.endDay, monthEnd);
    const installedByTech = completedInWindow(w, endDay);
    const remaining = Math.max(0, endDay - daysElapsed);
    const rows = ['GFP', 'GAH', 'Grand Total'].map((tech) => {
      const installed = installedByTech[tech] || 0;
      const rowTarget = scopedTarget(tech === 'Grand Total' ? '' : tech) * w.share;
      const variance = rowTarget - installed;
      const trend = prevTotals ? prevTotals[tech] : null;
      const trendAch = trend === null ? null : (rowTarget > 0 ? trend / rowTarget : 0);
      return {
        tech,
        installed,
        target: rowTarget,
        achPct: rowTarget > 0 ? installed / rowTarget : 0,
        variance,
        trend,
        trendAch,
        reqDaily: remaining > 0 ? variance / remaining : 0
      };
    });
    const grand = rows[2];
    const insights = [
      grand.trendAch === null
        ? 'No previous month fed — trend unavailable'
        : `${Math.round(grand.trendAch * 100)}% trend vs. ${w.name === 'MTD' ? 'month' : w.name} target of ${fmtNum(grand.target)}`,
      `${fmtNum(grand.variance)} variance to hit ${w.name === 'MTD' ? 'month' : w.name} target`,
      `${remaining} remaining day(s) for ${w.name === 'MTD' ? 'the month' : w.name}`
    ];
    return {
      name: w.name,
      startDay: w.startDay,
      endDay,
      monthEnd,
      share: w.share,
      rows,
      insights
    };
  };

  const dcos = [...DCOS_WINDOWS.map(buildWindow), buildWindow(MTD_WINDOW)];
  const mtd = dcos[2];
  mtd.avgDaily = {
    gfp: daysElapsed > 0 ? (installedSafe(mtd, 'GFP')) / daysElapsed : 0,
    gah: daysElapsed > 0 ? (installedSafe(mtd, 'GAH')) / daysElapsed : 0
  };

  function installedSafe(window, tech) {
    const row = window.rows.find((r) => r.tech === tech);
    return row ? row.installed : 0;
  }

  // ---- share-distributed targets ----
  const shareTargets = (counts, labelKey) => Object.keys(counts).map((key) => ({
    [labelKey]: key,
    actual: counts[key],
    target: target > 0 ? Math.round(target * (counts[key] / Math.max(actual, 1))) : 0
  }));

  const territoryPerformance = shareTargets(territoryActual, 'territory')
    .sort((a, b) => b.actual - a.actual);
  const areaPerformance = shareTargets(areaActual, 'area')
    .sort((a, b) => b.actual - a.actual);

  const dailyPerformance = [];
  for (let day = 1; day <= 31; day++) {
    if (dayCount[day]) dailyPerformance.push({ day: String(day), actual: dayCount[day] });
  }

  // ---- pace: cumulative completions vs a linear pro-rata target line ----
  const daysInMonth = dataAsOf
    ? new Date(dataAsOf.getFullYear(), dataAsOf.getMonth() + 1, 0).getDate()
    : 31;
  const paceDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  let run = 0;
  const pace = {
    days: paceDays,
    actual: paceDays.map((d) => (run += dayCount[d] || 0)),
    targetPace: paceDays.map((d) => (target * d) / daysInMonth)
  };

  // ---- weekly: deployed-style calendar-week blocks -----------------------
  // appsGen = ALL rows by DATE APPS GEN; installed = completed by LAST
  // UPDATE; rows TOTAL/GFP/GAH per week, reconciling to the month totals.
  const weeks = calendarWeeks(dataAsOf);
  const tallyWeeks = (weeks, totals, gfpMap, gahMap) => weeks.map((def) => {
    let total = 0, gfp = 0, gah = 0;
    for (let d = def.start; d <= def.end; d++) {
      total += totals[d] || 0;
      gfp += gfpMap[d] || 0;
      gah += gahMap[d] || 0;
    }
    return { week: def.week, total, gfp, gah };
  });
  const sumDays = (map) => Object.values(map).reduce((s, n) => s + n, 0);
  const appsGenMonthly = { total: sumDays(appsGenDays), gfp: sumDays(appsGenGfp), gah: sumDays(appsGenGah) };
  const weeklyBlocks = {
    weeks,
    appsGen: tallyWeeks(weeks, appsGenDays, appsGenGfp, appsGenGah),
    installed: tallyWeeks(weeks, dayCount, gfpDays, gahDays)
  };

  const agentProductivity = Object.values(agentBags)
    .sort((a, b) => b.total - a.total || a.agentName.localeCompare(b.agentName));

  const kpis = {
    totalOrders: records.length,
    actual,
    gfpActual,
    gahActual,
    target,
    gfpTarget: techTarget.gfp,
    gahTarget: techTarget.gah,
    achievement: target > 0 ? actual / target : 0,
    dailyAverage: daysElapsed > 0 ? actual / daysElapsed : 0,
    notFound
  };

  return {
    monthLabel: monthLabelFor(dataAsOf),
    dataAsOf,
    daysElapsed,
    kpis,
    monthlyTarget: { total: target, actual, remaining: Math.max(target - actual, 0) },
    bdeTargets: bdeTargets.byBde,
    bbspTargets,
    bdeActuals,
    bbspActuals,
    territoryPerformance,
    areaPerformance,
    dailyPerformance,
    agentProductivity,
    dcos,
    pace,
    monthDays: dataAsOf ? daysInMonth : 0,
    weeklyBlocks,
    appsGenMonthly,
    records
  };
}
