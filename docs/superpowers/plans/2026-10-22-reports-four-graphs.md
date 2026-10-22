# Four New Graphs (EBISU Sales Report) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four graphs to the reports app — pace line, GFP/GAHT mix donut, agent comparison bars, week-on-week panel — derived from the already-parsed VALIDATION data.

**Architecture:** Extend `compute.js` with two small derived series (`pace`, `weekly`) built from the existing `dayCount` tally, and extend `charts.js` with three new chart functions wired through the existing `[data-chart]`/`mountCharts` slot mechanism. `render.js` adds panels on Overview and Agent Productivity.

**Tech Stack:** Vanilla JS modules (Vite), Chart.js (already registered), node:test.

**Spec:** `docs/superpowers/specs/2026-10-22-reports-four-graphs-design.md`

## Global Constraints

- No new npm dependencies; npm only (never npx/pip downloads).
- Never read/commit `reports/public/data/*.csv` real files (skip-worktree'd); screenshots stay in gitignored `reports/screenshots/`.
- Weekly buckets (user-approved): W1 = 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–month end (real month length, e.g. W4 of Sep = 22–30).
- DCOS windows and 60/40 shares untouched.
- `target` = monthly scoped target, 0 when no targets fed; charts must tolerate 0.

## Review Focus

1. **Week with zero completions after a zero week** — `% change vs previous week` must show "—", never `Infinity`/`NaN`. Test in Task 1.
2. **No previous month fed** — weekly chart shows only the gold dataset; table's previous-month column shows "—". Pinned in Task 1 (weekly shape has no `previous` dependency) and Task 3 (render branch).
3. **Month shorter than 31 days** — pace days end at the real month length (Sep → 1..30); W4 spans 22–30. Test in Task 1.
4. **No targets fed (`target` 0)** — pace dashed line is all zeros but the chart still renders; weekly chart unaffected. Test in Task 1.
5. **Filtered views** — `pace`/`weekly` derive from the same filtered `dayCount` as everything else, so a TECH filter shrinks both lines/bars consistently. Exercised implicitly by existing filter tests + Task 1 accumulators built in the existing loop.

---

### Task 1: `pace` + `weekly` series in compute.js

**Files:**
- Modify: `reports/src/compute.js` (blankResult block, main loop tail near `dailyPerformance` build, return object)
- Test: `reports/test/compute.test.js`

**Interfaces:**
- Consumes: existing `dayCount` (object keyed by day number 1..31, filtered completed tally), `target` (number), `actual` (number), `dataAsOf` (Date|null) inside `computeDashboard`.
- Produces: `pace: { days: number[], actual: number[], targetPace: number[] }` and `weekly: [{ week: 'W1'..'W4', start: number, end: number, actual: number }]` on the dashboard result (both in `blankResult` and the main return). Also exports `WEEK_DEFS` and `pctChange(current, previous)` for Task 3: `pctChange(number, number)` → number fraction or `null` when previous <= 0.

- [ ] **Step 1: Write the failing tests** (append to `reports/test/compute.test.js`, reusing the existing fixture rows/imports already set up in that file; use the month the fixture data lives in — check the existing tests' `dataAsOf` pins first and reuse it):

```js
// pace: cumulative actual and pro-rata dashed target to month end
assert.ok(res.pace.days.length >= 28 && Number.isInteger(res.pace.days.at(-1)));
assert.equal(res.pace.actual.at(-1), res.kpis.actual); // ends at ACTUAL
// targetPace is linear 0 -> target across the month length
assert.equal(res.pace.targetPace[0], 0);
assert.ok(Math.abs(res.pace.targetPace.at(-1) - res.kpis.target) < 1e-9);

// weekly: bucket boundaries and sums reconcile
const weeks = res.weekly;
assert.deepEqual(weeks.map((w) => w.week), ['W1', 'W2', 'W3', 'W4']);
assert.equal(weeks[0].start, 1);
// W4 spans 22 to the fixture data month's REAL length (derive, don't hardcode)
const fixtureMonthDays = new Date(res.dataAsOf.getFullYear(), res.dataAsOf.getMonth() + 1, 0).getDate();
assert.equal(weeks[3].end, fixtureMonthDays);
// sums reconcile with ACTUAL
assert.equal(weeks.reduce((sum, w) => sum + w.actual, 0), res.kpis.actual);
// day 8 belongs to W2 (not W1): count fixture rows completed on days 8..14 directly
const w2Expected = /* manual tally from the existing fixture rows in this file */;
assert.equal(weeks[1].actual, w2Expected);

// pctChange: null on zero/none base, fraction otherwise
assert.equal(pctChange(10, 0), null);
assert.equal(pctChange(0, 10), -1);
assert.ok(Math.abs(pctChange(15, 10) - 0.5) < 1e-9);
```

- [ ] **Step 2: Run tests to verify they fail** — `cd reports && npm test` → new test block fails (pace/weekly undefined, `WEEK_DEFS`/`pctChange` not exported).

- [ ] **Step 3: Implement** in `compute.js`:
  - Module-level: `export const WEEK_DEFS = [{ week: 'W1', start: 1, end: 7 }, { week: 'W2', start: 8, end: 14 }, { week: 'W3', start: 15, end: 21 }, { week: 'W4', start: 22, end: 31 }];`
  - Module-level: `export function pctChange(current, previous) { return previous > 0 ? (current - previous) / previous : null; }`
  - In `computeDashboard`: `const daysInMonth = dataAsOf ? new Date(dataAsOf.getFullYear(), dataAsOf.getMonth() + 1, 0).getDate() : 31;`
  - `pace`: `const days = Array.from({ length: daysInMonth }, (_, i) => i + 1); let run = 0; const actualSeries = days.map((d) => (run += dayCount[d] || 0)); const targetPace = days.map((d) => (target * d) / daysInMonth);` → `pace = { days, actual: actualSeries, targetPace }`.
  - `weekly`: `WEEK_DEFS.map((w) => ({ ...w, end: Math.min(w.end, daysInMonth), actual: <sum of dayCount[d] for d in start..that end> }));` (W4 end becomes real month end; skip no buckets — all four always present, W1..W4, zero counts allowed).
  - Add `pace: { days: [], actual: [], targetPace: [] }` and `weekly: []` to `blankResult`; add the real `pace`, `weekly` to the main return.

- [ ] **Step 4: Run tests to verify they pass** — `npm test` → all green (31 old + new ≈ 6 pins), expect ~37.

- [ ] **Step 5: Commit** — `git add reports/src/compute.js reports/test/compute.test.js && git commit -m "feat: pace + weekly series in compute"`

### Task 2: Three chart functions in charts.js

**Files:**
- Modify: `reports/src/charts.js` (new functions after `territoryBars`, new kinds in `mountCharts`)

**Interfaces:**
- Consumes: `makeCanvas(slot, ariaLabel)`, `baseOptions(...)`, `C` palette, `destroyCharts()` (already auto-called by `mountCharts`).
- Produces: chart kinds `pace`, `donut`, `weekly`, `agents` (donut already exists as function `mixDonut` + kind `'donut'` — only render wiring needed in Task 3; this task adds `pace`, `weekly`, `agents`).

- [ ] **Step 1: Implement `paceLine(slot, pace)`** — `type: 'line'`, labels `pace.days`, dataset `Actual (cumulative)` solid line color `C.gold`, fill false, tension 0.25, dataset `Target pace` color `C.muted`, `borderDash: [6, 4]`, pointRadius 0 for both, y `beginAtZero: true`. Push to `liveCharts` like the others.

- [ ] **Step 2: Implement `weeklyBars(slot, currentWeekly, previousWeekly)`** — `type: 'bar'`, labels `currentWeekly.map((w) => w.week)`; dataset `This month` gold `C.gold` from `currentWeekly.actual`; if `previousWeekly?.length`, add dataset `Previous month` blue `C.gah` matched by week label via `previousWeekly.find(...)`, missing → 0.

- [ ] **Step 3: Implement `agentBars(slot, rows)`** — `type: 'bar'`, `options.indexAxis: 'y'`, labels agent display names (same composition as the table: name + ` (code)` when present), dataset `Completed` color `C.purple`, `rows` arrive sorted most→least from compute.

- [ ] **Step 4: Wire kinds in `mountCharts`** — add:
```js
if (kind === 'pace') paceLine(slot, current.pace);
if (kind === 'weekly') weeklyBars(slot, current.weekly, previous?.weekly);
if (kind === 'agents') agentBars(slot, current.agentProductivity);
```

- [ ] **Step 5: Verify** — `npm test` still 37/37 green (no logic changed); charts compile via build in Task 4.

- [ ] **Step 6: Commit** — `git add reports/src/charts.js && git commit -m "feat: pace, weekly, agent chart functions"`

### Task 3: Panels in render.js + styles

**Files:**
- Modify: `reports/src/render.js` (`overviewPage`, `agentsPage`, new `weeklyTable(rows, previousWeekly)` helper)
- Modify: `reports/src/styles.css` (`.pace-row`, `.weekly-flex`)

**Interfaces:**
- Consumes: `overviewPage(current)` / `agentsPage(current)` from v3 render; `chartPanel(title, chartKind, className)` helper; `el(tag, className, text)`; `int(n)`; `pct1(x)` format helpers; `previous.weekly` from bundle (pass `previous` into or through the page builders).
- Produces: DOM slots `[data-chart="pace"]` (wide), `[data-chart="donut"]` (narrow), `[data-chart="weekly"]`, `[data-chart="agents"]`.

- [ ] **Step 1: Overview additions in `overviewPage`** — after the DCOS panel, append: a `div.pace-row` panel pair (pace chart via `chartPanel('PACE — CUMULATIVE VS TARGET', 'pace', 'pace-box')` sized ~2fr, donut panel `chartPanel('GFP / GAHT MIX', 'donut', 'donut-box')` ~1fr), then the weekly panel: `chartPanel('WEEK-ON-WEEK PERFORMANCE', 'weekly', 'weekly-box')` + `weeklyTable` beneath it inside the same panel.

- [ ] **Step 2: `weeklyTable(currentWeekly, previousWeekly)`** — simple `data-table`: columns WEEK | THIS MONTH | PREVIOUS MONTH | CHANGE VS PREV WEEK. Rows: `currentWeekly` entries; previous month cell = matched previousWeekly?.actual ?? '—' (guard `previousWeekly` may be null/short); change cell = `pct1(Math.abs(pctChange(cur, prevThisWeek)))` with ▲/▼ prefix from sign, or '—' when `pctChange` returns null (zero/absent base) — reuse existing sign-chip conventions.

- [ ] **Step 3: Agents page** — in `agentsPage`, insert `chartPanel('COMPLETED BY AGENT', 'agents', 'agents-chart')` above the existing table panel.

- [ ] **Step 4: CSS** — `.pace-row { display: grid; grid-template-columns: 2fr 1fr; gap: 14px; }`, `.pace-row .panel { margin-top: 0; }`, `.donut-box { height: 220px; }`, `.weekly-flex` not needed if table sits under the chart; ensure `.panel` margins collapse sanely (reuse `.two-col` pattern).

- [ ] **Step 5: Commit** — `git add reports/src/render.js reports/src/styles.css && git commit -m "feat: pace/donut/weekly/agents graph panels"`

### Task 4: Verify on real data + wrap up

**Files:** none (verification only)

- [ ] **Step 1:** `cd reports && npm test` → 37/37 (plus however many Task 1 added) green.
- [ ] **Step 2:** Headless screenshots (same Chrome command pattern, `#overview` and `#agents`) into `reports/screenshots/`; visually confirm: pace solid line ends at 75, dashed line ends near 3,342; donut 69/6 split; weekly bars W1–W4; agent bars longest on top (`EDPS0111` = 36, `EDPS0135` = 19 next).
- [ ] **Step 3:** Canvas sanity via `--dump-dom`: 5 canvases on `#overview` (territory, daily, pace, donut, weekly) + 1 on `#agents`; console error grep clean.
- [ ] **Step 4:** `npm run build` succeeds.
- [ ] **Step 5:** Update ledger `.superpowers/sdd/2026-10-22-ebisu-sales-report/progress.md` with the four-graphs entry; commit docs (`git add docs/superpowers/specs/2026-10-22-reports-four-graphs-design.md docs/superpowers/plans/2026-10-22-reports-four-graphs.md`).
