// Chart mounting for EBISU Sales Report v2 (Chart.js).
// Reuses the dashboard-palette CSS variables and mirrors the target-driven
// visuals: achievement gauge, GFP/GAH mix, daily pacing bars, territory
// performance with share-distributed targets, and month-vs-month bars.
import {
  Chart,
  DoughnutController,
  BarController,
  LineController,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  ArcElement,
  BarElement,
  LineElement,
  PointElement
} from 'chart.js';

Chart.register(
  DoughnutController, BarController, LineController,
  CategoryScale, LinearScale,
  Legend, Tooltip, ArcElement, BarElement, LineElement, PointElement
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
function territoryBars(slot, rows, labelKey = 'territory') {
  if (!rows.length) return emptyChart(slot, 'No completed work orders to chart.');
  liveCharts.push(new Chart(makeCanvas(slot, 'Performance: actual completions vs distributed targets'), {
    type: 'bar',
    data: {
      labels: rows.map((t) => t[labelKey]),
      datasets: [
        {
          label: 'Actual',
          data: rows.map((t) => t.actual),
          backgroundColor: C.gah,
          borderRadius: 3
        },
        {
          label: 'Target (shared)',
          data: rows.map((t) => t.target),
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

// ---- pace: cumulative completions vs linear pro-rata target (dashed) ----
function paceLine(slot, pace) {
  if (!pace || !pace.days.length) return emptyChart(slot, 'Feed a VALIDATION export to see the pace.');
  liveCharts.push(new Chart(makeCanvas(slot, 'Line chart: cumulative completed work orders against the linear month target pace'), {
    type: 'line',
    data: {
      labels: pace.days,
      datasets: [
        {
          label: 'Actual (cumulative)',
          data: pace.actual,
          borderColor: C.gold,
          backgroundColor: C.gold,
          fill: false,
          tension: 0.25,
          pointRadius: 0,
          borderWidth: 2
        },
        {
          label: 'Target pace',
          data: pace.targetPace,
          borderColor: C.muted,
          backgroundColor: C.muted,
          borderDash: [6, 4],
          fill: false,
          tension: 0,
          pointRadius: 0,
          borderWidth: 2
        }
      ]
    },
    options: baseOptions({
      scales: {
        y: { beginAtZero: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: C.muted, maxTicksLimit: 31, font: { size: 10 } } }
      },
      plugins: { legend: { position: 'bottom', labels: { color: C.text, font: { size: 12 } } } }
    })
  }));
}

// ---- week-on-week: this month vs the previous fed month, per W1..W4 ----
function weeklyBars(slot, currentWeekly, previousWeekly) {
  if (!currentWeekly || !currentWeekly.length) {
    return emptyChart(slot, 'Feed a VALIDATION export to see the weekly rhythm.');
  }
  const labels = currentWeekly.map((w) => w.week);
  const datasets = [
    {
      label: 'This month',
      data: currentWeekly.map((w) => w.actual),
      backgroundColor: C.gold,
      borderRadius: 3
    }
  ];
  if (previousWeekly && previousWeekly.length) {
    datasets.push({
      label: 'Previous month',
      data: labels.map((week) => previousWeekly.find((w) => w.week === week)?.actual || 0),
      backgroundColor: C.gah,
      borderRadius: 3
    });
  }
  liveCharts.push(new Chart(makeCanvas(slot, 'Bar chart of completed work orders per week, this month and the previous fed month'), {
    type: 'bar',
    data: { labels, datasets },
    options: baseOptions({
      scales: {
        y: { beginAtZero: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } },
        x: { grid: { display: false }, ticks: { color: C.text } }
      },
      plugins: { legend: { position: 'bottom', labels: { color: C.text, font: { size: 12 } } } }
    })
  }));
}

// ---- agent comparison: horizontal bars, longest (top agent) on top ----
function agentBars(slot, rows) {
  if (!rows.length) return emptyChart(slot, 'No completed work orders in this view yet.');
  const compose = (a) => (a.agentName || a.agentCode || '—') + (a.agentCode ? ` (${a.agentCode})` : '');
  // rows arrive sorted most->least; reverse so the top agent renders on top
  const ordered = [...rows].reverse();
  liveCharts.push(new Chart(makeCanvas(slot, 'Horizontal bar chart comparing completed work orders per agent'), {
    type: 'bar',
    data: {
      labels: ordered.map(compose),
      datasets: [{
        label: 'Completed',
        data: ordered.map((a) => a.total),
        backgroundColor: C.purple,
        borderRadius: 3
      }]
    },
    options: baseOptions({
      indexAxis: 'y',
      scales: {
        y: { grid: { display: false }, ticks: { color: C.text, font: { size: 10 } } },
        x: { beginAtZero: true, grid: { color: C.border }, ticks: { color: C.muted, precision: 0 } }
      },
      plugins: { legend: { display: false } }
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
    if (kind === 'area') territoryBars(slot, current.areaPerformance, 'area');
    if (kind === 'pace') paceLine(slot, current.pace);
    if (kind === 'weekly') weeklyBars(slot, current.weekly, previous?.weekly);
    if (kind === 'agents') agentBars(slot, current.agentProductivity);
    if (kind === 'vs-daily') {
      if (previous && previous.dailyPerformance.length) {
        vsDailyBars(slot, current.dailyPerformance, previous.dailyPerformance);
      } else {
        emptyChart(slot, 'Feed a previous month\'s VALIDATION export to compare daily pacing.');
      }
    }
  });
}
