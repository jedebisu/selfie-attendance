// DOM rendering for the EBISU Sales Report dashboard — v2, target-driven.
// Sections (user-approved): title band, 6 KPI cards, monthly target panel,
// daily performance, GFP/GAH mix, territory performance, per-BDE table,
// per-BBSP table, all-records table — plus a "vs LAST MONTH" tab that
// compares the fed month against a previous month's VALIDATION export.
import { mountCharts } from './charts.js';

const THEME = {
  gfp: '#D6336C', gfpLight: '#FBE7EF',
  gah: '#1971C2', gahLight: '#E7F3FE',
  purple: '#6741D9', purpleLight: '#F0ECFE',
  green: '#0CA678', greenLight: '#E4F8F2',
  red: '#E03131', redLight: '#FCE9E9',
  gold: '#E8A400', goldLight: '#FFF6E0',
  navy: '#0B2545'
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const int = (n) => Number(n).toLocaleString('en-US');
const pct1 = (x) => `${(Number(x) * 100).toFixed(1)}%`;
const num1 = (n) => Number(n).toFixed(1);
const fmtDate = (date) => date
  ? date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
  : '—';
const fmtNow = () => new Date().toLocaleString('en-US', {
  month: 'short', day: '2-digit', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true
});

// ---------- masthead, dates, tabs ----------

function masthead(current) {
  const header = el('header', 'masthead');
  header.appendChild(el('h1', 'masthead-title', 'EBISU Sales Report'));
  header.appendChild(el('p', 'masthead-sub',
    `${current.monthLabel || 'NO DATA'} · GFP & GAH sales performance - fed by your Google Sheets CSV exports`));
  return header;
}

function tabsBar(current, previous) {
  const bar = el('nav', 'tabs');
  bar.setAttribute('role', 'tablist');
  const tabs = [
    { id: 'month', label: 'THIS MONTH' },
    { id: 'vs', label: previous ? `VS LAST MONTH (${previous.monthLabel})` : 'VS LAST MONTH' }
  ];
  tabs.forEach((tab, i) => {
    const btn = el('button', `tab-btn${i === 0 ? ' active' : ''}`, tab.label);
    btn.type = 'button';
    btn.dataset.tab = tab.id;
    btn.addEventListener('click', () => {
      bar.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.pane').forEach((p) => {
        p.classList.toggle('active', p.dataset.pane === tab.id);
      });
    });
    bar.appendChild(btn);
  });
  void current;
  return bar;
}

function dateStrip(current) {
  const strip = el('section', 'date-strip');
  [
    { label: 'MONTH OF DATA', value: current.monthLabel || '—' },
    { label: 'DATA AS OF (LATEST LAST UPDATE)', value: fmtDate(current.dataAsOf) },
    { label: 'PAGE REFRESHED', value: fmtNow() }
  ].forEach((cell) => {
    const box = el('div', 'date-cell');
    box.appendChild(el('div', 'date-cell-label', cell.label));
    box.appendChild(el('div', 'date-cell-value', cell.value));
    strip.appendChild(box);
  });
  return strip;
}

// ---------- KPI cards ----------

function kpiSubtitle(key, result) {
  const k = result.kpis;
  return {
    totalOrders: () => 'work orders in this feed',
    actual: () => 'status COMPLETED',
    target: () => (k.target > 0 ? 'sum of BDE targets' : 'no targets fed yet'),
    achievement: () => 'of monthly target',
    dailyAverage: () => `${result.daysElapsed} days elapsed`,
    notFound: () => `of ${k.totalOrders} in feed`
  }[key]();
}

const KPI_CARDS = [
  { key: 'totalOrders', title: 'TOTAL WORK ORDERS', color: THEME.navy, light: '#E8EDF7' },
  { key: 'actual', title: 'ACTUAL (COMPLETED)', color: THEME.green, light: THEME.greenLight },
  { key: 'target', title: 'MONTHLY TARGET', color: THEME.purple, light: THEME.purpleLight, isCount: true },
  { key: 'achievement', title: 'ACHIEVEMENT', color: THEME.gold, light: THEME.goldLight, isPercent: true },
  { key: 'dailyAverage', title: 'DAILY AVERAGE', color: THEME.gah, light: THEME.gahLight, isFloat: true },
  { key: 'notFound', title: 'NOT FOUND', color: THEME.red, light: THEME.redLight }
];

function kpiCards(current) {
  const grid = el('section', 'kpi-grid');
  KPI_CARDS.forEach((card) => {
    const value = current.kpis[card.key];
    const display = card.isPercent
      ? pct1(value)
      : card.isFloat
        ? num1(value)
        : int(value);
    const box = el('article', 'kpi-card');
    box.style.setProperty('--kpi-color', card.color);
    box.style.setProperty('--kpi-light', card.light);
    box.appendChild(el('div', 'kpi-title', card.title));
    box.appendChild(el('div', 'kpi-value', display));
    box.appendChild(el('div', 'kpi-sub', kpiSubtitle(card.key, current)));
    grid.appendChild(box);
  });
  return grid;
}

// ---------- month-view sections ----------

function sectionBand(title) {
  return el('h2', 'section-band', title);
}

function monthlyTargetPanel(current) {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', 'MONTHLY TARGET'));
  const m = current.monthlyTarget;
  const list = el('ul', 'summary-list');
  [
    { label: 'Target', value: int(m.total), color: THEME.purple },
    { label: 'Actual (completed)', value: int(m.actual), color: THEME.green },
    { label: 'Remaining', value: int(m.remaining), color: THEME.red },
    { label: 'Achievement', value: current.kpis.target > 0 ? pct1(current.kpis.achievement) : '—', color: THEME.gold }
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

function alertPanel(current) {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', 'MANAGEMENT ALERT'));
  let title, body, color, light;
  if (current.kpis.notFound > 0) {
    title = 'VALIDATION ATTENTION';
    body = `${int(current.kpis.notFound)} work order(s) were not found in the FSM source.`;
    color = THEME.red; light = THEME.redLight;
  } else if (current.kpis.target === 0) {
    title = 'NO TARGETS FED';
    body = 'Drop the TARGETS export to compare actuals against monthly goals.';
    color = THEME.gold; light = THEME.goldLight;
  } else if (current.kpis.achievement >= 1) {
    title = 'TARGET HIT';
    body = 'Monthly target achieved. Keep the momentum going.';
    color = THEME.green; light = THEME.greenLight;
  } else {
    title = 'IN PROGRESS';
    body = `${int(current.monthlyTarget.remaining)} work orders remaining to hit the monthly target.`;
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

function mixPanel() {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', 'WORK ORDER MIX (GFP / GAH)'));
  const box = el('div', 'chart-box donut-box');
  box.dataset.chart = 'donut';
  panel.appendChild(box);
  return panel;
}

function dailyPanel() {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', 'DAILY PERFORMANCE (COMPLETED BY DAY)'));
  const box = el('div', 'chart-box');
  box.dataset.chart = 'daily';
  panel.appendChild(box);
  return panel;
}

function targetsTable(map, actuals, emptyHint) {
  const wrap = el('div', 'table-scroll');
  const names = Object.keys(map);
  if (!names.length) {
    const note = el('p', 'table-empty', emptyHint);
    wrap.appendChild(note);
    return wrap;
  }
  const rows = names
    .map((name) => ({ name, t: map[name], actual: actuals?.[name] || 0 }))
    .sort((a, b) => b.t.total - a.t.total);

  const table = el('table', 'data-table');
  const thead = el('thead');
  const headRow = document.createElement('tr');
  ['NAME', 'GFP TARGET', 'GAH TARGET', 'TOTAL TARGET', 'ACTUAL (COMPLETED)', 'ACHIEVED'].forEach((label) => {
    headRow.appendChild(el('th', null, label));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  rows.forEach((r, index) => {
    const tr = el('tr', index % 2 ? 'alt' : null);
    [
      r.name,
      int(r.t.gfp),
      int(r.t.gah),
      int(r.t.total),
      int(r.actual),
      r.t.total > 0 ? pct1(r.actual / r.t.total) : '—'
    ].forEach((value, col) => {
      tr.appendChild(el('td', col === 0 ? 'name-cell' : null, value));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function recordsTable(records) {
  const wrap = el('div', 'table-scroll');
  const table = el('table', 'data-table records-table');
  const columns = [
    ['JOB ORDER', (r) => r.jobOrder],
    ['RESULT', (r) => r.result],
    ['TECH', (r) => r.tech],
    ['SUBSCRIBER', (r) => r.subscriber],
    ['CUSTOMER ADDRESS', (r) => r.customerAddress],
    ['PLAN AMOUNT', (r) => r.planAmount],
    ['AREA', (r) => r.area],
    ['TERRITORY', (r) => r.territory],
    ['FACILITY', (r) => r.facility],
    ['STATUS', (r) => r.status],
    ['DATE APPS GEN', (r) => r.dateAppsGen],
    ['LAST UPDATE', (r) => r.lastUpdate],
    ['AGENT CODE', (r) => r.agentCode],
    ['AGENT NAME', (r) => r.agentName],
    ['CHANNEL', (r) => r.channel],
    ['BBSP', (r) => r.bbsp],
    ['BDE', (r) => r.bde]
  ];
  const thead = el('thead');
  const headRow = document.createElement('tr');
  columns.forEach(([label]) => headRow.appendChild(el('th', null, label)));
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el('tbody');
  records.forEach((record, index) => {
    const tr = el('tr', index % 2 ? 'alt' : null);
    columns.forEach(([, get], col) => {
      const value = get(record);
      const td = el('td', col === 0 ? 'name-cell' : null, value || '—');
      if (columns[col][0] === 'STATUS' && String(value).toUpperCase() === 'COMPLETED') {
        td.classList.add('good-value');
      }
      if (columns[col][0] === 'RESULT' && String(value).toUpperCase() === 'NOT FOUND') {
        td.classList.add('bad-value');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function monthView(current) {
  const pane = el('section', 'pane active');
  pane.dataset.pane = 'month';

  pane.appendChild(dateStrip(current));
  pane.appendChild(kpiCards(current));
  pane.appendChild(sectionBand('EXECUTIVE OVERVIEW'));

  const row = el('section', 'panel-row');
  row.appendChild(monthlyTargetPanel(current));
  row.appendChild(alertPanel(current));
  row.appendChild(mixPanel());
  pane.appendChild(row);

  const dailyBlock = el('article', 'panel chart-wide');
  dailyBlock.appendChild(el('h3', 'panel-title', 'DAILY PERFORMANCE — COMPLETED WORK ORDERS BY DAY OF MONTH'));
  const dailyBox = el('div', 'chart-box daily-box');
  dailyBox.dataset.chart = 'daily';
  dailyBlock.appendChild(dailyBox);
  pane.appendChild(dailyBlock);

  pane.appendChild(sectionBand('TERRITORY PERFORMANCE'));
  const territoryBlock = el('article', 'panel chart-wide');
  territoryBlock.appendChild(el('h3', 'panel-title', 'COMPLETED VS SHARE-DISTRIBUTED TARGET'));
  const territoryBox = el('div', 'chart-box territory-box');
  territoryBox.dataset.chart = 'territory';
  territoryBlock.appendChild(territoryBox);
  pane.appendChild(territoryBlock);

  pane.appendChild(sectionBand('BDE TARGETS'));
  const bdePanel = el('article', 'panel');
  bdePanel.appendChild(targetsTable(
    current.bdeTargets,
    current.bdeActuals,
    'No TARGETS CSV fed yet — drag the TARGETS export onto this page to compare against monthly goals.'
  ));
  pane.appendChild(bdePanel);

  pane.appendChild(sectionBand('BBSP TARGETS'));
  const bbspPanel = el('article', 'panel');
  bbspPanel.appendChild(targetsTable(
    current.bbspTargets,
    current.bbspActuals,
    'No BBSP TARGETS CSV fed yet — partner-store targets will appear here once fed.'
  ));
  pane.appendChild(bbspPanel);

  pane.appendChild(sectionBand(`ALL WORK ORDERS (${int(current.records.length)})`));
  const recordsPanel = el('article', 'panel');
  recordsPanel.appendChild(recordsTable(current.records));
  pane.appendChild(recordsPanel);

  return pane;
}

// ---------- vs-last-month view ----------

const VS_METRICS = [
  { label: 'TOTAL WORK ORDERS', get: (d) => d.kpis.totalOrders, fmt: int, higherBetter: true },
  { label: 'ACTUAL (COMPLETED)', get: (d) => d.kpis.actual, fmt: int, higherBetter: true },
  { label: 'ACHIEVEMENT', get: (d) => d.kpis.achievement, fmt: pct1, higherBetter: true },
  { label: 'DAILY AVERAGE', get: (d) => d.kpis.dailyAverage, fmt: num1, higherBetter: true },
  { label: 'NOT FOUND', get: (d) => d.kpis.notFound, fmt: int, higherBetter: false }
];

function vsDeltaCard(metric, current, previous) {
  const cur = metric.get(current);
  const prev = metric.get(previous);
  const diff = cur - prev;
  const improved = metric.higherBetter ? diff > 0 : diff < 0;
  const unchanged = diff === 0;

  const card = el('article', 'vs-card');
  card.appendChild(el('div', 'vs-label', metric.label));
  const valueRow = el('div', 'vs-values');
  const now = el('span', 'vs-now', metric.fmt(cur));
  const then = el('span', 'vs-prev', `was ${metric.fmt(prev)}`);
  valueRow.appendChild(now);
  valueRow.appendChild(then);
  card.appendChild(valueRow);

  const chip = el('span', `vs-chip ${unchanged ? 'flat' : improved ? 'better' : 'worse'}`);
  chip.textContent = unchanged
    ? 'no change'
    : `${diff > 0 ? '▲ +' : '▼ −'}${metric.fmt(Math.abs(diff)).replace(/\.0%?$/, '')}`;
  card.appendChild(chip);
  return card;
}

function vsView(current, previous) {
  const pane = el('section', 'pane');
  pane.dataset.pane = 'vs';

  if (!previous) {
    const empty = el('div', 'vs-empty');
    empty.appendChild(el('div', 'empty-title', 'No previous month fed yet'));
    empty.appendChild(el('div', 'empty-hint',
      'Export the PREVIOUS month\'s VALIDATION sheet as CSV and drag it onto this page together with this month\'s. The site groups feeds by their own data month automatically.'));
    pane.appendChild(empty);
    return pane;
  }

  pane.appendChild(el('h2', 'vs-header', `${current.monthLabel} vs ${previous.monthLabel}`));

  const grid = el('section', 'vs-grid');
  VS_METRICS.forEach((metric) => grid.appendChild(vsDeltaCard(metric, current, previous)));
  pane.appendChild(grid);

  pane.appendChild(sectionBand('DAILY PACING, MONTH VS MONTH'));
  const block = el('article', 'panel chart-wide');
  block.appendChild(el('h3', 'panel-title', 'COMPLETED WORK ORDERS BY DAY OF MONTH'));
  const box = el('div', 'chart-box daily-box');
  box.dataset.chart = 'vs-daily';
  block.appendChild(box);
  pane.appendChild(block);

  return pane;
}

// ---------- root ----------

export function renderDashboard(container, bundle) {
  const { current, previous } = bundle;
  const root = el('div', 'dashboard');

  root.appendChild(masthead(current));
  root.appendChild(tabsBar(current, previous));

  const monthPane = monthView(current);
  const vsPane = vsView(current, previous);
  root.appendChild(monthPane);
  root.appendChild(vsPane);

  const footer = el('footer', 'page-footer');
  footer.appendChild(el('p', null, `EBISU Sales Report • Fed by your VALIDATION, TARGETS, BBSP TARGETS and AGENT POOL CSV exports`));
  root.appendChild(footer);

  container.appendChild(root);
  mountCharts(root, bundle);
}
