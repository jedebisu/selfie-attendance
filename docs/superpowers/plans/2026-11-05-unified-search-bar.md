# Unified Search Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the NAPs/Places scope tabs with one unified search bar that detects input type and runs NAP-database and Photon place searches in parallel, rendering one labeled results panel.

**Architecture:** The existing stacked overlay column (v1.4.5) is kept; only the search column's internals change. Scope toggle JSX/state/styles are removed. Two engines run in parallel per settled debounced query — `napsAPI.search` (own sequence ref) and Photon `runPlacesSearch` (own sequence ref, separate from the NAP sequence so parallel responses never cross-suppress) — and one unified panel renders per-engine sections with per-engine states.

**Tech Stack:** React Native (Expo), react-native-maps, Photon REST (unchanged, no key), `/api/naps/search` (unchanged server).

**Spec:** Approved audit report sections B/C/E (this session, 2026-11-05). Bug audit table `docs/superpowers/plans/2026-11-05-unified-search-bar.md §Scope`.

## Scope Decisions (approved boundary)

- **IN:** remove scope toggle; unified parallel search; unified results panel (NAP FACILITIES / PLACES & LOCATIONS labels); per-engine loading/empty/error/Retry; Photon dedupe; Photon fetch gains an 8 s `AbortController` timeout (BUG-001 — the unified panel now shows Photon on every query, so the indefinite-spinner defect ships with the feature otherwise); coordinate branch clears dropped pin (BUG-002 — 1 line, part of the unified coordinate flow); placeholder update (BUG-015); separate NAP/Photon sequence refs.
- **OUT (deferred, recorded):** BUG-004 DMS regex, BUG-005 partial-coordinate classifier, BUG-006 boundary admin zoom, BUG-007 server tokenized search, BUG-011 backoff, BUG-012/013, BUG-014 device testing; no server file changes; `NapSearchScreen.js` untouched; no APK build in this pass (build offered after verification).

## Global Constraints

- Smallest reliable diff on the existing uncommitted-WIP tree on `feature/ebisu-sales-report`; do not touch `server/*`, `mobile/src/screens/NapSearchScreen.js`, or unrelated user WIP.
- No new dependencies, no API keys, no provider swap, no server changes.
- Preserve: coordinate card + 3 copy buttons (6 dp, expo-clipboard), purple/pin markers, NAP detail panel + Lat/Long long-press copy, nearest-1km mode, chips, pin banner, route polyline, Map/List toggle, stale-response guards ("newest settled query wins").
- Keep v1.4.5 suppression semantics where reused (NAP Enter flush 600 ms/identical-query window).

## Review Focus

- Rapid typing across the two engines: NAP response of query A must never overwrite fresh results of query B (separate `napSeqRef`/`placeSeqRef`, checked at set time) — test: static ordering audit in Task 1.
- One engine erroring while the other yields results: panel must show the good section and the erroring section's Retry, never a whole-panel error when partial success exists — pinned in Task 2 step test.
- Query below 2 chars / cleared mid-flight: both engines reset to idle and panel disappears — pinned in Task 2.
- Coordinate text entered while results are showing: coord card wins, engine results cleared, no duplicate markers with an old dropped pin — pinned in Task 2.
- Both engines busy: two spinners, never two rows "No results found" before settle — pinned in Task 2.

---

### Task 1: Remove scope toggle; unify state flow and debounce runners

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: existing states `searchQuery, searchResults, placeResults, placesPhase, searching, isSearching, coordinateSearchResult, searchMarker, statusFilter`; helpers `debounce, parseCoordinateInput, formatCoords`.
- Produces: `napSeqRef` (replaces `searchSeqRef.current` inside `performNapSearch` and its flush awaiting), `placeSeqRef` (replaces `searchSeqRef.current` inside `runPlacesSearch`); `runUnifiedSearch(query)` — for a query ≥2 chars: `performNapSearch(query)` then `runPlacesSearch(query)` (parallel, not awaited between); `debouncedUnified` = `debounce(runUnifiedSearch, 350)`; `napError` state (`performNapSearch` sets it false on success, true on catch); scope toggle block, `searchScope` state, scope styles (`scopeToggle`, `scopeButton`, `scopeButtonActive`, `scopeButtonText`, `scopeButtonTextActive`) deleted; placeholder string becomes `"Search NAPs, places, or coordinates..."`; coordinate branch of `handleSearchChange` additionally calls `setDroppedPin(null)` (BUG-002) and clears engine results + phases (`setSearchResults([])`, `setIsSearching(false)`, `setPlacesPhase('idle')`, `setPlaceResults([])`, `setNapError(false)`); `handleStatusFilter` re-runs only the NAP engine (`performNapSearch`); `handleSubmitEditing` — coordinate → re-fly (existing); else flush `runUnifiedSearch(q)` (no place auto-select) with the existing 600 ms/identical-query suppression window updated to use `napSeq`-era names; `clearSearch` also resets `placesPhase`→`'idle'`, `napError`→false.

- [ ] **Step 1: Delete scope toggle JSX + styles + `searchScope` state + its handlers' branches; split seq refs; add `napError`; rename placeholder. Verify statically: `grep searchScope NapMapScreen.js` → no matches; `grep searchSeqRef` → 0 matches (renamed pairs in use).**
- [ ] **Step 2: Wire `runUnifiedSearch` + `debouncedUnified` into `handleSearchChange`; update `handleSubmitEditing`; moderate reuse of v1.4.5 suppression refs.**
- [ ] **Step 3: Babel syntax gate (node transform @babel/preset-react, 0 errors) + `grep` audits from Step 1.**
- [ ] **Step 4: Commit `feat(napmap): remove NAPs/Places scope toggle — one unified search flow`.**

### Task 2: Unified results panel — sections, states, dedupe

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: Task 1's `runUnifiedSearch`, `napError`, per-engine states; `renderPlaceRows` (v1.4.5, reused verbatim); `flyToPlace`, `selectNap`, `flyToNap`, `deltaFor`.
- Produces: `renderUnifiedResults()` — rendered in the stack after the coordinate card slot, containing: NAP FACILITIES section (`searchResults` rows via existing NAP list row markup: id, building, barangay/city, StatusBadge, port dot) with loading spinner, `napError`→"NAP search unavailable"+Retry (`performNapSearch(lastUnifiedQueryRef.current)`), and hidden when empty after settle; PLACES & LOCATIONS section (existing `renderPlaceRows` output, gray-dot styling unchanged) with `placesPhase` loading/error/Retry/empty states; Photon result dedupe at set time in `runPlacesSearch` (drop duplicates by `${String(p.osm_type||'')}${String(p.osm_id||'')}` or rounded lat/lng prefix); when both engines settled-empty → single `{styles.noResultsAll}` row "No results found"; `lastUnifiedQueryRef` thread for Retry; coordinate card keeps its own slot above this panel (nothing renders below it when it is shown).

- [ ] **Step 1: Implement `renderUnifiedResults()` + `noResultsAll`/section-label styles; wire into the stack; remove `renderPlacesPanel`/`renderNapEmptyPanel` (their slots and logic are superseded).**
- [ ] **Step 2: Add Photon dedupe inside `runPlacesSearch` before `setPlaceResults`.**
- [ ] **Step 3: Gates — babel syntax OK; static audit: no `renderNapEmptyPanel` references (superseded), dedupe applied, Section labels present.**
- [ ] **Step 4: Commit `feat(napmap): unified results panel with labeled NAP/Places sections and per-engine states`.**

### Task 3: Verification sweep

**Files:** none created.

- [ ] **Step 1: `npx --no-install expo export --platform android` → bundle exits 0.**
- [ ] **Step 2: Re-run coordinate parser table (6/6 PASS, unchanged helpers).**
- [ ] **Step 3: Whole-branch fresh-reviewer pass (range from session base).**
- [ ] **Step 4: Report: bugs fixed list, files changed, test evidence, limitations (no emulator/device on this machine), offer v1.4.6 APK build.**

## Deferred (not in this pass — do not attempt)

🐛 BUG-004 DMS decimal-degree regex, BUG-005 partial-coordinate classifier, BUG-006 boundary admin-level zoom, BUG-007 server token search, BUG-011 backoff, BUG-012 list key guard, BUG-013 dead screen, BUG-014 keyboard layout device-test.
