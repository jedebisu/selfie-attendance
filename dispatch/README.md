# EBISU Work Order Dispatch Console

Web app for the Selfie-Attendance monorepo's work order dispatch system. Import Excel/CSV work orders, map them to NAPs, dispatch, and report.

## Run

```bash
# 1. Backend (must be running first)
cd ../server
npm run dev            # port 3001

# 2. This app
cd ../dispatch
npm install
npm run dev            # port 5173 → /api proxied to localhost:3001
```

Open http://localhost:5173. Login with the Selfie-Attendance seed accounts:
`EMP001/123456` (admin) · `EMP002/5678` · `EMP003/9012`.

Production build: `npm run build` (outputs to `dist/`). Point `VITE_API_URL` at the deployed API if not using the proxy.

## Pages

- **Dashboard** — KPI cards, status/channel/area breakdowns, daily/weekly/monthly trend, top NAPs, data quality.
- **Work Orders** — search + filters (status/channel/area/territory/unmapped/conflicts), sort, pagination, multi-select bulk status/channel/technician, CSV/XLSX export, detail drawer with full edit + history.
- **Map View** — Leaflet + OpenStreetMap. NAP cluster circles sized by volume and colored by state (green none-pending, amber pending, red delayed); toggle to show individual work orders clustered by markercluster. No API key needed.
- **NAP Groups** — group cards sorted by volume/pending/delayed, click to open the NAP detail panel with a work order list.
- **Dispatch Board** — kanban by status or by technician for daily dispatch.
- **Import** — upload CSV/XLSX, auto column mapping (editable), preview with add/update/duplicate/reject rows and warnings (NAP not found, coord conflicts, unmapped, missing channel), options (trust imported COMPLETED / allow missing WO numbers), commit, and import history.
- **Reports & Audit** — group by any dimension with charts + share bars, trend analysis, filtered export.
- **Settings** — statuses, channels (admin), and the technician roster.

## Notes

- NAP locations come from the authoritative `naps` table in the Selfie-Attendance DB; uploaded coordinates are validated against it (150 m conflict threshold) instead of being trusted blindly.
- Manual edits to status/channel are preserved across re-imports.
- Signs never fabricate coordinates — unmapped work orders are flagged, never dropped on the map at a guessed point.
- API base defaults to `/api` (Vite proxy). Set `VITE_API_URL` for a remote API.