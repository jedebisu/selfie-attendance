// DOM rendering for EBISU Sales Report — v3, mirroring the deployed
// Apps Script layout: dark top bar, left sidebar pages, global filter bar,
// KPI cards, DCOS 1 / DCOS 2 / MTD tables with insights, territory/daily
// panels, and a Month-vs-Month page (kept per user decision).
import { mountCharts } from './charts.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const int = (n) => Math.round(Number(n)).toLocaleString('en-US');
const fmtTarget = (n) => { // decimals preserved for DCOS targets (1,483.2)
  const rounded = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString('en-US')
    : rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};
const pct1 = (x) => `${(Number(x) * 100).toFixed(1)}%`;
const fmtDate = (d) => d
  ? d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
  : '—';

// ---------- shell: top bar, sidebar, filter bar ----------

export const PAGES = [
  { id: 'overview', label: 'Overview', icon: '▤' },
  { id: 'bbsp', label: 'BBSP', icon: '👤' },
  { id: 'byarea', label: 'By Area', icon: '📍' },
  { id: 'byterritory', label: 'By Territory', icon: '📍' },
  { id: 'records', label: 'Records', icon: '▦' },
  { id: 'agents', label: 'Agent Productivity', icon: '📈' },
  { id: 'vsmonth', label: 'Month vs Month', icon: '⇄' }
];

function topBar(bundle, meta) {
  const { current } = bundle;
  const bar = el('header', 'topbar');

  const title = el('div', 'topbar-title', 'EBISU Sales Report');

  const status = el('div', 'topbar-status');
  status.appendChild(el('span', 'topbar-dot', '●'));
  status.appendChild(el('span', null,
    `Fed ${fmtDate(current.dataAsOf)} · ${int(current.kpis.totalOrders)} records`));

  const actions = el('div', 'topbar-actions');
  const reload = el('button', 'topbar-btn ghost', '⟳ Reload data');
  reload.type = 'button';
  reload.id = 'reload-data';
  actions.appendChild(reload);

  const monthBadge = el('select', 'topbar-btn month-badge');
  monthBadge.id = 'month-badge';
  monthBadge.title = 'Choose which fed month to view';
  monthBadge.dataset.monthSelect = '1';
  (meta.monthOptions || []).forEach((label) => {
    const option = document.createElement('option');
    option.value = label;
    option.textContent = label;
    if (label === current.monthLabel) option.selected = true;
    monthBadge.appendChild(option);
  });
  actions.appendChild(monthBadge);

  const upload = el('button', 'topbar-btn accent', '⬆ Upload CSV');
  upload.type = 'button';
  upload.id = 'upload-csv';
  actions.appendChild(upload);

  [title, status, actions].forEach((n) => bar.appendChild(n));
  return bar;
}

function sideBar(activePage) {
  const nav = el('aside', 'sidebar');
  const logo = el('div', 'sidebar-logo');
  const mark = el('span', 'sidebar-mark', 'E');
  const name = el('span', 'sidebar-name', 'EBISU');
  logo.appendChild(mark);
  logo.appendChild(name);
  nav.appendChild(logo);

  const list = el('nav', 'sidebar-nav');
  list.setAttribute('aria-label', 'Report pages');
  PAGES.forEach((page) => {
    const item = el('button', `side-item${page.id === activePage ? ' active' : ''}`);
    item.type = 'button';
    item.dataset.page = page.id;
    item.appendChild(el('span', 'side-icon', page.icon));
    item.appendChild(el('span', 'side-label', page.label));
    list.appendChild(item);
  });
  nav.appendChild(list);
  return nav;
}

function filterBar(current, pool, handlers) {
  const bar = el('section', 'filter-bar');

  const mkSelect = (label, key, options) => {
    const cell = el('div', 'filter-cell');
    cell.appendChild(el('div', 'filter-label', label));
    const select = el('select', 'filter-select');
    select.dataset.filter = key;
    const all = el('option', null, 'All');
    all.value = '';
    select.appendChild(all);
    options.forEach((opt) => {
      const o = el('option', null, opt);
      o.value = opt;
      select.appendChild(o);
    });
    select.value = handlers.filters[key] || '';
    select.addEventListener('change', () => handlers.onFilter(key, select.value));
    cell.appendChild(select);
    return cell;
  };

  bar.appendChild(mkSelect('BDE', 'bde', pool.bdes));
  bar.appendChild(mkSelect('BBSP', 'bbsp', pool.bbsps));

  const techCell = el('div', 'filter-cell');
  techCell.appendChild(el('div', 'filter-label', 'TECH'));
  const techSelect = el('select', 'filter-select');
  techSelect.dataset.filter = 'tech';
  techSelect.innerHTML = ''; // built inline (static list)
  [['', 'All'], ['GFP', 'GFP'], ['GAH', 'GAH']].forEach(([v, label]) => {
    const o = el('option', null, label);
    o.value = v;
    techSelect.appendChild(o);
  });
  techSelect.value = handlers.filters.tech || '';
  techSelect.addEventListener('change', () => handlers.onFilter('tech', techSelect.value));
  techCell.appendChild(techSelect);
  bar.appendChild(techCell);

  const searchCell = el('div', 'filter-cell grow');
  searchCell.appendChild(el('div', 'filter-label', 'SEARCH'));
  const input = el('input', 'filter-search');
  input.type = 'search';
  input.placeholder = 'Search subscriber, territory, account…';
  input.value = handlers.filters.search || '';
  input.dataset.filter = 'search';
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => handlers.onFilter('search', input.value), 250);
  });
  searchCell.appendChild(input);
  bar.appendChild(searchCell);

  const resetCell = el('div', 'filter-cell reset');
  const reset = el('button', 'filter-reset', 'Reset');
  reset.type = 'button';
  reset.addEventListener('click', handlers.onReset);
  resetCell.appendChild(reset);
  bar.appendChild(resetCell);

  return bar;
}

// ---------- Overview page ----------

const KPI_CARDS = [
  { key: 'gfpActual', title: 'GFP ACTUAL', sub: 'completed GFP', cls: 'gfp' },
  { key: 'gahActual', title: 'GAH ACTUAL', sub: 'completed GAH', cls: 'gah' },
  { key: 'target', title: 'TARGET', sub: 'monthly target', cls: 'target' },
  { key: 'achievement', title: 'ACHIEVEMENT', sub: 'actual vs target', cls: 'ach', isPercent: true },
  { key: 'dailyAverage', title: 'DAILY AVERAGE', sub: 'per day', cls: 'daily', isFloat: true }
];

function kpiCards(current) {
  const grid = el('section', 'kpi-grid');
  KPI_CARDS.forEach((card) => {
    const v = current.kpis[card.key];
    const box = el('article', 'kpi-card');
    box.appendChild(el('div', 'kpi-title', card.title));
    const value = card.isPercent ? pct1(v) : card.isFloat ? Number(v).toFixed(1) : int(v);
    box.appendChild(el('div', `kpi-value c-${card.cls}`, value));
    box.appendChild(el('div', 'kpi-sub', card.sub +
      (card.key === 'target' && !current.kpis.target ? ' (no targets fed)' : '')));
    grid.appendChild(box);
  });
  return grid;
}

function dcosWindowPanel(w) {
  const panel = el('div', 'panel');
  const title = w.name === 'MTD'
    ? 'MONTH TO DATE (MTD)'
    : `${w.name} — Day ${w.startDay}–${w.endDay}`;
  panel.appendChild(el('h3', 'panel-title', title));

  const wrap = el('div', 'dcos-flex');
  const table = el('table', 'dcos-table');
  const thead = el('thead');
  const hr = document.createElement('tr');
  ['KPI', 'Installed', 'Target', 'Ach', 'Var', 'Trend (vol)', 'Trend Ach', 'Req Daily'].forEach((h) => {
    hr.appendChild(el('th', null, h));
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  w.rows.forEach((row) => {
    const tr = el('tr', row.tech === 'Grand Total' ? 'grand' : null);
    const cells = [
      row.tech,
      int(row.installed),
      fmtTarget(row.target),
      pct1(row.achPct),
      fmtTarget(row.variance),
      row.trend === null ? '—' : int(row.trend),
      row.trendAch === null ? '—' : pct1(row.trendAch),
      fmtTarget(row.reqDaily)
    ];
    cells.forEach((c, i) => tr.appendChild(el('td', i === 0 ? 'name-cell' : null, c)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);

  const insights = el('div', 'insights-box');
  insights.appendChild(el('div', 'insights-title', `${w.name === 'MTD' ? 'MTD' : w.name.toUpperCase()} INSIGHTS`));
  w.insights.forEach((line) => {
    insights.appendChild(el('div', 'insights-line', line));
  });
  wrap.appendChild(insights);
  panel.appendChild(wrap);

  if (w.name === 'MTD' && w.avgDaily) {
    const avgs = el('div', 'avg-daily-line',
      `GFP AVG DAILY ${w.avgDaily.gfp.toFixed(2)} · GAH AVG DAILY ${w.avgDaily.gah.toFixed(2)}`);
    panel.appendChild(avgs);
  }
  return panel;
}

function chartPanel(title, chartKind, className) {
  const panel = el('article', 'panel');
  panel.appendChild(el('h3', 'panel-title', title));
  const box = el('div', `chart-box ${className || ''}`);
  box.dataset.chart = chartKind;
  panel.appendChild(box);
  return panel;
}

function overviewPage(current) {
  const page = el('section', 'page');
  page.dataset.page = 'overview';

  page.appendChild(kpiCards(current));

  const dcos = el('section', 'panel wide');
  dcos.appendChild(el('h2', 'section-title',
    'MONTH TO DATE — DCOS 1 / DCOS 2 / MTD'));
  dcos.appendChild(el('p', 'section-sub',
    `TARGET: All BDEs — GFP ${fmtTarget(current.kpis.gfpTarget)} · GAH ${fmtTarget(current.kpis.gahTarget)} = ${fmtTarget(current.kpis.target)} | DCOS 1 = 60% · DCOS 2 = 40%`));
  current.dcos.forEach((w) => dcos.appendChild(dcosWindowPanel(w)));
  page.appendChild(dcos);

  const bottom = el('section', 'two-col');
  bottom.appendChild(chartPanel('PERFORMANCE BY TERRITORY', 'territory', 'territory-box'));
  bottom.appendChild(chartPanel(`DAILY PERFORMANCE — ${current.monthLabel}`, 'daily', 'daily-box'));
  page.appendChild(bottom);

  return page;
}

// ---------- tables (BBSP / BDE, area, territory, agents, records) ----------

function targetsTable(map, actuals, labelCol, emptyHint) {
  const names = Object.keys(map);
  if (!names.length) {
    return el('p', 'table-empty', emptyHint);
  }
  const wrap = el('div', 'table-scroll');
  const table = el('table', 'data-table');
  const thead = el('thead');
  const hr = document.createElement('tr');
  [labelCol, 'GFP TARGET', 'GAH TARGET', 'TOTAL TARGET', 'ACTUAL (COMPLETED)', 'ACHIEVED'].forEach((h) => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  Object.entries(map)
    .sort(([, a], [, b]) => b.total - a.total)
    .forEach(([name, t], i) => {
      const tr = el('tr', i % 2 ? 'alt' : null);
      const actual = actuals?.[name] || 0;
      [
        name, int(t.gfp), int(t.gah), int(t.total), int(actual),
        t.total > 0 ? pct1(actual / t.total) : '—'
      ].forEach((c, j) => tr.appendChild(el('td', j === 0 ? 'name-cell' : null, c)));
      tbody.appendChild(tr);
    });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function shareTable(rows, labelCol, emptyHint) {
  if (!rows.length) return el('p', 'table-empty', emptyHint);
  const wrap = el('div', 'table-scroll');
  const table = el('table', 'data-table');
  const thead = el('thead');
  const hr = document.createElement('tr');
  [labelCol, 'ACTUAL (COMPLETED)', 'SHARE TARGET', 'PROGRESS'].forEach((h) => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach((row, i) => {
    const tr = el('tr', i % 2 ? 'alt' : null);
    const progress = row.target > 0 ? row.actual / row.target : 0;
    [
      row[labelCol] || 'BLANK', int(row.actual), int(row.target),
      row.target > 0 ? pct1(progress) : '—'
    ].forEach((c, j) => tr.appendChild(el('td', j === 0 ? 'name-cell' : null, c)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function agentsTable(rows) {
  if (!rows.length) return el('p', 'table-empty', 'No completed work orders in this view yet.');
  const wrap = el('div', 'table-scroll');
  const table = el('table', 'data-table');
  const thead = el('thead');
  const hr = document.createElement('tr');
  ['AGENT', 'BBSP', 'BDE', 'GFP', 'GAH', 'TOTAL'].forEach((h) => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  rows.forEach((row, i) => {
    const tr = el('tr', i % 2 ? 'alt' : null);
    [
      `${row.agentName}${row.agentCode ? ` (${row.agentCode})` : ''}`,
      row.bbsp || '—', row.bde || '—', int(row.gfp), int(row.gah), int(row.total)
    ].forEach((c, j) => tr.appendChild(el('td', j === 0 ? 'name-cell' : null, c)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function recordsTable(records) {
  if (!records.length) return el('p', 'table-empty', 'No records match the current filters.');
  const wrap = el('div', 'table-scroll');
  const table = el('table', 'data-table records-table');
  const columns = [
    ['JOB ORDER', (r) => r.jobOrder],
    ['RESULT', (r) => r.result],
    ['TECH', (r) => r.tech],
    ['SUBSCRIBER', (r) => r.subscriber],
    ['CUSTOMER ADDRESS', (r) => r.customerAddress],
    ['PLAN', (r) => r.planAmount],
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
  const hr = document.createElement('tr');
  columns.forEach(([h]) => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  records.forEach((record, i) => {
    const tr = el('tr', i % 2 ? 'alt' : null);
    columns.forEach(([label, get], j) => {
      const value = get(record);
      const td = el('td', j === 0 ? 'name-cell' : null, value || '—');
      if (label === 'STATUS' && String(value).toUpperCase() === 'COMPLETED') td.classList.add('good-value');
      if (label === 'RESULT' && String(value).toUpperCase() === 'NOT FOUND') td.classList.add('bad-value');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

// ---------- secondary pages ----------

function bbspPage(current) {
  const page = el('section', 'page');
  page.dataset.page = 'bbsp';
  page.appendChild(el('h2', 'page-heading', 'BBSP PERFORMANCE'));
  const bdePanel = el('div', 'panel wide');
  bdePanel.appendChild(el('h3', 'panel-title', 'BY BDE'));
  bdePanel.appendChild(targetsTable(current.bdeTargets, current.bdeActuals, 'BDE',
    'No TARGETS CSV fed yet — drag the TARGETS export onto this page.'));
  page.appendChild(bdePanel);
  const bbspPanel = el('div', 'panel wide');
  bbspPanel.appendChild(el('h3', 'panel-title', 'BY BBSP (partner stores)'));
  bbspPanel.appendChild(targetsTable(current.bbspTargets, current.bbspActuals, 'BBSP',
    'No BBSP TARGETS CSV fed yet — partner-store targets will appear here once fed.'));
  page.appendChild(bbspPanel);
  return page;
}

function simpleSharePage(id, title, rows, labelCol, emptyHint) {
  const page = el('section', 'page');
  page.dataset.page = id;
  page.appendChild(el('h2', 'page-heading', title));
  const chart = el('div', 'panel wide');
  chart.appendChild(el('h3', 'panel-title', `${title} — COMPLETED VS SHARE-DISTRIBUTED TARGET`));
  const box = el('div', 'chart-box territory-box');
  box.dataset.chart = id === 'byarea' ? 'area' : 'territory';
  chart.appendChild(box);
  page.appendChild(chart);
  const tablePanel = el('div', 'panel wide');
  tablePanel.appendChild(shareTable(rows, labelCol, emptyHint));
  page.appendChild(tablePanel);
  return page;
}

function recordsPage(current) {
  const page = el('section', 'page');
  page.dataset.page = 'records';
  page.appendChild(el('h2', 'page-heading', `ALL WORK ORDERS (${int(current.kpis.totalOrders)})`));
  const panel = el('div', 'panel wide');
  panel.appendChild(recordsTable(current.records));
  page.appendChild(panel);
  return page;
}

function agentsPage(current) {
  const page = el('section', 'page');
  page.dataset.page = 'agents';
  page.appendChild(el('h2', 'page-heading', 'AGENT PRODUCTIVITY — COMPLETED WORK ORDERS'));
  const panel = el('div', 'panel wide');
  panel.appendChild(agentsTable(current.agentProductivity));
  page.appendChild(panel);
  return page;
}

function vsPage(current, previous) {
  const page = el('section', 'page');
  page.dataset.page = 'vsmonth';

  if (!previous) {
    const empty = el('div', 'vs-empty');
    empty.appendChild(el('div', 'empty-title', 'No previous month fed yet'));
    empty.appendChild(el('div', 'empty-hint',
      'Export the PREVIOUS month\'s VALIDATION sheet as CSV and use Upload CSV (or drag it here). The site groups feeds by their own data month automatically.'));
    page.appendChild(empty);
    return page;
  }

  page.appendChild(el('h2', 'page-heading', `${current.monthLabel} vs ${previous.monthLabel}`));

  const grid = el('section', 'vs-grid');
  const d = (a, b) => a - b;
  [
    { label: 'GFP ACTUAL', key: 'gfpActual' },
    { label: 'GAH ACTUAL', key: 'gahActual' },
    { label: 'TOTAL COMPLETED', key: 'actual' },
    { label: 'TARGET', key: 'target' },
    { label: 'ACHIEVEMENT', key: 'achievement', pct: true }
  ].forEach((metric) => {
    const cur = current.kpis[metric.key];
    const prev = previous.kpis[metric.key];
    const diff = d(cur, prev);
    const card = el('article', 'vs-card');
    card.appendChild(el('div', 'vs-label', metric.label));
    const row = el('div', 'vs-values');
    row.appendChild(el('span', 'vs-now', metric.pct ? pct1(cur) : int(cur)));
    row.appendChild(el('span', 'vs-prev', `was ${metric.pct ? pct1(prev) : int(prev)}`));
    card.appendChild(row);
    const chip = el('span', `vs-chip ${diff === 0 ? 'flat' : diff > 0 ? 'better' : 'worse'}`);
    chip.textContent = diff === 0 ? 'no change' : `${diff > 0 ? '▲ +' : '▼ −'}${int(Math.abs(diff))}`;
    card.appendChild(chip);
    grid.appendChild(card);
  });
  page.appendChild(grid);

  const panel = el('article', 'panel wide');
  panel.appendChild(el('h3', 'panel-title', 'DAILY PACING, MONTH VS MONTH'));
  const box = el('div', 'chart-box daily-box');
  box.dataset.chart = 'vs-daily';
  panel.appendChild(box);
  page.appendChild(panel);

  return page;
}

// ---------- root ----------

export function renderDashboard(container, bundle, handlers) {
  const { current, previous, activePage } = bundle;
  const root = el('div', 'app');

  root.appendChild(topBar(bundle, handlers.meta));

  const body = el('div', 'app-body');
  body.appendChild(sideBar(activePage));

  const main = el('main', 'content');
  main.appendChild(filterBar(current, handlers.pool, handlers));
  main.appendChild(switchPage(bundle));
  main.appendChild(el('footer', 'page-footer',
    'EBISU Sales Report • Fed by your VALIDATION, TARGETS, BBSP TARGETS and AGENT POOL CSV exports'));
  body.appendChild(main);

  const uploadInput = el('input');
  uploadInput.type = 'file';
  uploadInput.accept = '.csv';
  uploadInput.multiple = true;
  uploadInput.className = 'visually-hidden';
  uploadInput.id = 'csv-input';
  uploadInput.addEventListener('change', () => handlers.onFiles(uploadInput.files));
  main.appendChild(uploadInput);

  root.appendChild(body);
  container.appendChild(root);

  root.querySelector('#reload-data')?.addEventListener('click', handlers.onReload);
  root.querySelector('#upload-csv')?.addEventListener('click', () => uploadInput.click());
  const monthSelect = root.querySelector('#month-badge');
  monthSelect?.addEventListener('change', () => handlers.onMonth(monthSelect.value));

  wireSidebar(root, activePage, handlers.onPage);
  mountCharts(main, bundle);
}

function switchPage(bundle) {
  const pages = { overview: overviewPage, bbsp: bbspPage, records: recordsPage, agents: agentsPage };
  const { current, previous, activePage } = bundle;
  let page;
  if (activePage === 'vsmonth') {
    page = vsPage(current, previous);
  } else if (activePage === 'byarea') {
    page = simpleSharePage('byarea', 'BY AREA', current.areaPerformance, 'area', 'No completed work orders with an area in this view.');
  } else if (activePage === 'byterritory') {
    page = simpleSharePage('byterritory', 'BY TERRITORY', current.territoryPerformance, 'territory', 'No completed work orders with a territory in this view.');
  } else {
    page = (pages[activePage] || overviewPage)(current);
  }
  page.classList.add('active');
  return page;
}

function wireSidebar(root, activePage, onPage) {
  root.querySelectorAll('.side-item').forEach((item) => {
    item.addEventListener('click', () => onPage(item.dataset.page));
  });
  void activePage;
}
