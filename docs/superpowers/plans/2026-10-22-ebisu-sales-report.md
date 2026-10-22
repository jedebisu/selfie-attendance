# EBISU Sales Report (v1) Implementation Plan

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
