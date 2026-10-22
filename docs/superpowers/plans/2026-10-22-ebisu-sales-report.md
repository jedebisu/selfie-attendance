# EBISU Sales Report (v1) Implementation Plan

> ⚠️ **SUPERSEDED IN PART — v2 REVISION (2026-10-22).** The user revealed the original
> Apps Script paste was the wrong blueprint. The correct system is the target-driven
> "Globe Broadband Performance Dashboard" script. Tasks 1–6 scaffolding/styling/CSV-feed
> mechanics survive; the **sections and counting formulas are rebuilt** (v1 counted
> RESULT=FOUND rows; v2 counts STATUS=COMPLETED rows against monthly TARGETS). See the
> `v2 REVISION` section at the bottom of this file. The live data source is the user's
> link-shared Google Sheet (`1J8KozrR0A-…`): VALIDATION (76 rows, Sep), TARGETS
> (per-BDE), BBSP TARGETS (12 rows), AGENT POOL (232 agents). Feeding stays **manual CSV**;
> no tab named "BDE" exists and none is needed (AGENT POOL carries each agent's BDE).

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native — chosen by the user: "go build now", implemented in-session).

**Goal:** A local, browser-viewable version of the FSM D-1 Command Center dashboard, branded "EBISU Sales Report", fed by one CSV (Google Sheets VALIDATION export).

**Architecture:** New standalone app folder `reports/` in this monorepo (same pattern as `dashboard/`, `dispatch/`). Plain vite + vanilla JS single page: no framework, no backend. The page fetches `data/validation.csv` (relative URL), parses it, computes all dashboard figures with pure functions, and renders KPI cards, charts, and the top-agents table. A drag-and-drop overlay lets the user preview any exported CSV client-side without touching the repo.

**Tech Stack:** vite (dev server + static build for later Vercel hosting), papaparse (CSV edge cases: quoted fields with commas), chart.js (donut, gauge, column/bar charts, stacked agents bar), node:test for the pure logic.

**Spec:** Statement of Intent above (see conversation; v1 dashboard view only).

## Global Constraints

- Branding is exactly "EBISU Sales Report" (page `<title>`, header band, footer).
- Counting mechanics replicate the Apps Script logic verbatim (normalize = trim + uppercase; classify = startsWith `GFP` → GFP, startsWith `GLS` or `7` → GAH, else ''; totals count only RESULT=FOUND rows that classify; breakdowns and agent tables count the same set; checked = non-empty JOB ORDER; matchRate = found / checked).
- All displayed numbers derive from the CSV — no hardcoded data in code. Sample rows live only in `reports/public/data/validation.csv`.
- No changes to anything outside `reports/`; no changes to the Apps Script or Google Sheet side.
- Design language mirrors the Apps Script dashboard THEME (navy `#0B2545`, gfp `#D6336C`, gah `#1971C2`, purple `#6741D9`, green `#0CA678`, red `#E03131`, gold `#E8A400`, plus their `*Light` backgrounds).
- npm only; no global installs; dev server on vite's default port 5173.
- DCOS/PERFORMANCE tables, pipeline buttons, auth: out of scope (v1).

## Review Focus

1. **Quoted CSV fields with commas** (customer addresses) must not split columns — pinned by `parseCsv keeps quoted commas together` (Task 2).
2. **Header-case/whitespace variants** (`" JOB ORDER "` vs `JOB ORDER`) — column mapping by normalized header — pinned by `computeDashboard maps columns case-insensitively` (Task 2).
3. **Unclassifiable job orders** (`MOBILE-123`) — count toward checked/found but never into GFP/GAH totals or breakdowns — pinned by `unclassified job orders are counted as checked/found but excluded from type totals` (Task 2).
4. **Blank/whitespace-only JOB ORDER rows** — excluded from checked entirely — pinned by `blank job orders are excluded from checked` (Task 2).
5. **Duplicate work orders** appear twice in the CSV and are counted twice, matching the Apps Script behavior — pinned by `duplicate work orders are each counted` (Task 2).
6. **Dates as `M/D/YY`** (Sheets MM/dd/yy display values) parse to the right day — pinned by `parseSheetDate handles M/D/YY` (Task 2).

---

### Task 1: Scaffold the app and boot it

**Files:**
- Create: `reports/package.json`, `reports/index.html`, `reports/src/main.js`, `reports/src/compute.js` (stub), `reports/src/render.js` (stub), `reports/src/styles.css`, `reports/public/data/validation.csv` (sample rows)

**Interfaces:**
- Produces: runnable `reports/` app (`npm run dev` serves http://localhost:5173; `npm test` runs node:test on `reports/test/`; `npm run build` produces `dist/`).

- [ ] **Step 1:** Write `package.json` (name `reports`, private, scripts: `dev` → `vite`, `build` → `vite build`, `preview` → `vite preview`, `test` → `node --test test/`; deps: papaparse, chart.js; devDeps: vite).
- [ ] **Step 2:** `cd reports && npm install` — succeeds, `node_modules` present.
- [ ] **Step 3:** `npm run dev` briefly — HTTP 200 on http://localhost:5173, then stop.
- [ ] **Step 4:** Commit `feat: scaffold reports app (EBISU Sales Report)`.

### Task 2: Data model + computation (pure logic, tested)

**Files:**
- Modify: `reports/src/compute.js`
- Test: `reports/test/compute.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseCsv(text) -> String[][]` (papaparse, header row at index 0)
  - `parseSheetDate(value) -> Date|null` (accepts `M/D/YY`, `M/D/YYYY`, ISO; null otherwise)
  - `classifyWorkOrder(jobOrder) -> 'GFP' | 'GAH' | ''` (expects an already-normalized value)
  - `normalizeWorkOrder(value) -> String`
  - `computeDashboard(data) -> { checked, found, notFound, matchRate, gfp, gah, total, statusCount, areaCount, territoryCount, facilityCount, agents, dataAsOf }` — count objects are `[{label, count}]` sorted by count desc; agents = `[{agentCode, agentName, channel, gfp, gah, total}]` sorted by total desc then agentName asc; dataAsOf = max LAST UPDATE date or null.

- [ ] **Step 1:** Write failing tests for the six Review Focus cases + one happy-path integration case.
- [ ] **Step 2:** `npm test` — expect failures (module is stubs).
- [ ] **Step 3:** Implement `compute.js`.
- [ ] **Step 4:** `npm test` — all pass.
- [ ] **Step 5:** Commit `feat: validation CSV computation logic`.

### Task 3: CSV feed (fetch + drag-drop preview)

**Files:**
- Modify: `reports/src/main.js` (sample CSV already landed in Task 1)

**Interfaces:**
- Consumes: `parseCsv`, `computeDashboard` from Task 2; sample CSV at relative path `data/validation.csv`.
- Produces: `renderFromCsv(text, fileName)` — entry point render.js and main.js share.

- [ ] **Step 1:** Wire fetch of `data/validation.csv` + drag-drop/FileReader alternative; show the CSV filename on the page.
- [ ] **Step 2:** `npm run dev` — page loads, filename shown, console clean.
- [ ] **Step 3:** Commit `feat: csv feed with drag-drop preview`.

### Task 4: Dashboard sections (render + styling)

**Files:**
- Modify: `reports/src/render.js`, `reports/src/styles.css`, `reports/index.html`

**Interfaces:**
- Consumes: `computeDashboard` result object (Task 2 shape).
- Produces: rendered sections in order: title band; date strip (D-1 DATE = `dataAsOf`, LAST REFRESH = now); 6 KPI cards (GFP WORK ORDERS, GAH WORK ORDERS, TOTAL GFP + GAH, FOUND (VALIDATION), NOT FOUND, MATCH RATE); validation summary; GFP-vs-GAH mix panel; management alert; top agents table (top 10, medal-tinted first three rank cells).

- [ ] **Step 1:** Implement `render.js` DOM sections (one function per section, fed by the compute result).
- [ ] **Step 2:** Style with THEME palette; responsive CSS grid.
- [ ] **Step 3:** Visual check via dev server screenshot; console clean.
- [ ] **Step 4:** Commit `feat: dashboard KPI sections and agents table`.

### Task 5: Charts

**Files:**
- Modify: `reports/src/render.js` (split `reports/src/charts.js` out if render.js grows past ~400 lines)

**Interfaces:**
- Consumes: compute result breakdowns/agents.
- Produces: donut (GFP vs GAH), gauge (match rate 0–100, green ≥80 / yellow 50–80 / red <50), 4 category charts (STATUS column chart; AREA/TERRITORY/FACILITY horizontal bars), agents stacked horizontal bar (GFP + GAH per agent).

- [ ] **Step 1:** Implement chart helpers, mounted into their panels; empty-data panels show a placeholder line instead of a chart.
- [ ] **Step 2:** Visual check: charts render once per panel; re-feeding a CSV replaces charts (no duplicates).
- [ ] **Step 3:** Commit `feat: dashboard charts`.

### Task 6: Run locally for the user + verification sweep

**Files:** none new.

- [ ] **Step 1:** `npm test` green; `npm run build` succeeds.
- [ ] **Step 2:** Dev server in background; full-page screenshot at desktop width; console error count = 0.
- [ ] **Step 3:** Report to the user: the local URL, the run command (`cd reports && npm install && npm run dev`), and how to swap in their real CSV (File ▸ Download ▸ CSV on VALIDATION → drag onto the page, or replace `reports/public/data/validation.csv`).
- [ ] **Step 4:** Commit any final fixes.

---

# v2 REVISION (2026-10-22) — target-driven rebuild

**Spec change (user-confirmed):** The site mirrors the "Globe Broadband Performance Dashboard"
Apps Script (the *correct* script), not the old D-1 Command Center. Data: user's
link-shared sheet tabs exported manually as CSV. Feeding = replace files in
`reports/public/data/` or drag files onto the page; **no Google/network dependency at runtime.**

## v2 Sections (user-approved: "exactly these 8" + one addition)

1. Title band — "EBISU Sales Report", month of data, data-as-of date, page-refresh time.
2. Six KPI cards — TOTAL WORK ORDERS · ACTUAL (COMPLETED) · MONTHLY TARGET · ACHIEVEMENT % · DAILY AVERAGE · NOT FOUND.
3. Monthly target panel — target vs actual vs remaining + achievement dial.
4. Daily performance — COMPLETED work orders by day-of-month (bar chart).
5. Territory performance — completions per territory + share-distributed monthly target.
6. Per-BDE table — GFP/GAH/total targets per BDE (+ actual where mappable).
7. Per-BBSP table — same for every BBSP (actuals matched via AGENT POOL).
8. All-records table — the full VALIDATION detail list.
9. **"vs LAST MONTH" tab** (user addition) — compare the fed month against a second
   fed VALIDATION CSV (previous month): KPI deltas + day-of-month side-by-side bars;
   friendly empty state when only one month is fed. Stored per data-month.

## v2 Counting formulas (mirroring the correct script verbatim)

- Records = rows with non-blank JOB ORDER (same 15 columns as before).
- `actual` = rows where `STATUS.trim().toUpperCase() === 'COMPLETED'` (NOT found-classified).
- `notFound` = rows where RESULT (normalized) === 'NOT FOUND'.
- Territorial actual = COMPLETED count per territory; territory target = monthly target
  × (territory completions ÷ total completions), rounded.
- Daily performance = COMPLETED by day-of-month, taken from LAST UPDATE (only days with data).
- `target` = Σ per-BDE TARGET column values (TARGETS tab: BDE | GFP TARGET | GAH TARGET | TOTAL).
  Numbers may carry commas/quotes ("1,362") — strip non-digits before Number().
- `achievement` = actual ÷ target; `remaining` = max(target − actual, 0).
- Per-record BBSP = AGENT POOL match (by agent code, then name); per-record BDE =
  AGENT POOL's BDE column (no separate BDE tab exists — AGENT POOL wins).
- Agent-pool CSV shape: BBSP | AGENT CODE | AGENT NAME | BDE (232 live rows).

## Deliberate deviations from the script (honest-for-a-CSV choices)

- Month label = the data's own month (max LAST UPDATE), not the viewer's wall clock —
  a fed CSV has no "now"; script labeled by server date.
- `daysElapsed` = data-as-of day-of-month (not today's date), same reason.
- Targets optional: if TARGETS/BBSP TARGETS CSVs absent, target-dependent panels show
  "no targets fed yet" instead of failing.

## v2 Feeding (manual, per user's confirmation "Keep manual CSV feeding")

- Default files (all optional except VALIDATION): `public/data/validation.csv`,
  `public/data/bde-targets.csv`, `public/data/bbsp-targets.csv`, `public/data/agent-pool.csv`.
- Drag-drop recognizes each file type by its header row (15-col VALIDATION; BDE|…
  TARGET…; BBSP|…TOTAL TARGET; BBSP|AGENT CODE|AGENT NAME|BDE) — files may be dropped
  all at once. VALIDATION files are routed by their data month (this month vs last).

## v2 Review Focus (new pins)

1. `ACTUAL counts only STATUS COMPLETED` — not found-classified (Task 7 test).
2. `Comma-formatted targets ("1,362") parse` (Task 7 test).
3. `TARGETS header variants: 4th column may be TARGET or TOTAL (or nothing)` (Task 7 test).
4. `Territory target share distribution sums to monthly total (± rounding)` (Task 7 test).
5. `Daily performance only includes days with data, keyed by day-of-month` (Task 7 test).
6. `Feed recognition by header shape` — one test per tab type + one unknown-shape
   rejection (Task 8 test).
7. Mixed-case statuses ("Completed") normalize to COMPLETED (Task 7 test).

## v2 Tasks

### Task 7: compute v2 (pure logic, tested)
- Modify `reports/src/compute.js`; rewrite `reports/test/compute.test.js` (keep parseCsv/BOM/
  header-case/date tests, replace v1 metric tests).
- Produces: `computeDashboard(data, extras)` → KPI set, target summary, dailyPerformance,
  territoryPerformance, bdeTargets, bbspTargets, records (with bbsp/bde), monthLabel, dataAsOf;
  plus `parseBdeTargets`, `parseBspbTargets`, `parseAgentPool`, `detectFeedType` helpers.
- Reviews Focus pins 1–5, 7 → TDD RED→GREEN; commit `feat: target-driven computation (v2)`.

### Task 8: feed layer for four CSV types + drop recognition
- Multi-file fetch on boot (404-tolerant for the three optional files); drop handler
  classifies by header (`detectFeedType`) and feeds the right store; multiple files per drop.
- Review Pin 6. TDD for the pure recognition helper; browser-verified for the wiring.
- Commit `feat: four-tab CSV feed with type recognition`.

### Task 9: render the 9 sections (8 + vs-last-month tab)
- Rebuild `render.js` sections + `styles.css` + tab switcher; `charts.js`: daily bars,
  territory bars w/ target overlay, achievement gauge, month-comparison bars.
- Browser-verified; commit `feat: target-driven dashboard sections`.

### Task 10: sample + real data hygiene
- Commit *fake* sample CSVs for all four types (public repo!). On this Mac: place the
  REAL September exports in `public/data/` and gitignore those exact filenames —
  real customer data must never be pushed to the public repo.
- Commit `chore: sample feeds for four tabs`.

### Task 11: verification sweep + review
- npm test green; build; desktop screenshots incl. vs-last-month tab; fresh reviewer
  (subagent if recovered; otherwise documented self-review); finishing menu.


---

# v3 REVISION (2026-10-22) — mirror the deployed Apps Script look

**Trigger (user, with screenshot):** "make it look like this — this is the deployed
script from appscript." The reference is the deployed "T6A Broadband Dashboard"
(the same target-driven script, another brand). Presentation supersedes the v2
single-scroll layout; the data model (v2 formulas) still stands.

## v3 layout spec (from the screenshot)

- Dark navy top bar: "EBISU Sales Report" (EBISU mark, NOT the Globe logo), data-as-of
  + record count, **Reload data** button (re-fetch CSVs — replaces Sync Now),
  month badge (data month), **Upload CSV** button (real file picker; drag-drop also kept).
- Left sidebar pages: Overview · BBSP · By Area · By Territory · Records ·
  Agent Productivity · **Month vs Month** (kept — user decision).
- Filter bar (global, re-slices every page + targets): BDE · BBSP · TECH dropdowns,
  search box, Reset.
- Five KPI cards (user decision): GFP ACTUAL (pink) · GAH ACTUAL (blue) · TARGET (purple)
  · ACHIEVEMENT (green) · DAILY AVERAGE (gold). NOT FOUND lives in Records + alerts.
- **Month to date panel**: DCOS 1 (day 1–15) / DCOS 2 (day 16–31) / MTD tables
  (columns KPI | Installed | Target | Ach | Var | Trend (vol) | Trend Ach | Req Daily)
  + amber DCOS/MTD INSIGHTS boxes. TECH targets: GFP 2,472 / GAH 870 = 3,342.
- Performance by territory + Daily performance panels (charts kept).

## v3 DCOS formulas (reverse-engineered from the generated PERFORMANCE tab + screenshot)

- Windows: DCOS 1 = day 1–15 @ 60% of each tech's monthly target; DCOS 2 = 16–31 @ 40%;
  MTD = 100%. (Screen: GFP 2,472×.6 = 1,483.2 · GAH 870×.6 = 522.)
- Installed = COMPLETED rows in the window by LAST UPDATE day-of-month per tech.
- Ach = installed ÷ target; Var = target − installed.
- Remaining days = windowEndDay − daysElapsed (clamped 0); Req Daily = remaining > 0 ? Var ÷ remaining : 0.
- Trend (vol) = previous fed month's COMPLETED count for that tech (full month);
  Trend Ach = Trend ÷ this row's target. No previous month fed → trend cells "—"
  (deviation: deployed shows 0; empty is more honest for a CSV feed).
- Insights strings mirror the deployed texts ("N% trend vs. DCOS 1 TAR of …",
  "… variance to hit …", "N remaining day(s) for …"); MTD adds GFP/GAH AVG DAILY.
- Note: the user's own workbook's PERFORMANCE tab has column-shifted targets (old
  script artifact) — the SCREENSHOT math is the spec, not that tab.

## v3 additional semantics

- Filters apply to records AND to targets: BDE → that BDE's targets; BBSP → that
  BBSP's BBSP-TARGET row; TECH → that tech's column; search = substring across
  subscriber/address/territory/area/facility/agent/job order/bbsp.
- Month picker lists fed months (default newest); Month vs Month compares
  selected vs the previous fed month. Badge shows "CSV FED".
- By Area = per-area completions + share-distributed target; Agent Productivity =
  per-agent completed GFP/GAH/total with BBSP + BDE.

## v3 tasks

### Task 12: compute v3 — DCOS, filters, tech targets, agent productivity (TDD)
### Task 13: app shell + pages + filter bar (render/main/styles rebuild)
### Task 14: verify vs reference (screenshots beside the deploy), build, review, finish

