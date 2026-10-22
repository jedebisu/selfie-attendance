# EBISU Sales Report — Week-on-Week, deployed sheet style (design addendum)

Date: 2026-10-22 · Status: approved in conversation (user picked option 2 for
WK1 + "lets launch") · Size: small change
Branch: `feature/ebisu-sales-report`

**Supersedes item 4 of `2026-10-22-reports-four-graphs-design.md`** (the
weekly grouped-bar chart + simple weekly table are replaced by the panel
below; the pace line, donut, and agent bars from that design are unaffected).

## Intent

Mirror the deployed T6A week-on-week sheet (decoded from the user's
screenshot of the deployed dashboard; numbers verified against it):

- **Weeks are Monday–Sunday calendar weeks** spanning the data month, with
  partial first/last weeks. A 30-day month starting on a Tuesday gives
  Days 6·7·7·7·3 — which is exactly what the deployed sheet shows.
- **Two stacked blocks**, each with rows TOTAL / GFP / GAH:
  - **APPS GEN** — every work order counted by its `DATE APPS GEN` day
    (rows with parseable in-month date only; dropped rows excluded).
  - **INSTALLED** — completed work orders (STATUS = COMPLETED) by their
    `LAST UPDATE` day.
- Each block shows three mini-tables:
  1. **Actuals** — a DAYS row (each week's day count; MTD column = full
     month days) then TOTAL / GFP / GAH counts per week + MTD totals.
  2. **Average Daily** — columns LM | WK1..WKn | MTD; each week's count ÷
     that week's days (1 decimal); MTD = month total ÷ month days. The LM
     column mirrors the deployed sheet: it shows the previous fed month's
     full-month totals per row (raw counts, not averages).
  3. **vs Last Week** — columns WK1..WKn, one % per row. Rule: each week's
     average daily vs the previous week's average daily,
     (avg_n − avg_n−1) ÷ avg_n−1, red chip when negative, green when
     positive. Plain "—" when the base is zero.
- **WK1 comparison (user decision: option 2, sane fix)** — the deployed
  sheet compares WK1 against the raw LM total (518), producing a
  misleading −95.6%. Instead WK1 compares like-for-like day counts:
  LM average daily rate = LM total ÷ LM days-in-month, then
  (WK1 avg − LM avg) ÷ LM avg. Per-block: APPS GEN uses the previous
  month's all-records total; INSTALLED uses the previous month's
  completed total (previous.kpis.actual).

## Deviations from the deployed sheet (rulings)

- **Dynamic week count**: the deployed sheet fixes 5 WK columns; we render
  WK1..WKn for exactly the weeks the month needs (up to 6 for a month that
  starts Sunday and has 31 days). Rendering columns the month doesn't have
  would show empty columns.
- **WK1 sane fix** as above — deliberate, user-approved.
- Unclassified work orders count in TOTAL but not in GFP or GAH, so
  TOTAL ≥ GFP + GAH (the deployed screenshot's dataset happened to have
  zero unclassified rows).
- LM is "the previously fed month" (whatever Upload CSV provided), same as
  the deployed sheet's LM when a prior month is fed; otherwise LM shows —.

## Non-goals

- The weekly group-bar chart is removed (the deployed sheet has none);
  landing on 4 canvases on Overview. It remains retrievable in git history.
- No new dependencies, no changes to DCOS/targets/KPI math, feeding stays
  manual CSV drag-drop.

## Acceptance

- `npm test` grows from 35 to ~41 pins: calendarWeeks boundaries (Oct 2026
  fixture: Thu start → WK1 days 1–4), apps-gen weekly tallies, installed
  weekly tallies, MTD reconciliation, blank-result safety.
- Build green; Overview shows 4 canvases, 0 console errors; screenshots of
  both weekly blocks on real September data.
