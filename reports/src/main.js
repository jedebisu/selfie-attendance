import './styles.css';
import {
  parseCsv,
  parseBdeTargets,
  parseBspbTargets,
  parseAgentPool,
  computeDashboard,
  detectFeedType
} from './compute.js';
import { renderDashboard, PAGES } from './render.js';

const app = document.getElementById('app');
const FEEDS = [
  { url: 'data/validation.csv', required: true },
  // Optional second month (e.g. last month's export) — same routing, keyed by
  // its own data month; powers the Month-vs-Month page from files as well.
  { url: 'data/validation-previous.csv', required: false },
  { url: 'data/bde-targets.csv', required: false },
  { url: 'data/bbsp-targets.csv', required: false },
  { url: 'data/agent-pool.csv', required: false }
];

// ---- state ----
// VALIDATION months are keyed by their own data month (from LAST UPDATE), so
// any number of fed months can coexist; Target/pool feeds are single-slot.
const state = {
  validations: new Map(), // monthLabel -> { rows, asOf, fileName }
  bdeTargets: null,
  bspbTargets: null,
  agentPool: null,
  selectedMonth: null, // null = newest fed month
  activePage: (() => {
    const hash = String(window.location.hash || '').replace('#', '');
    return PAGES.some((p) => p.id === hash) ? hash : 'overview';
  })(),
  filters: { bde: '', bbsp: '', tech: '', search: '' }
};

function showEmptyState(message, hint) {
  app.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.appendChild(Object.assign(document.createElement('div'), { className: 'empty-title', textContent: message }));
  empty.appendChild(Object.assign(document.createElement('div'), { className: 'empty-hint', textContent: hint }));
  app.appendChild(empty);
}

function normalizeHeaderRow(rows) {
  return Array.isArray(rows) && rows.length ? rows[0] : [];
}

function applyFeed(type, rows, fileName) {
  const norm = (v) => String(v ?? '').trim().toUpperCase();
  if (type === 'validation') {
    // month key from the row data itself (max LAST UPDATE)
    const H = normalizeHeaderRow(rows).map((h) => String(h).trim().toLowerCase().replace(/[\s_-]+/g, ''));
    const LU = H.indexOf('lastupdate');
    let best = null;
    if (LU !== -1) {
      for (let i = 1; i < rows.length; i++) {
        const raw = rows[i][LU];
        const m = norm(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (!m) continue;
        const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        const date = new Date(year, Number(m[1]) - 1, Number(m[2]));
        if (!best || date > best) best = date;
      }
    }
    if (!best) throw new Error('no dates found in this VALIDATION export');
    const label = best.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase();
    state.validations.set(label, { rows, asOf: best, fileName });
    if (!state.selectedMonth) state.selectedMonth = label;
    return `VALIDATION for ${label}`;
  }
  if (type === 'bdeTargets') { state.bdeTargets = parseBdeTargets(rows); return 'TARGETS'; }
  if (type === 'bspbTargets') { state.bspbTargets = parseBspbTargets(rows); return 'BBSP TARGETS'; }
  if (type === 'agentPool') { state.agentPool = parseAgentPool(rows); return 'AGENT POOL'; }
  throw new Error('unknown feed type');
}

function sortedMonths() {
  return [...state.validations.entries()]
    .sort(([, a], [, b]) => b.asOf.getTime() - a.asOf.getTime());
}

function sourceNotes() {
  const notes = sortedMonths().map(([label, feed]) => `${feed.fileName} (${label})`);
  if (state.bdeTargets) notes.push('TARGETS');
  if (state.bspbTargets) notes.push('BBSP TARGETS');
  if (state.agentPool) notes.push('AGENT POOL');
  return notes;
}

function rebuild() {
  const months = sortedMonths(); // newest first
  if (!months.length) {
    showEmptyState(
      'No VALIDATION data yet',
      'Feed the site with Upload CSV (top right) or by dragging a VALIDATION sheet export onto this page — plus the TARGETS, BBSP TARGETS and AGENT POOL exports for the target tables (all optional).'
    );
    return;
  }

  state.filters = {
    ...state.filters,
    bde: state.agentPool?.bdes.includes(state.filters.bde) ? state.filters.bde : '',
    bbsp: state.agentPool?.bbsps.includes(state.filters.bbsp) ? state.filters.bbsp : ''
  };

  const currentLabel = state.selectedMonth && state.validations.has(state.selectedMonth)
    ? state.selectedMonth
    : months[0][0];
  const extras = {
    bdeTargets: state.bdeTargets || undefined,
    bspbTargets: state.bspbTargets || undefined,
    agentPool: state.agentPool || undefined
  };

  const currentIndex = months.findIndex(([label]) => label === currentLabel);
  const currentEntry = months[currentIndex];
  const prevEntry = currentIndex + 1 < months.length ? months[currentIndex + 1] : null;

  const previous = prevEntry
    ? computeDashboard(prevEntry[1].rows, extras, state.filters)
    : null;
  const current = computeDashboard(currentEntry[1].rows, { ...extras, prev: previous }, state.filters);

  const bundle = {
    current,
    previous,
    activePage: state.activePage,
    previousLabel: prevEntry ? prevEntry[0] : null
  };

  const handlers = {
    filters: state.filters,
    pool: state.agentPool || { bdes: [], bbsps: [] },
    meta: { monthOptions: months.map(([label]) => label) },
    onFilter: (key, value) => {
      state.filters[key] = value;
      rebuild();
    },
    onReset: () => {
      state.filters = { bde: '', bbsp: '', tech: '', search: '' };
      rebuild();
    },
    onPage: (page) => {
      state.activePage = page;
      rebuild();
    },
    onReload: () => {
      state.validations.clear();
      state.bdeTargets = null;
      state.bspbTargets = null;
      state.agentPool = null;
      state.selectedMonth = null;
      boot();
    },
    onFiles: async (fileList) => {
      await consumeFiles(Array.from(fileList || []));
    },
    onMonth: (label) => {
      if (state.validations.has(label)) {
        state.selectedMonth = label;
        rebuild();
      }
    }
  };

  app.innerHTML = '';
  renderDashboard(app, bundle, handlers);

  const bannerText = sourceNotes().join(' · ');
  const banner = document.createElement('div');
  banner.className = 'feed-banner';
  banner.textContent = `FED BY: ${bannerText}`;
  app.appendChild(banner);
}

async function consumeFile(text, fileName) {
  const rows = parseCsv(text);
  const type = detectFeedType(rows[0]);
  if (!type) throw new Error('unrecognized header row');
  applyFeed(type, rows, fileName);
  rebuild();
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

async function consumeFiles(files) {
  if (!files.length) return;
  const unapplied = [];
  for (const file of files) {
    try {
      await consumeFile(await readFile(file), file.name);
    } catch (error) {
      console.error(`Could not use ${file.name}:`, error);
      unapplied.push(file.name);
    }
  }
  if (unapplied.length) {
    showEmptyState(
      'Some files could not be used',
      `Not recognized as a VALIDATION, TARGETS, BBSP TARGETS, or AGENT POOL export: ${unapplied.join(', ')}. Export each tab with File ▸ Download ▸ Comma-separated values.`
    );
  }
}

async function boot() {
  try {
    for (const feed of FEEDS) {
      let response;
      try {
        response = await fetch(feed.url);
      } catch (networkError) {
        if (feed.required) throw networkError;
        continue; // optional feed not present — that is fine
      }
      if (!response.ok) {
        if (feed.required) throw new Error(`HTTP ${response.status} for ${feed.url}`);
        continue;
      }
      const rows = parseCsv(await response.text());
      // Route every file by its header shape; the filename is only a hint.
      const type = detectFeedType(rows[0]);
      if (!type) {
        if (feed.required) throw new Error('The default VALIDATION file has unrecognized columns.');
        console.warn(`Skipping unrecognized default feed: ${feed.url}`);
        continue;
      }
      applyFeed(type, rows, feed.url.replace('data/', ''));
    }
  } catch (error) {
    showEmptyState(
      'Data could not be loaded',
      'Check that data/validation.csv is a VALIDATION sheet export (File ▸ Download ▸ Comma-separated values). You can also drag new CSV files straight onto this page.'
    );
    console.error('Boot failed:', error);
    return;
  }
  rebuild();
}

// ---- drag & drop: one or many files, each routed by its header shape ----

let dragDepth = 0;
let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.textContent = 'Drop your CSV exports (VALIDATION, TARGETS, BBSP TARGETS, AGENT POOL)';
  document.body.appendChild(overlay);
  return overlay;
}

window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  ensureOverlay().classList.add('visible');
});

window.addEventListener('dragover', (event) => event.preventDefault());

window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0 && overlay) overlay.classList.remove('visible');
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  if (overlay) overlay.classList.remove('visible');
  const files = Array.from(event.dataTransfer?.files || []);
  if (files.length) consumeFiles(files);
});

boot();
