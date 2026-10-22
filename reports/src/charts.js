// Chart mounting for EBISU Sales Report (Chart.js).
// Mirrors the Apps Script dashboard charts: GFP/GAH donut, match-rate gauge,
// four category breakdowns, and a stacked top-agents bar.
import {
  Chart,
  DoughnutController,
  BarController,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  ArcElement,
  BarElement
} from 'chart.js';

Chart.register(
  DoughnutController, BarController,
  CategoryScale, LinearScale,
  Legend, Tooltip, ArcElement, BarElement
);

const C = {
  gfp: '#D6336C', gah: '#1971C2', purple: '#6741D9', green: '#0CA678',
  red: '#E03131', gold: '#E8A400', text: '#1B2A41', muted: '#6B7A99',
  border: '#DDE6F5', track: '#E4EAF5'
};

// Re-feeding a CSV clears the DOM; give the old Chart.js instances a proper
// destroy so the registry never accumulates dead ones across feeds.
const liveCharts = [];

function chartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : undefined,
    ...extra
  };
}

let canvasSeq = 0;
function makeCanvas(slot, ariaLabel) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', ariaLabel);
  slot.appendChild(canvas);
  return canvas;
}

function destroyCharts() {
  while (liveCharts.length) {
    const instance = liveCharts.pop();
    try { instance.destroy(); } catch (error) { console.warn('chart cleanup failed', error); }
  }
}

function emptyChart(slot, message) {
  const note = document.createElement('div');
  note.className = 'chart-empty';
  note.textContent = message;
  slot.appendChild(note);
}

// ---- GFP vs GAH donut ----
function donut(slot, result) {
  if (result.total === 0) return emptyChart(slot, 'No GFP or GAH work orders in this feed.');
  liveCharts.push(new Chart(makeCanvas(slot, `GFP versus GAH mix: ${result.gfp} GFP and ${result.gah} GAH work orders`), {
    type: 'doughnut',
    data: {
      labels: ['GFP', 'GAH'],
      datasets: [{
        data: [result.gfp, result.gah],
        backgroundColor: [C.gfp, C.gah],
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: chartOptions({
      cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { color: C.text, font: { size: 12 } } },
        tooltip: { enabled: true }
      }
    })
  }));
}

// ---- Match rate gauge (semicircle with live % in the middle) ----
function gauge(slot, result) {
  const pct = Math.round(result.matchRate * 100);
  const zoneColor = pct >= 80 ? C.green : pct >= 50 ? C.gold : C.red;
  liveCharts.push(new Chart(makeCanvas(slot, `Match rate gauge: ${pct}% of 100%`), {
    type: 'doughnut',
    data: {
      labels: ['Matched', 'Remaining'],
      datasets: [{
        data: [pct, 100 - pct],
        backgroundColor: [zoneColor, C.track],
        borderWidth: 0,
        circumference: 180,
        rotation: 270
      }]
    },
    options: chartOptions({
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } }
    })
  }));

  const value = document.createElement('div');
  value.className = 'gauge-value';
  value.textContent = `${pct}%`;
  slot.classList.add('gauge-slot');
  slot.appendChild(value);
}

// ---- Category breakdowns ----
function categoryChart(slot, title, entries, color, axis, ariaLabel) {
  if (!entries.length) return emptyChart(slot, `Nothing to chart for ${title.toLowerCase()}.`);
  const TOP_N = 8;
  const shown = entries.slice(0, TOP_N);
  const axisOptions = axis === 'y'
    ? { indexAxis: 'y', scales: { x: { grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } }, y: { grid: { display: false }, ticks: { color: C.text } } } }
    : { indexAxis: 'x', scales: { y: { beginAtZero: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } }, x: { grid: { display: false }, ticks: { color: C.text, maxRotation: 40 } } } };

  liveCharts.push(new Chart(makeCanvas(slot, ariaLabel), {
    type: 'bar',
    data: {
      labels: shown.map((entry) => entry.label),
      datasets: [{
        data: shown.map((entry) => entry.count),
        backgroundColor: color,
        borderRadius: 3,
        categoryPercentage: 0.72
      }]
    },
    options: chartOptions({
      ...axisOptions,
      plugins: { legend: { display: false }, tooltip: { enabled: true } }
    })
  }));
}

// ---- Top agents stacked bar ----
function stackedAgents(slot, agents) {
  if (!agents.length) return emptyChart(slot, 'No agent data in this feed.');
  liveCharts.push(new Chart(makeCanvas(slot, 'Top agents stacked bar of GFP and GAH work orders'), {
    type: 'bar',
    data: {
      labels: agents.map((agent) => agent.agentName || agent.agentCode || 'Unknown'),
      datasets: [
        { label: 'GFP', data: agents.map((agent) => agent.gfp), backgroundColor: C.gfp, borderRadius: 2 },
        { label: 'GAH', data: agents.map((agent) => agent.gah), backgroundColor: C.gah, borderRadius: 2 }
      ]
    },
    options: chartOptions({
      indexAxis: 'y',
      scales: {
        x: { stacked: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } },
        y: { stacked: true, grid: { display: false }, ticks: { color: C.text } }
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: C.text, font: { size: 12 } } }
      }
    })
  }));
}

export function mountCharts(root, result) {
  destroyCharts();
  root.querySelectorAll('[data-chart]').forEach((slot) => {
    const kind = slot.dataset.chart;
    if (kind === 'donut') donut(slot, result);
    if (kind === 'gauge') gauge(slot, result);
    if (kind === 'status') categoryChart(slot, 'Status', result.statusCount, C.gfp, 'x', 'Work orders by status');
    if (kind === 'area') categoryChart(slot, 'Area', result.areaCount, C.gah, 'y', 'Work orders by area');
    if (kind === 'territory') categoryChart(slot, 'Territory', result.territoryCount, C.purple, 'y', 'Work orders by territory');
    if (kind === 'facility') categoryChart(slot, 'Facility', result.facilityCount, C.green, 'y', 'Work orders by facility');
    if (kind === 'agents') stackedAgents(slot, result.agents.slice(0, 10));
  });
}
