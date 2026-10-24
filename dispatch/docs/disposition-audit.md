# Work Order Disposition Accuracy & Classification — Audit

Generated: 2026-10-09 · Live source: `work_orders` table (post-disposition schema)

> All numbers below were produced by the `/api/disposition/metrics` and
> `/api/disposition/audit` endpoints. The same pipeline runs against the
> remote Supabase database (Render-hosted API).

---

## 1. Scope & definitions

| Term | Meaning |
|------|---------|
| FSM status | Raw status string as exported by the CRM/field system (`original_status`) |
| Operational status | Normalized status code (`status`: NEW, FOR DISPATCH, ASSIGNED, IN PROGRESS, COMPLETED, DELAYED, ON HOLD, CANCELLED, FAILED) |
| FSM disposition | Raw close-code / outcome string, kept verbatim (`fsm_disposition`) |
| Disposition | Normalized close-code after an **approved rule** maps it (`disposition`) |
| Review | Record flagged `disposition_review_status = 'review_required'`; unknown or conflicting close-codes are never auto-applied |

## 2. Data availability

The most recent production import was
`Work_Order_Dashboard_01102026_31102026 (1).csv` (246 rows, committed as
import batch #2 on 2026-10-08). It is the **only CRM/BSS (Fiberhome) export
shipped with a status column and no close-code column**.

```
total rows              246
source channel          246 × CRM/BSS
distinct status values   5
no disposition column    1  (this file has no close-code column at all)
existing fsm_disposition 0  (all 246 rows imported before disposition columns existed)
```

### Status distribution (this export)

| Original status | Count | Derived operational status | Disposition handling |
|---|---:|---|---|
| COMPLETED | 193 | NEW (completion gate) | No close-code captured → not "classified" |
| PENDING | 33 | NEW | → review queue |
| DELAYED | 16 | DELAYED (status alias) | No close-code → not "classified" |
| OPEN | 2 | NEW | → review queue |
| ONGOING | 2 | NEW | → review queue |

### Live metrics (same 246 rows, re-run through the new pipeline)

```
total work orders   246
classified          0     (no true close-codes exist in the data)
open reviews        37    (PENDING 33 + OPEN 2 + ONGOING 2)
cleared             0
approved coverage   0 %
```

**Reading:** coverage is 0 % because the CRM/BSS file carries **no close-code
/ disposition column at all**. The 193 COMPLETED and 16 DELAYED rows only
have operational statuses. Under the new rules this is reported honestly —
previously the status-alias path would have marked those rows "approved"
even though no disposition value was ever captured, which inflated coverage.

## 3. Code-level root causes (as shipped before the change)

1. **Status and close-code were the same field.** The importer treated the
   CRM "status" string as the close-out signal, so "COMPLETED", "DELAYED",
   "PENDING" etc. were all lumped into one `status` column with no ability to
   distinguish operational state from *why the job closed*.
2. **Free-text matching risks.** Nothing prevented token-based guessing
   (e.g. "Customr not availble") from silently matching a dictionary entry,
   which would manufacture a close-code that was never stated in the file.
3. **Terminal statuses could come from anywhere.** A status of COMPLETED was
   accepted at face value, so a row marked done in the file skipped the
   dispatch process even when the file's own quality was unreliable
   (this is why `trustImportedCompletion` gates re-open COMPLETED to NEW).
4. **Imported dispositions were not queryable.** No `fsm_disposition` /
   confidence / review audit trail existed — you could not tell *why* a row
   had a given status.

## 4. What the change introduces

### 4.1 Approved-only dictionary (28 rules seeded)

Exact-match **after formatting-only normalization**. Two source strings are
equal only when NFKC-normalized, accent-stripped, lowercased, whitespace-
collapsed strings are identical. There is no fuzzy word matching, so
"Customer Unavailable" and "Customer Not Around" stay distinct rules.

- 19 disposition rules → normalized close-code + category + optional status

  | Source value | Normalized | Category | Status |
  |---|---|---|---|
  | Completed | Completed | COMPLETED | COMPLETED |
  | Customer Unavailable | Customer Unavailable | CUSTOMER_UNAVAILABLE | DELAYED |
  | No Contact | Customer Unavailable | CUSTOMER_UNAVAILABLE | DELAYED |
  | Customer Not Around | Customer Unavailable | CUSTOMER_UNAVAILABLE | DELAYED |
  | Access Issue | Access Issue | ACCESS_ISSUE | DELAYED |
  | No Access | Access Issue | ACCESS_ISSUE | DELAYED |
  | Gate Locked | Access Issue | ACCESS_ISSUE | DELAYED |
  | Technical Failure | Technical Failure | TECHNICAL_FAILURE | FAILED |
  | Tech Failure | Technical Failure | TECHNICAL_FAILURE | FAILED |
  | Material Shortage | Material Shortage | LOGISTICS_CONSTRAINT | DELAYED |
  | No Material | Material Shortage | LOGISTICS_CONSTRAINT | DELAYED |
  | Equipment Not Ready | Equipment Not Ready | LOGISTICS_CONSTRAINT | DELAYED |
  | Customer Cancelled | Customer Cancelled | CANCELLED | CANCELLED |
  | Cancelled by Customer | Customer Cancelled | CANCELLED | CANCELLED |
  | Rescheduled | Rescheduled | RESCHEDULED | DELAYED |
  | Customer Reschedule | Rescheduled | RESCHEDULED | DELAYED |
  | Duplicate Order | Duplicate Order | DUPLICATE | CANCELLED |
  | Duplicate | Duplicate Order | DUPLICATE | CANCELLED |
  | Already Served | Already Served | DUPLICATE | COMPLETED |

- 9 status aliases → operational status (New→NEW, In Progress→IN PROGRESS,
  For Dispatch→FOR DISPATCH, Assigned→ASSIGNED, Completed→COMPLETED,
  Delayed→DELAYED, On Hold→ON HOLD, Cancelled→CANCELLED, Failed→FAILED)

### 4.2 Classifier behaviour per import row

| Signal present | Resolution |
|---|---|
| Close-code present, matches an approved disposition rule | Disposition applied; confidence `approved` |
| Close-code present, maps to a status that **conflicts** with FSM status | → review, reason starts `Conflicting: …` |
| Close-code present, no rule | → review, `Unknown disposition "…"` |
| No close-code column, status matches a **status alias** | Operational status normalized only; NOT counted as classified (no close-code captured) |
| No close-code column, status matches a **disposition rule** | Disposition applied (e.g. blank-status rows + "Completed") |
| Close-code column present but blank | Status kept strictly as status; never guessed |

No COMPLETED is ever inferred from words like "done"/"closed"/"finished" —
only an explicit approved rule can reach COMPLETED.

## 4.3 Import + review workflow

- Each import shows a disposition breakdown: `mapped / unknown / conflicting / unresolved`.
- Every unknown/conflicting row is stored with
  `fsm_disposition` (verbatim) and a `disposition_review` row
  (`disposition_reviews`, one open per work order enforced by a partial
  unique index).
- Review queue (`/disposition`) lets an operator Approve (rule-backed or
  manual, records before/after JSON snapshots), Clear, or Rollback.
- Controlled corrections (`/correct`) re-classify existing records via an
  approved rule and require `confirm: "yes"`; every correction is revertible.
- Audit endpoints read live data, never mutate it.

## 5. False-conflict example (from the crafted verification file)

| WO | FSM status | Close-code | Result |
|---|---|---|---|
| …001 | Delayed | Customer Unavailable | ✅ mapped → DELAYED / CUSTOMER_UNAVAILABLE |
| …002 | In Progress | Customer Unavailable | ⚠ review: status (IN PROGRESS) conflicts with disposition (DELAYED) |
| …003 | (blank) | Fire in Building | ⚠ review: unknown disposition |
| …004 | (blank) | Completed | ✅ mapped → COMPLETED / Completed |
| …005 | "  customer unavailable  " | (blank) | ⚠ review: status is not an alias, blank close-code never guessed |

Row …002 is the canonical conflict: the file says the job is in progress
but the close-code implies the customer was unavailable (a delayed finish).
The row is **not** closed automatically — a human must decide.

## 6. Recommended follow-ups

1. **Ask Fiberhome/CRM to ship a real close-code column** (outcome / reason
   code) going forward. Until then disposition coverage will stay at 0 % for
   CRM/BSS exports and the 193 COMPLETED rows will re-open as NEW for
   dispatch confirmation.
2. Add approved rules for the recurring unknown statuses observed here
   (PENDING, OPEN, ONGOING) — or treat them as review-only, per finance rules.
3. Enrich the dictionary as new English close-codes arrive; keep aliases as
   separate rules so exact provenance is always recorded in `disposition_rule_id`.
4. Optionally raise a warning when a file has zero disposition column
   (currently a no-op signal to the import screen).