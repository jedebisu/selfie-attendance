// Chart mounting for EBISU Sales Report v2 (Chart.js).
// Reuses the dashboard-palette CSS variables and mirrors the target-driven
// visuals: achievement gauge, GFP/GAH mix, daily pacing bars, territory
// performance with share-distributed targets, and month-vs-month bars.
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
  gfp: '#D6336C', gah: '#1971C2', other: '#ADB5BD', purple: '#6741D9',
  green: '#0CA678', red: '#E03131', gold: '#E8A400',
  text: '#1B2A41', muted: '#6B7A99', border: '#DDE6F5', track: '#E4EAF5',
  target: '#B9C6E0'
};

// Re-feeding clears the DOM; destroy old instances so the registry
// never accumulates dead charts across feeds.
const liveCharts = [];

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: reducedMotion() ? false : undefined,
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

// ---- achievement gauge (semicircle + centered %) ----
function gauge(slot, achievement) {
  const pct = Math.max(0, Math.min(1, achievement));
  const shown = Math.round(pct * 100);
  const zone = shown >= 100 ? C.green : shown >= 80 ? C.green : shown >= 50 ? C.gold : C.red;
  const data = shown === 0 ? 0.1 : shown; // tiny sliver keeps the arc visible at 0
  liveCharts.push(new Chart(makeCanvas(slot, `Achievement gauge: ${shown}% of 100%`), {
    type: 'doughnut',
    data: {
      labels: ['Achieved', 'Remaining'],
      datasets: [{
        data: [data, 100 - shown],
        backgroundColor: [zone, C.track],
        borderWidth: 0,
        circumference: 180,
        rotation: 270
      }]
    },
    options: baseOptions({
      cutout: '72%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } }
    })
  }));
  const value = document.createElement('div');
  value.className = 'gauge-value';
  value.textContent = `${shown}%`;
  slot.classList.add('gauge-slot');
  slot.appendChild(value);
}

// ---- GFP / GAH / other mix ----
function mixDonut(slot, records) {
  const counts = { GFP: 0, GAH: 0, OTHER: 0 };
  records.forEach((r) => { counts[r.tech || 'OTHER'] += 1; });
  const labels = Object.keys(counts).filter((k) => counts[k] > 0 && !(k === 'OTHER' && counts.OTHER === 0));
  if (!labels.length) return emptyChart(slot, 'No work orders in this feed.');
  const colors = { GFP: C.gfp, GAH: C.gah, OTHER: C.other };
  liveCharts.push(new Chart(makeCanvas(slot,
    `Work order mix: ${counts.GFP} GFP, ${counts.GAH} GAH${counts.OTHER ? `, ${counts.OTHER} unclassified` : ''}`), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: labels.map((k) => counts[k]),
        backgroundColor: labels.map((k) => colors[k]),
        borderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: baseOptions({
      cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { color: C.text, font: { size: 12 } } }
      }
    })
  }));
}

// ---- daily pacing bars (completed per day of month) ----
function dailyBars(slot, dailyPerformance, color = C.purple) {
  if (!dailyPerformance.length) return emptyChart(slot, 'No completed work orders yet.');
  liveCharts.push(new Chart(makeCanvas(slot, 'Bar chart of completed work orders by day of month'), {
    type: 'bar',
    data: {
      labels: dailyPerformance.map((d) => d.day),
      datasets: [{
        label: 'Completed',
        data: dailyPerformance.map((d) => d.actual),
        backgroundColor: color,
        borderRadius: 3,
        categoryPercentage: 0.8
      }]
    },
    options: baseOptions({
      scales: {
        y: { beginAtZero: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: C.text } }
      },
      plugins: { legend: { display: false } }
    })
  }));
}

// ---- territory performance (actual bars vs distributed target bars) ----
function territoryBars(slot, territoryPerformance) {
  if (!territoryPerformance.length) return emptyChart(slot, 'No completed work orders to chart.');
  liveCharts.push(new Chart(makeCanvas(slot, 'Territory performance: actual completions vs distributed targets'), {
    type: 'bar',
    data: {
      labels: territoryPerformance.map((t) => t.territory),
      datasets: [
        {
          label: 'Actual',
          data: territoryPerformance.map((t) => t.actual),
          backgroundColor: C.gah,
          borderRadius: 3
        },
        {
          label: 'Target (shared)',
          data: territoryPerformance.map((t) => t.target),
          backgroundColor: C.target,
          borderRadius: 3
        }
      ]
    },
    options: baseOptions({
      scales: {
        y: { beginAtZero: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: C.text } }
      },
      plugins: { legend: { position: 'bottom', labels: { color: C.text, font: { size: 12 } } } }
    })
  }));
}

// ---- month vs month: side-by-side daily completions ----
function vsDailyBars(slot, currentDaily, previousDaily) {
  const dayMap = (entries) => {
    const map = {};
    entries.forEach((d) => { map[d.day] = d.actual; });
    return map;
  };
  const cur = dayMap(currentDaily);
  const prev = dayMap(previousDaily);
  const days = Array.from(new Set([...Object.keys(cur), ...Object.keys(prev)]))
    .sort((a, b) => Number(a) - Number(b));

  liveCharts.push(new Chart(makeCanvas(slot, 'Grouped bar chart comparing completions by day of month between the two months'), {
    type: 'bar',
    data: {
      labels: days.map((d) => `${d}`),
      datasets: [
        {
          label: 'This month',
          data: days.map((d) => cur[d] || 0),
          backgroundColor: C.purple,
          borderRadius: 2
        },
        {
          label: 'Last month',
          data: days.map((d) => prev[d] || 0),
          backgroundColor: C.target,
          borderRadius: 2
        }
      ]
    },
    options: baseOptions({
      scales: {
        y: { beginAtZero: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: C.text } }
      },
      plugins: { legend: { position: 'bottom', labels: { color: C.text, font: { size: 12 } } } }
    })
  }));
}

export function mountCharts(root, bundle) {
  destroyCharts();
  const { current, previous } = bundle;
  root.querySelectorAll('[data-chart]').forEach((slot) => {
    const kind = slot.dataset.chart;
    if (kind === 'gauge') gauge(slot, current.kpis.achievement);
    if (kind === 'donut') mixDonut(slot, current.records);
    if (kind === 'daily') dailyBars(slot, current.dailyPerformance);
    if (kind === 'territory') territoryBars(slot, current.territoryPerformance);
    if (kind === 'area') territoryBars(slot, current.areaPerformance);
    if (kind === 'vs-daily') {
      if (previous && previous.dailyPerformance.length) {
        vsDailyBars(slot, current.dailyPerformance, previous.dailyPerformance);
      } else {
        emptyChart(slot, 'Feed a previous month\'s VALIDATION export to compare daily pacing.');
      }
    }
  });
}
