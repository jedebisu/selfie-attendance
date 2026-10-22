// Pure dashboard data model for EBISU Sales Report.
// Mirrors the FSM Apps Script counting logic (VALIDATION sheet, OUTPUT_HEADERS):
//   - WORK ORDERS are matched by trimmed-uppercase job order number
//   - classify: GFP* -> GFP, GLS*/7* -> GAH, anything else -> excluded
//   - totals, breakdowns and agent tables count only RESULT === 'FOUND' rows
//     that classify; checked = every row with a non-blank JOB ORDER
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

const RESULT_FOUND = 'FOUND';
const RESULT_NOT_FOUND = 'NOT FOUND';

export function computeDashboard(data) {
  const empty = {
    checked: 0, found: 0, notFound: 0, matchRate: 0,
    gfp: 0, gah: 0, total: 0,
    statusCount: [], areaCount: [], territoryCount: [], facilityCount: [],
    agents: [], dataAsOf: null
  };
  if (!Array.isArray(data) || data.length < 2) return empty;

  const headers = data[0].map(normalizeHeader);
  const idx = (name) => headers.indexOf(name);
  const JOB = idx('joborder');
  const RESULT = idx('result');
  if (JOB === -1) throw new Error('Missing JOB ORDER column in the CSV.');
  if (RESULT === -1) throw new Error('Missing RESULT column in the CSV.');
  const STATUS = idx('status');
  const AREA = idx('area');
  const TERRITORY = idx('territory');
  const FACILITY = idx('facility');
  const LAST_UPDATE = idx('lastupdate');
  const AGENT_CODE = idx('agentcode');
  const AGENT_NAME = idx('agentname');
  const CHANNEL = idx('channel');

  const str = (row, index, fallback = '') => {
    const value = index === -1 ? undefined : row[index];
    return String(value ?? fallback).trim();
  };
  const tally = (object, key) => {
    object[key] = (object[key] || 0) + 1;
  };
  const ranked = (object) =>
    Object.entries(object)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));

  let checked = 0, found = 0, notFound = 0, gfp = 0, gah = 0;
  let dataAsOf = null;
  const statusCount = {}, areaCount = {}, territoryCount = {}, facilityCount = {};
  const agents = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const jobOrder = normalizeWorkOrder(row[JOB]);
    if (!jobOrder) continue;
    checked++;

    const result = str(row, RESULT).toUpperCase();
    if (result === RESULT_FOUND) found++;
    if (result === RESULT_NOT_FOUND) notFound++;

    const lastUpdate = parseSheetDate(LAST_UPDATE === -1 ? '' : row[LAST_UPDATE]);
    if (lastUpdate && (!dataAsOf || lastUpdate > dataAsOf)) dataAsOf = lastUpdate;

    const type = classifyWorkOrder(jobOrder);
    if (!type || result !== RESULT_FOUND) continue;

    if (type === 'GFP') gfp++;
    if (type === 'GAH') gah++;

    tally(statusCount, str(row, STATUS) || 'BLANK');
    tally(areaCount, str(row, AREA) || 'BLANK');
    tally(territoryCount, str(row, TERRITORY) || 'BLANK');
    tally(facilityCount, str(row, FACILITY) || 'BLANK');

    const agentCode = str(row, AGENT_CODE);
    const agentName = str(row, AGENT_NAME);
    if (!agentCode && !agentName) continue;

    const agentKey = agentCode ? 'CODE:' + agentCode : 'NAME:' + agentName;
    if (!agents[agentKey]) {
      agents[agentKey] = {
        agentCode, agentName,
        channel: str(row, CHANNEL),
        gfp: 0, gah: 0, total: 0
      };
    }

    if (type === 'GFP') agents[agentKey].gfp++;
    if (type === 'GAH') agents[agentKey].gah++;
    agents[agentKey].total++;
    const channel = str(row, CHANNEL);
    if (channel) agents[agentKey].channel = channel;
  }

  return {
    checked,
    found,
    notFound,
    matchRate: checked > 0 ? found / checked : 0,
    gfp,
    gah,
    total: gfp + gah,
    statusCount: ranked(statusCount),
    areaCount: ranked(areaCount),
    territoryCount: ranked(territoryCount),
    facilityCount: ranked(facilityCount),
    agents: Object.values(agents).sort(
      (a, b) => (b.total - a.total) || String(a.agentName).localeCompare(String(b.agentName))
    ),
    dataAsOf
  };
}
