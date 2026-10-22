import './styles.css';
import {
  parseCsv,
  parseBdeTargets,
  parseBspbTargets,
  parseAgentPool,
  computeDashboard,
  detectFeedType
} from './compute.js';
import { renderDashboard } from './render.js';

const app = document.getElementById('app');
const FEEDS = [
  { url: 'data/validation.csv', type: 'validation', required: true },
  { url: 'data/bde-targets.csv', type: 'bdeTargets', required: false },
  { url: 'data/bbsp-targets.csv', type: 'bspbTargets', required: false },
  { url: 'data/agent-pool.csv', type: 'agentPool', required: false }
];

// State: VALIDATION months are keyed by their own data month so the
// "vs LAST MONTH" view can compare the newest fed month against the
// previous one. Target/pool feeds are single-slot overlays.
const state = {
  validations: new Map(), // monthLabel -> { rows, fileName }
  bdeTargets: null,
  bspbTargets: null,
  agentPool: null
};

function showEmptyState(message, hint) {
  app.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = '';
  const title = document.createElement('div');
  title.className = 'empty-title';
  title.textContent = message;
  const hintEl = document.createElement('div');
  hintEl.className = 'empty-hint';
  hintEl.textContent = hint;
  empty.appendChild(title);
  empty.appendChild(hintEl);
  app.appendChild(empty);
}

function monthLabelOf(rows) {
  return computeDashboard(rows).monthLabel;
}

function applyFeed(type, rows, fileName) {
  if (type === 'validation') {
    const month = monthLabelOf(rows);
    if (!month) throw new Error('no dates in this VALIDATION export');
    state.validations.set(month, { rows, fileName });
    return `VALIDATION for ${month}`;
  }
  if (type === 'bdeTargets') { state.bdeTargets = parseBdeTargets(rows); return 'TARGETS'; }
  if (type === 'bspbTargets') { state.bspbTargets = parseBspbTargets(rows); return 'BBSP TARGETS'; }
  if (type === 'agentPool') { state.agentPool = parseAgentPool(rows); return 'AGENT POOL'; }
  return null;
}

/** Sort VALIDATION months newest-first by their data date (not string compare). */
function sortedMonths() {
  const labeled = [];
  for (const [label, feed] of state.validations) {
    const asOf = computeDashboard(feed.rows).dataAsOf;
    labeled.push({ label, asOf, feed });
  }
  labeled.sort((a, b) => (b.asOf?.getTime() || 0) - (a.asOf?.getTime() || 0));
  return labeled;
}

function rebuild(sourceNotes) {
  const months = sortedMonths();
  if (months.length === 0) {
    showEmptyState(
      'No VALIDATION data yet',
      'Feed the site by dragging a VALIDATION sheet export (CSV) onto this page — plus the TARGETS, BBSP TARGETS and AGENT POOL exports for the target tables (all optional).'
    );
    return;
  }

  const extras = {
    bdeTargets: state.bdeTargets,
    bspbTargets: state.bspbTargets,
    agentPool: state.agentPool
  };

  const current = computeDashboard(months[0].feed.rows, extras);
  const previous = months[1] ? computeDashboard(months[1].feed.rows, extras) : null;

  app.innerHTML = '';
  if (sourceNotes && sourceNotes.length) {
    const banner = document.createElement('div');
    banner.className = 'feed-banner';
    banner.textContent = `Fed by: ${sourceNotes.join(' · ')}`;
    app.appendChild(banner);
  }
  renderDashboard(app, { current, previous, monthCount: months.length });
}

async function renderFromCsv(text, fileName) {
  const rows = parseCsv(text);
  const type = detectFeedType(rows[0]);
  if (!type) throw new Error('unrecognized header row');
  applyFeed(type, rows, fileName);
  const notes = [...state.validations.entries()].map(([month, feed]) => `${feed.fileName} (${month})`);
  if (state.bdeTargets) notes.push('TARGETS');
  if (state.bspbTargets) notes.push('BBSP TARGETS');
  if (state.agentPool) notes.push('AGENT POOL');
  rebuild(notes);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
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

  const notes = [...state.validations.entries()].map(([month, feed]) => `${feed.fileName} (${month})`);
  if (state.bdeTargets) notes.push('TARGETS');
  if (state.bspbTargets) notes.push('BBSP TARGETS');
  if (state.agentPool) notes.push('AGENT POOL');
  rebuild(notes);
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

window.addEventListener('drop', async (event) => {
  event.preventDefault();
  dragDepth = 0;
  if (overlay) overlay.classList.remove('visible');

  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;

  const unapplied = [];
  for (const file of files) {
    try {
      await renderFromCsv(await readFile(file), file.name);
    } catch (error) {
      console.error(`Could not use ${file.name}:`, error);
      unapplied.push(file.name);
    }
  }

  if (unapplied.length === files.length) {
    showEmptyState(
      'Could not use those files',
      'None of the dropped files matched a VALIDATION, TARGETS, BBSP TARGETS, or AGENT POOL export. Export each tab with File ▸ Download ▸ Comma-separated values.'
    );
  }
});

boot();
