// DOM rendering for the EBISU Sales Report dashboard.
// Sections mirror the Apps Script DASHBOARD sheet, fed by the compute result:
//   renderDashboard(container, result, meta)
import { mountCharts } from './charts.js';

const THEME = {
  navy: '#0B2545', navyMid: '#13315C', light: '#EEF2FA',
  gfp: '#D6336C', gfpLight: '#FBE7EF',
  gah: '#1971C2', gahLight: '#E7F3FE',
  purple: '#6741D9', purpleLight: '#F0ECFE',
  green: '#0CA678', greenLight: '#E4F8F2',
  red: '#E03131', redLight: '#FCE9E9',
  gold: '#E8A400', goldLight: '#FFF6E0',
  text: '#1B2A41', muted: '#6B7A99', border: '#DDE6F5'
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pct = (value, total) => (total > 0 ? `${((value / total) * 100).toFixed(1)}% of total` : '—');
const fmtDate = (date) => date
  ? date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
  : '—';
const fmtNow = () => new Date().toLocaleString('en-US', {
  month: 'short', day: '2-digit', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true
});

function masthead() {
  const header = el('header', 'masthead');
  header.appendChild(el('h1', 'masthead-title', 'EBISU Sales Report'));
  header.appendChild(el('p', 'masthead-sub', 'GFP & GAH operational performance — fed by your VALIDATION sheet export'));
  return header;
}

function dateStrip(result) {
  const strip = el('section', 'date-strip');
  const cells = [
    { label: 'D-1 DATE (LATEST LAST UPDATE)', value: fmtDate(result.dataAsOf) },
    { label: 'PAGE REFRESHED', value: fmtNow() }
  ];
  cells.forEach((cell) => {
    const box = el('div', 'date-cell');
    box.appendChild(el('div', 'date-cell-label', cell.label));
    box.appendChild(el('div', 'date-cell-value', cell.value));
    strip.appendChild(box);
  });
  return strip;
}

const KPI_CARDS = [
  { key: 'gfp', title: 'GFP WORK ORDERS', color: THEME.gfp, light: THEME.gfpLight },
  { key: 'gah', title: 'GAH WORK ORDERS', color: THEME.gah, light: THEME.gahLight },
  { key: 'total', title: 'TOTAL GFP + GAH', color: THEME.purple, light: THEME.purpleLight },
  { key: 'found', title: 'FOUND (VALIDATION)', color: THEME.green, light: THEME.greenLight },
  { key: 'notFound', title: 'NOT FOUND', color: THEME.red, light: THEME.redLight },
  { key: 'matchRate', title: 'MATCH RATE', color: THEME.gold, light: THEME.goldLight, isPercent: true }
];

function kpiValue(result, key, formatPercent) {
  const value = result[key];
  return formatPercent ? `${(value * 100).toFixed(1)}%` : String(value);
}

function kpiSubtitle(key, result) {
  return {
    gfp: () => pct(result.gfp, result.total),
    gah: () => pct(result.gah, result.total),
    total: () => 'GFP + GAH work orders',
    found: () => (result.checked > 0 ? `${((result.found / result.checked) * 100).toFixed(1)}% match rate` : '—'),
    notFound: () => `${result.notFound} of ${result.checked} checked`,
    matchRate: () => `${result.found} / ${result.checked} matched`
  }[key]();
}

function kpiCards(result) {
  const grid = el('section', 'kpi-grid');
  KPI_CARDS.forEach((card) => {
    const box = el('article', 'kpi-card');
    box.style.setProperty('--kpi-color', card.color);
    box.style.setProperty('--kpi-light', card.light);
    box.appendChild(el('div', 'kpi-title', card.title));
    box.appendChild(el('div', 'kpi-value', kpiValue(result, card.key, card.isPercent)));
    box.appendChild(el('div', 'kpi-sub', kpiSubtitle(card.key, result)));
    grid.appendChild(box);
  });
  return grid;
}

function sectionBand(title) {
  return el('h2', 'section-band', title);
}

function validationSummaryPanel(result) {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', 'VALIDATION SUMMARY'));
  const list = el('ul', 'summary-list');
  [
    { label: 'Work orders checked', value: String(result.checked), color: THEME.gah },
    { label: 'Found', value: String(result.found), color: THEME.green },
    { label: 'Not found', value: String(result.notFound), color: THEME.red },
    { label: 'Match rate', value: `${(result.matchRate * 100).toFixed(1)}%`, color: THEME.gold }
  ].forEach((item) => {
    const row = el('li', 'summary-row');
    const name = el('span', 'summary-name', `● ${item.label}`);
    name.style.color = item.color;
    row.appendChild(name);
    row.appendChild(el('span', 'summary-value', item.value));
    list.appendChild(row);
  });
  panel.appendChild(list);

  const gaugeBox = el('div', 'chart-box gauge-mini');
  gaugeBox.dataset.chart = 'gauge';
  panel.appendChild(gaugeBox);
  return panel;
}

function mixPanel(result) {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', 'GFP vs GAH WORK ORDER MIX'));
  const box = el('div', 'chart-box donut-box');
  box.dataset.chart = 'donut';
  panel.appendChild(box);
  return panel;
}

function alertPanel(result) {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', 'MANAGEMENT ALERT'));

  let title, body, color, light;
  if (result.notFound > 0) {
    title = 'VALIDATION ATTENTION';
    body = `${result.notFound} work order(s) were not found in the FSM source.`;
    color = THEME.red; light = THEME.redLight;
  } else if (result.total === 0) {
    title = 'NO WORK ORDERS';
    body = 'No GFP or GAH work orders were identified.';
    color = THEME.gold; light = THEME.goldLight;
  } else {
    title = 'ALL GOOD';
    body = 'No major validation issues detected. Operations are running smoothly.';
    color = THEME.green; light = THEME.greenLight;
  }

  const box = el('div', 'alert');
  box.style.setProperty('--alert-color', color);
  box.style.setProperty('--alert-light', light);
  box.appendChild(el('div', 'alert-title', title));
  box.appendChild(el('div', 'alert-body', body));
  panel.appendChild(box);
  return panel;
}

function overviewRow(result) {
  const row = el('section', 'panel-row');
  row.appendChild(validationSummaryPanel(result));
  row.appendChild(mixPanel(result));
  row.appendChild(alertPanel(result));
  return row;
}

function categoryRow(result) {
  const row = el('section', 'chart-row');
  [
    { kind: 'status', title: 'BY STATUS' },
    { kind: 'area', title: 'BY AREA' },
    { kind: 'territory', title: 'BY TERRITORY' },
    { kind: 'facility', title: 'BY FACILITY' }
  ].forEach((chart) => {
    const block = el('article', 'chart-block');
    block.appendChild(el('h3', 'panel-title', chart.title));
    const box = el('div', 'chart-box');
    box.dataset.chart = chart.kind;
    block.appendChild(box);
    row.appendChild(block);
  });
  return row;
}

const MEDALS = ['#FFF3CD', '#F1F3F5', '#FDEBD3'];

function agentsSection(result) {
  const section = el('section', 'agents-section');
  const head = el('div', 'agents-head');
  head.appendChild(el('h2', 'section-band center', '🏆 TOP 10 AGENTS'));
  section.appendChild(head);

  const layout = el('div', 'agents-layout');
  const tablePanel = el('article', 'panel');
  tablePanel.appendChild(el('h3', 'panel-title', 'RANKING'));

  const table = el('table', 'agents-table');
  const thead = el('thead');
  const headRow = document.createElement('tr');
  ['RANK', 'AGENT CODE', 'AGENT NAME', 'CHANNEL', 'GFP', 'GAH', 'TOTAL'].forEach((label) => {
    headRow.appendChild(el('th', null, label));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  const top10 = result.agents.slice(0, 10);
  if (top10.length === 0) {
    const tr = el('tr', null, null);
    const td = el('td', 'table-empty', 'No agent data in this feed.');
    td.colSpan = 7;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  top10.forEach((agent, index) => {
    const tr = el('tr', 'agents-row');
    if (index < 3) tr.style.setProperty('--medal', MEDALS[index]);
    [
      String(index + 1), agent.agentCode, agent.agentName, agent.channel,
      String(agent.gfp), String(agent.gah), String(agent.total)
    ].forEach((value, col) => {
      tr.appendChild(el('td', col === 2 ? 'agent-name-cell' : null, value || '—'));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tablePanel.appendChild(table);
  layout.appendChild(tablePanel);

  const chartPanel = el('article', 'panel');
  chartPanel.appendChild(el('h3', 'panel-title', 'GFP vs GAH SPLIT'));
  const chartBox = el('div', 'chart-box agents-chart');
  chartBox.dataset.chart = 'agents';
  chartPanel.appendChild(chartBox);
  layout.appendChild(chartPanel);

  section.appendChild(layout);
  return section;
}

export function renderDashboard(container, result, meta) {
  const root = el('div', 'dashboard');
  root.dataset.fileName = meta.fileName;

  root.appendChild(masthead());
  root.appendChild(dateStrip(result));
  root.appendChild(kpiCards(result));
  root.appendChild(sectionBand('EXECUTIVE OVERVIEW'));
  root.appendChild(overviewRow(result));
  root.appendChild(sectionBand('CATEGORY BREAKDOWNS'));
  root.appendChild(categoryRow(result));
  root.appendChild(agentsSection(result));

  const footer = el('footer', 'page-footer');
  footer.appendChild(el('p', null, `EBISU Sales Report • Auto-generated from the VALIDATION sheet CSV export (${meta.fileName})`));
  root.appendChild(footer);

  container.appendChild(root);
  mountCharts(root, result);
}
