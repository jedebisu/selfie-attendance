import './styles.css';
import { parseCsv, computeDashboard } from './compute.js';
import { renderDashboard } from './render.js';

const app = document.getElementById('app');
const DEFAULT_CSV_URL = 'data/validation.csv';

// Renders one fully-fed dashboard pass: parse -> compute -> paint.
export async function renderFromCsv(text, fileName) {
  try {
    const result = computeDashboard(parseCsv(text));
    app.innerHTML = '';

    const banner = document.createElement('div');
    banner.className = 'feed-banner';
    banner.textContent = `Fed by ${fileName}`;
    app.appendChild(banner);

    renderDashboard(app, result, { fileName });
  } catch (error) {
    console.error(`Could not build the report from ${fileName}:`, error);
    showEmptyState(
      'Could not read that file',
      `"${fileName}" is not a VALIDATION sheet export. Export it again with File ▸ Download ▸ Comma-separated values and confirm the columns start with JOB ORDER, RESULT, SUBSCRIBER...`
    );
  }
}

function showEmptyState(message, hint) {
  app.innerHTML = '';
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.innerHTML = `<div class="empty-title">${message}</div><div class="empty-hint">${hint}</div>`;
  app.appendChild(empty);
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
    const response = await fetch(DEFAULT_CSV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) throw new Error('empty data file');
    await renderFromCsv(text, 'validation.csv');
  } catch (error) {
    showEmptyState(
      'No data loaded yet',
      'Export your VALIDATION sheet (File ▸ Download ▸ Comma-separated values) and drop the file anywhere on this page.'
    );
    console.info('No default CSV loaded:', error.message);
  }
}

// Drag a new VALIDATION export onto the page to preview it without
// touches to the repo data file.
let dragDepth = 0;
let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'drop-overlay';
  overlay.textContent = 'Drop your VALIDATION CSV to feed the report';
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

  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;

  readFile(file)
    .then((text) => renderFromCsv(text, file.name))
    .catch((error) => {
      console.error('Could not read the dropped CSV:', error);
      showEmptyState('Could not read that file', 'Make sure it is a Comma-separated values (.csv) export of the VALIDATION sheet.');
    });
});

boot();
