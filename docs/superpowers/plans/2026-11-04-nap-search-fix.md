# NAP Map Search Fix (Approach A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the uncommitted NAPs/Places search in `mobile/src/screens/NapMapScreen.js` — stacked overlay layout, Enter-to-select, places loading/error/retry states, map-region bias, type-based zoom, and a "Nearby places" fallback for empty NAP searches — then verify and build `EBISU-TA-v1.4.5.apk`.

**Architecture:** All search UI (scope toggle, search pill, results panels, status bar, chips) becomes one absolutely-positioned overlay column; the `MapView` is the sole in-flow child filling the screen. Photon/`/napcheck/search` calls stay client-side with a per-query sequence guard. No server or dependency changes.

**Tech Stack:** React Native (Expo bare), react-native-maps, expo-clipboard, existing `utils/helpers.js` parsers.

**Spec:** `docs/superpowers/plans/2026-11-04-nap-search-fix.md` § sections 1–9 below (spawned from the user's task brief; original web feature request in `/Users/yanggee/ebisudps-naps` conversation).

## Global Constraints

- Do NOT rebuild the feature from scratch; make the smallest reliable diff on top of the uncommitted working tree.
- Do NOT discard, reset, or revert any uncommitted changes: preserve `mobile/app.json`, `mobile/build-apk.sh`, `server/package.json`, `server/public/nap-snapshot.json`, untracked server scripts, and `mobile/EBISU-TA.apk` exactly as they are.
- No new dependencies, no API keys, no Google/Mapbox/provider changes, no server edits (keep Photon).
- Preserve: scope tabs, `/api/napcheck/search` behavior, Visayas-only filtering, decimal/DMS/compact-DMS parsing, purple marker + fly-to, coordinate card, three copy actions at 6 decimals (expo-clipboard), NAP detail panel + Lat/Long + long-press copy, NAP markers/filters/route features.
- Keep existing debounce: NAP search 300 ms, Photon 350 ms; every async search guards stale responses by sequence (`searchSeqRef`).
- Commits go on the current branch `feature/ebisu-sales-report`; stage ONLY named mobile files, never `git add -A` / `git add .`.
- Build via `./build-apk.sh v1.4.5` (app.json: version `1.4.5.0`, versionCode 38→39). Never overwrite `apk/EBISU-TA-v1.4.4.apk` (reference). `./EBISU-TA.apk` is the rolling "latest" copy the script intentionally refreshes.
- Report build/runtime results honestly; do not claim verifications that did not run.

## Review Focus

1. **Partial coordinate typing** ("`10.31 1`" mid-burst): auto-detect flies to the partial pair — must not crash, must not fight the places panel; flying again on settle is acceptable, overlapping panels is not. Pinned by Task 5 screenshot test.
2. **Photon blocked/HTTP error** (offline device, CDN hiccup): UI must show "Places search unavailable — Retry", never "No places found". Pinned by Task 2 code + Task 5 offline check.
3. **Stale/overshoot responses** (rapid typing, scope switch mid-flight): newest query wins; older response must be dropped, spinner cleared. Pinned by Task 2 seq-guard re-check.
4. **Malformed Photon payload** (non-JSON or missing `features`): no red-box crash; malformed JSON → error state, missing features → empty state. Pinned by Task 2.
5. **Small-screen layout with keyboard open**: results panel and keyboard must not cover the whole map; result lists scroll inside a bounded `maxHeight`, `keyboardShouldPersistTaps` lets taps through. Pinned by Task 1 structure (maxHeight 200) + Task 5 screenshot.

---

### Task 1: Overlay layout refactor — one stacked search column

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js` (JSX return block + `styles`)

**Interfaces:**
- Consumes: existing states `searchQuery, searchScope, placeResults, coordinateSearchResult, searching, isSearching, statusFilter, droppedPin, showList, selectedNap` (unchanged names).
- Produces: JSX skeleton all later tasks render into — `<MapView flex={1}/>` sole in-flow child, then an absolute overlay `<View style={styles.searchStack}>` containing scope pills, search row, coordinate card, places panel, nap-empty panel, status bar, chips, pin-banner in that order.
- Produces: helper `renderPlacesPanel()` returning the places results/no-results/error panel (Tasks 2–4 fill states), so Task 3/4 don't duplicate JSX.

Steps:
- [ ] Reorder JSX: `MapView` first child of container (keep imported props; add nothing yet), then `myLocationButton`, `listContainer`, detail panels, loading overlay as today; **replace** the current floating `scopeToggle` + `searchContainer` + `statusBar` + `chipsRow` + `pinBanner` blocks and their stale absolute `top: 62/108` with the single `<View style={styles.searchStack}>` column placed right after `MapView`.
- [ ] Move the coordinate card, places results `FlatList`, and no-places view **out of the search row** into the stack (as `renderPlacesPanel` + coordinate card JSX); `searchContainer` keeps ONLY TextInput, clear button, `searching` spinner.
- [ ] Styles: add `searchStack` = abs top 8, left/right 12, zIndex 20, no background; new `scopeToggle` style becomes a self-contained segmented pill row; `searchContainer` loses `position:absolute/top/left/right`, keeps pill look; `coordResultCard` / `placeResultsContainer` / `placeNoResults` lose `marginHorizontal` (stack provides margins), `placeResultsContainer` keeps `maxHeight: 200` and gains `keyboardShouldPersistTaps="handled"` on the FlatList; `statusBar`, `chipsRow`, `pinBanner` lose absolute positioning + left/right margins, get `marginTop: 6`; `listContainer` becomes full-bleed `top:0` (list sits under the zIndex-20 stack so the status bar's 🗺️ Map toggle stays tappable).
- [ ] Verify no absolute `top:` offsets remain except `searchStack(8)`, `myLocationButton(bottom)`, `detailPanel/collapsedBar(bottom)`, `loadingOverlay(fill)`, `listContainer(0)`; keyboard/panel can't exceed 200 + ~2 lines.

- [ ] Commit: `refactor(napmap): stack search overlay so panels never render inside the search row`

### Task 2: Places search state machine, map-center bias, type-based zoom

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js` (JSX return block + `styles`)

**Interfaces:**
- Consumes: stack skeleton + `renderPlacesPanel` slot from Task 1; `location` state; `parseCoordinate`, `formatCoords`, `debounce` from `utils/helpers.js` (signed as today).
- Produces: `placesPhase` state (`'idle' | 'loading' | 'error' | 'empty' | 'done'`); `runPlacesSearch(query)` — async, bumps `searchSeqRef`, fetches Photon biased by `biasCenter()`, sets `placeResults` + `placesPhase` (`'error'` on HTTP/JSON/throw, `'empty'` on zero features, `'done'` otherwise; swallows stale seqs and re-renders nothing when superseded); `lastPlacesQueryRef.current` (latest non-empty query); `retryPlacesSearch()`; `biasCenter()` → `mapRegionRef.current` (set by new `onRegionChangeComplete`) else `location` else `{10.3157, 123.8854}`; `deltaFor(kind)` → Province `1.0`, City `0.1`, else `0.01`; `flyToPlace` uses `deltaFor(placeKind(f))`.
- Produces: panel states inside `renderPlacesPanel()`: `loading` → spinner + "Searching places…", `error` → "Places search unavailable" + Retry button (repeats last query, no retype), `empty` → "No places found", `done` → existing result rows. Places-scope keeps `debounce(runPlacesSearch, 350)` wrapper.

Steps:
- [ ] Add `mapRegionRef` + `onRegionChangeComplete` handler (ref only, no setState); add `biasCenter`, `deltaFor`, `runPlacesSearch`, `placesPhase`, `lastPlacesQueryRef`, `retryPlacesSearch`; rewire `debouncedPlacesSearch` to call `runPlacesSearch`; make `flyToPlace` use `deltaFor`.
- [ ] Wrap Photon fetch: `res.ok` check (existing), `await res.json()` in try — malformed JSON → throw caught as `'error'`; `(d.features || [])` filter (existing) → zero-length means `'empty'`; never set `'empty'` on catch.
- [ ] Panel JSX per Interfaces block; Retry button calls `retryPlacesSearch()`.
- [ ] Verify statically: no fetch without seq guard; on supersede neither `placeResults` nor `placesPhase` is set.
- [ ] Commit: `feat(napmap): places loading/error/retry states, map-center bias, guaranteed fresh results, type-based zoom`

### Task 3: Enter-to-select and keyboard dismissal

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: `coordinateSearchResult`, `searchScope`, `placeResults`, `placesPhase` (Task 2), search row slot from Task 1, `performNapSearch` (below).
- Produces: `performNapSearch(query)` — the body of today's `debouncedSearch` extracted verbatim; `debouncedSearch` = `debounce(performNapSearch, 300)`; `handleSubmitEditing()` — coordinate result present → re-fly (delta 0.01) + `Keyboard.dismiss()`; Places scope → if `placesPhase==='done'` and placeResults non-empty select `placeResults[0]` (existing row-select path), else nothing; NAPs scope → immediate `performNapSearch` + `Keyboard.dismiss()`; query <2 chars → dismiss only. Selection handlers (`renderNapListItem`, `flyToPlace`, NAP marker press) and submit path call `Keyboard.dismiss()`; `TextInput` gains `returnKeyType="search"` and `onSubmitEditing={handleSubmitEditing}`.

Steps:
- [ ] Extract `performNapSearch`, rewire `debouncedSearch`; add `handleSubmitEditing` + `Keyboard` import; attach to TextInput and add dismiss calls to the three selection handlers.
- [ ] Verify statically: submit never triggers a second Photon request in Places scope (selects pending results only), never selects a place in NAPs scope.
- [ ] Commit: `feat(napmap): enter selects first suggestion or flushes NAP search; keyboard dismissed on selection`

### Task 4: "Nearby places" fallback for empty NAP searches

**Files:**
- Modify: `mobile/src/screens/NapMapScreen.js`

**Interfaces:**
- Consumes: `performNapSearch` (Task 3), `runPlacesSearch`/`placeResults`/`placesPhase` (Task 2), stack skeleton (Task 1).
- Produces: NAP-scope empty panel: "No NAPs found for this search" note plus a "Nearby places — externally sourced" section rendered from `placeResults` (existing gray-dot rows and marker behavior) shown ONLY in NAPs scope when the completed NAP search returned 0 rows; `performNapSearch` fires `runPlacesSearch(query)` after a zero-row, seq-valid, non-coordinate response. Places rows keep the gray dot + no StatusBadge: external results never look like NAP facilities.

Steps:
- [ ] Add the zero-row hook in `performNapSearch` and the labeled section in the NAP panel area of the stack; symbol-picker rows stay tap-to-fly with the purple search marker (existing `flyToPlace`).
- [ ] Verify statically: fallback Photon request happens once per settled NAP search (not per keystroke), scope never switches silently.
- [ ] Commit: `feat(napmap): nearby-places fallback on empty NAP search, clearly labeled as external`

### Task 5: Verification (bundle, pure-function checks, runtime screenshots)

**Files:**
- No repo files; all verification scripts are scratch files in `$TMPDIR` (never committed).

**Interfaces:**
- Consumes: `mobile/src/utils/helpers.js` regex logic (read+eval to test `parseCoordinateInput` cases incl. `10.3157, 123.8854`, `10°18'56.5"N 123°53'07.4"E`, `101856N 1235307E`, invalid inputs).
- Produces: verification evidence reported back (bundle OK, parser table, screenshots).

Steps:
- [ ] `npx expo export --platform android` — expect bundled JS with no syntax errors.
- [ ] Node table-test of the coordinate parser (temp file in `$TMPDIR`, not committed).
- [ ] If an AVD/device is reachable: boot/install, `adb` text-search flows + `adb exec-out screencap` screenshots (layout stacking, places states, coordinate card, copy toast) — else record "not run" honestly and rely on bundle + Task 6 build.
- [ ] No commit (scratch only).

### Task 6: Build and deliver v1.4.5

**Files:**
- Modify (by build script): `mobile/app.json` (version `1.4.5.0`, versionCode 39)

Steps:
- [ ] `./build-apk.sh v1.4.5` (expects ANDROID_HOME + JDK 17 per script) — expect `apk/EBISU-TA-v1.4.5.apk` + refreshed `EBISU-TA.apk`; `apk/EBISU-TA-v1.4.4.apk` untouched.
- [ ] Commit staged `mobile/app.json` + Task 1–4 files already committed: `release: EBISU T&A v1.4.5 (versionCode 39) — NAP map search polish`
- [ ] Report: exact output path, version, versionCode, build result, criteria passed/failed, limitations.
