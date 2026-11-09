# NAP Search UX Test Plan

**Commit:** `12c96e39` - Remove blocking unified results panel

## What Changed

**Before (blocking overlay):**
- Search triggered a large panel covering the map with "NAP FACILITIES" and "PLACES & LOCATIONS" sections
- Panel blocked map view during search
- Photon places search ran in parallel

**After (Google Maps style):**
- Just a search bar at top
- Map stays fully visible during search
- Results show as map markers + in list view toggle
- No overlay blocking the map

## Manual Test Steps

### 1. Build and Install Mobile App
```bash
cd mobile
npx expo build:android --type apk  # or use existing EBISU-TA.apk
# Install on device/emulator
```

### 2. Test Search Flow

**A. Search for a NAP (e.g., "BAL_001")**
- Tap search bar at top
- Type "BAL_001"
- **Expected:** 
  - ✓ Search bar shows query
  - ✓ Map stays visible (no overlay blocking view)
  - ✓ Matching NAP markers appear on map with color-coded dots
  - ✓ Status chips (All/In Service/Out of Service/Planned) visible below search
  - ✓ "X search results" count shows at bottom
  - ✓ Tap list toggle → see results in list view
  - ✓ Tap map marker → NAP details slide up from bottom

**B. Search for coordinates (e.g., "10.3157, 123.8854")**
- Type coordinates in search bar
- **Expected:**
  - ✓ Coordinate result card appears below search bar
  - ✓ Map flies to location with pin
  - ✓ No "NAP FACILITIES" or "PLACES & LOCATIONS" sections
  - ✓ Copy buttons work for lat/lng

**C. Empty search**
- Clear search (tap X)
- **Expected:**
  - ✓ Map returns to nearby NAPs mode
  - ✓ "X NAPs within 1km" status shows
  - ✓ No overlay or blocking panels

**D. Status filter during search**
- Search "BAL" → tap "In Service" chip
- **Expected:**
  - ✓ Results filter to In Service only
  - ✓ Map markers update
  - ✓ No overlay blocking view

### 3. What Should NOT Appear
- ❌ "NAP FACILITIES" heading/section
- ❌ "PLACES & LOCATIONS" heading/section
- ❌ White overlay panel covering map during search
- ❌ "Searching NAP facilities..." spinner overlay
- ❌ Photon/external places results

### 4. Regression Check
- ✓ Long-press map → drop pin → nearby NAPs update
- ✓ Tap NAP → details panel → "Get Directions" → route draws
- ✓ Live location tracking during shift (if enabled)
- ✓ NAP status badges (green/orange/gray) render correctly
- ✓ Data last updated timestamp shows

## Code Changes Summary

**Removed:**
- `renderUnifiedResults()` — entire overlay panel (~125 lines)
- `renderNapSearchRow()` — overlay-specific row renderer
- Photon places search engine (`runPlacesSearch`, `flyToPlace`, `placeKind`, etc.)
- Dead state: `placeResults`, `placesPhase`, `placeSeqRef`, `mapRegionRef`

**Preserved:**
- NAP search API calls (`/api/naps/search`)
- Map markers rendering (`displayNaps` → `renderNapMarker`)
- List view toggle and FlatList
- Coordinate parsing and card
- Status filter chips
- All nearby/route/live location features

**Net change:** -249 lines, bundle size 3.24 MB (was 3.25 MB)

## Acceptance Criteria

✅ Search UX matches Google Maps: search bar at top, map always visible  
✅ NAP search results show as markers + in list, no blocking overlay  
✅ Coordinate search still works with result card  
✅ Status filtering works during search  
✅ All existing map features (pin drop, routes, live tracking) unaffected

## Rollback Plan

If issues found:
```bash
git revert 12c96e39
# Restores unified panel with NAP FACILITIES / PLACES & LOCATIONS sections
```
