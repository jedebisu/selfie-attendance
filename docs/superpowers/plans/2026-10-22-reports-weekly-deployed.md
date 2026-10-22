# Plan — Week-on-Week, deployed sheet style

Spec: `docs/superpowers/specs/2026-10-22-reports-weekly-deployed-design.md`
Branch: `feature/ebisu-sales-report` · Execute natively (user approved).

Fixture facts (from `reports/test/compute.test.js`, V_TEXT, October 2026,
31 days; Oct 1 2026 = Thursday → Mon-start offset 3):
Mon-weeks WK1 1–4 · WK2 5–11 · WK3 12–18 · WK4 19–25 · WK5 26–31.
Valid rows: r1 GFP (gen 10/03, last 10/05, completed), r2 GLS→GAH (gen
10/03, ongoing), r3 7099→GAH (gen 10/08, last 10/10, completed),
r4 GFP0104 NOT FOUND (gen blank — excluded from apps-gen tallies),
r5 "Orphan Row" blank JOB ORDER (dropped everywhere — pinned behavior),
r6 WQ→unclassified (gen 10/14, last 10/20, completed), r7 GFP (gen 10/25,
last 10/28, completed).

Expected apps-gen weekly: WK1 2 (GFP 1, GAH 1) · WK2 1 (GAH) ·
WK3 1 (unclass) · WK4 0 · WK5 1 (GFP); monthly total 5 (gfp 2, gah 2,
other 1) — r4 counted in totalOrders (6) but has no date.
Expected installed weekly: WK1 0 · WK2 2 (GFP 1, GAH 1) · WK3 0 ·
WK4 1 (unclass) · WK5 1 (GFP); sums to kpis.actual = 4.

---

### Task 1: calendar weeks + weekly blocks in compute.js

**Files:**
- Modify: `reports/src/compute.js` (module-level helpers, blankResult
  block, main loop tail, return object)
- Test: `reports/test/compute.test.js` (rewrite the two old `weekly`
  tests; add new pins)

**Interfaces:**
- Consumes: existing main-loop row walk (records, dayCount by LAST UPDATE
  of completed rows), `classifyWorkOrder`, `parseSheetDate` dates pinned
  to the current month (existing pattern), `dataAsOf`.
- Produces (all on result + blankResult):
  - module exports: `calendarWeeks(dataAsOf)` →
    `[{ week: 'WK1', start, end, days }]` (Monday start, partial first/
    last week clamped to month end) and `wkDeltaPct(curAvg, prevAvg)` →
    fraction or `null` when prevAvg <= 0.
  - fields: `monthDays` (days in data month), `appsGenMonthly` =
    `{ total, gfp, gah }` (all committed rows whose DATE APPS GEN falls in
    the data month; gah = GLS*/7* classes, gfp = GFP*, other excluded),
    `weeklyBlocks` =
    `{ weeks: [{ week, start, end, days }],
       appsGen: [{ week, total, gfp, gah }],
       installed: [{ week, total, gfp, gah }] }` (appsGen/installed
    parallel to weeks, days ≥ start; installed = completed by LAST UPDATE).
  - REMOVES fields `pace`… no — **replaces `weekly`** (the old W1–W4 fixed
    bucket array): drop `weekly` from result/blankResult; the two old
    weekly tests are rewritten to the new shape. `weeklyBars` in charts.js
    is removed in Task 2; nothing else consumes `weekly`.
- Note: keep `WEEK_DEFS` export? No — it encoded the old fixed buckets;
  remove it (git history keeps it). `pctChange` stays (daily table uses…—
  grep confirms render.js imports `pctChange` for weeklyTable; Task 2
  removes weeklyTable, and no other consumer exists → keep pctChange only
  if used; check with grep, remove if orphaned).

- [ ] **Step 1 (RED):** rewrite/append tests:
  - `calendarWeeks(new Date(2026, 9, 1))` → 5 defs, first
    `{ week: 'WK1', start: 1, end: 4, days: 4 }`, last end 31;
    `calendarWeeks(new Date(2026, 6, 1))` (Jul 2026: Jul 1 = Wednesday →
    offset 2 → WK1 days 1–5; 31 days → 5 weeks: 3+7+7+7+5=31… verify by
    date math inside the test, not by hard magic: assert boundaries sum).
    Simpler secondary pin: Feb 2027 (starts Monday, 28 days) → exactly
    4 weeks of 7.
  - weeklyBlocks appsGen/installed per fixture expectations above;
    `appsGenMonthly.total` = 5, `installed` sum = 4 = kpis.actual;
    `monthDays` = 31; blank result: weeklyBlocks empty arrays, monthDays 31
    (default) is WRONG for blank — use `0`… blank dataAsOf is null →
    monthDays = 0, weeks = [].
  - `wkDeltaPct(22.7, 17.27)` ≈ 0.3138; `wkDeltaPct(1, 0)` = null.
- [ ] **Step 2 (GREEN):** implement; commit.
- Ledger rulings: weekly replacement; dynamic weeks vs fixed 5.

### Task 2: rendered weekly blocks (render.js + styles.css), remove weekly chart

**Files:**
- Modify: `reports/src/render.js` — replace the weekly panel content in
  `overviewPage(current, previous)`; delete `weeklyTable`; import needed
  helpers from compute.js (`wkDeltaPct`; `calendarWeeks` not needed in
  render — weeks come from `current.weeklyBlocks.weeks`).
- Modify: `reports/src/charts.js` — delete `weeklyBars` + the `'weekly'`
  kind branch (keep pace/donut/agents/territory/area/daily/vs-daily).
- Modify: `reports/src/styles.css` — `.wk-block` grid (3 columns
  1.15fr/1fr/1fr, collapsing to stacked under 900px) + `.wk-chip`
  red/green styles (reuse existing chip palette).

**Interfaces:**
- Consumes: `current.weeklyBlocks`, `current.monthDays`,
  `current.appsGenMonthly`, `previous.appsGenMonthly`,
  `previous.monthDays`, LM INSTALLED total = `previous.kpis.actual`;
  `int()`, `pct1()`, `el()` existing render helpers.
- Produces: DOM only. Structure per block
  (APPS GEN first, INSTALLED second):
  - section.panel.wide containing:
    - h3 panel-title (`WEEK-ON-WEEK — APPS GEN (BY DATE APPS GEN)` /
      `WEEK-ON-WEEK — INSTALLED (BY LAST UPDATE)`)
    - div.wk-block with three tables:
      1. ACTUALS: header WK1..WKn | MTD; rows DAYS (week days, MTD =
         monthDays), TOTAL, GFP, GAH.
      2. AVERAGE DAILY: columns LM | WK1..WKn | MTD; rows TOTAL/GFP/GAH;
         LM cell = previous `appsGenMonthly` totals (APPS GEN) /
         `previous.kpis.actual` etc (INSTALLED), '—' when no previous;
         week cells = count ÷ week days (1 decimal via `pct1`-style
         `one()` formatting = (Math.round(x*10)/10).toFixed(1)); MTD =
         month total ÷ monthDays.
      3. vs LAST WEEK: columns WK1..WKn; rows TOTAL/GFP/GAH; cell =
         wkDeltaPct(avg_n, avg_n−1) for n ≥ 2; WK1 = wkDeltaPct(avg_1,
         LM total ÷ previous.monthDays); chip text '▼ 12.9%' red /
         '▲ 3.1%' green / '—'. Chip span class bad/good.
- Minor leaked detail while editing: the old `weekly-box` CSS height rule
  becomes unused — delete.

- [ ] **Step 1:** implement render.js block builder `weeklyBlock(title, sub,
  weeksData, kind, previous)` (kind 'apps'|'installed' picks LM source);
  overviewPage replaces the old weekly section with the two blocks; delete
  `weeklyTable` + its `pctChange` import if orphaned (grep first); remove
  charts.js weeklyBars + kind + `.weekly-box` CSS.
- [ ] **Step 2:** npm test must stay green (render not directly tested but
  imports must not break: charts.js 'weekly' kind removal — verify against
  render references by grep). Commit.

### Task 3: verify + ledger + handoff

- [ ] `npm test` — expect ~41 pass, 0 fail.
- [ ] `npm run build` — expect success (~80 kB gzip).
- [ ] Headless Chrome screenshot of `#overview` (user-data-dir pattern) —
  expect 4 canvases (`grep -o '<canvas' | wc -l`), zero console errors,
  both weekly blocks visible with real September data; save to
  `reports/screenshots/v4-weekly-blocks.png`.
- [ ] Ledger rulings (design doc deviations + any new); commit any file
  changes; self-review disclosed fallback (subagent reviewer unavailable
  today — vendor side); finishing-a-development-branch menu.
