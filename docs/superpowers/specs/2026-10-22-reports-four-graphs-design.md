# EBISU Sales Report — Four New Graphs (design)

Date: 2026-10-22 · Status: approved by user in conversation · Size: small change
Branch: `feature/ebisu-sales-report` (continues the v3 app work)

## Intent

Add visual, at-a-glance views the deployed Apps Script dashboard lacks:
pacing, technology mix, agent comparison, and weekly rhythm. The site is
HR/management-facing (same audience as the deployed T6A dashboard); graphs
must answer "are we OK?" without reading tables.

## Goals

1. **Pace line** (Overview, new full-width panel below the DCOS panel):
   line chart of cumulative completed work orders by day of month, plus a
   dashed reference line = monthly total target × (day ÷ days in month).
   Above dashed = ahead of pace. Filter-aware, month-picker aware.
2. **GFP/GAHT mix donut** (Overview, narrow panel beside the pace line):
   completed split GFP (pink) / GAHT (blue) / other unclassified (gray).
   Existing unused `mixDonut` chart code is wired up rather than rewritten.
3. **Agent bar chart** (Agent Productivity page, above the table):
   horizontal bars (indexAxis y), one per agent, sorted most→least, gold
   bars. Includes agents the AGENT POOL can't attribute (pool gaps show
   "—" in the table; the chart only counts completions).
4. **Week-on-week panel** (Overview, below pace line + donut):
   - Grouped bar chart: completed count per week, this month (gold) next
     to the previous fed month (blue) when one is fed.
   - Table: week label, this month count, previous month count, and
     % change vs the previous week *within the same month* (W1–W2, W2–W3…);
     "—" for W1 or when no prior week exists.

## Non-goals / constraints

- Weekly bucket definition (user-approved): W1 = days 1–7, W2 = 8–14,
  W3 = 15–21, W4 = 22–month end. DCOS 1/2 windows and 60/40 shares stay
  untouched (those drive targets).
- No weekly *targets*: user chose the raw-count variant (bars + % table);
  pro-rata weekly targets were offered and declined.
- No new dependencies; reuse the existing Chart.js registration and the
  mount/destroy lifecycle in `chart.js`.
- Manual CSV feeds only; everything derives from VALIDATION rows already
  parsed (day-of-month from LAST UPDATE), so no new file formats.

## Approach (one sensible way, stated)

Extend the existing `charts.js` + `compute.js` infrastructure. Alternatives
rejected: a second charting library (bloat, no benefit), hand-rolled SVG
(loss of tooltips/responsiveness for free), D3 (overkill for bar/line).
Charts mount from `[data-chart]` slots exactly like the existing four kinds.

## Compute changes (with test pins)

- `pace`: `{ days: [1..N], actual: [cumulative], target: [cumulative] }`
  built from `dayCount` (all completed), monthly `target`, and the data
  month's real length (days in month from `dataAsOf`). N = days in month.
- `weekly`: `[{ week: 'W1', start, end, actual }, …]` bucketing days 1–31
  by the approved definition; counts come from `dayCount`.
- `weekly` for the previous month arrives via the existing `prev` pattern:
  the previous month's dashboard result already carries its own `weekly`;
  the render layer pairs them by week label.
- Tests: pace cumulative math (incl. short months), week bucket edges
  (day 8 → W2, day 22 → W4, W4 ends at month end), % change helper,
  previous-month weekly presence. Tests go 31 → ~38.

## Render changes

- Overview: new `panel wide` (pace line) + narrow donut panel in a
  `two-col`-style row, then the weekly panel (chart + compact table row).
  Existing two-col (territory/daily) stays last.
- Agents page: chart panel above the existing table.
- Chart aria-labels supplied via the existing `makeCanvas` helper.

## What's left to the builder

Exact panel markup/CSS class choices, chart color assignment within the
existing palette, and the sort order helper reuse — sensible defaults fine.
Dev-server screenshot verification of all four graphs on the private local
data (screenshots stay in the gitignored `reports/screenshots/`).
