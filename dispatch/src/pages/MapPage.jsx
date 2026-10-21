import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import L from 'leaflet';
import { MapContainer, TileLayer, Marker, Popup, useMap, CircleMarker } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import { Search, Locate, MapPin } from 'lucide-react';
import { workOrderAPI } from '../services/api';
import { useConfig } from '../hooks/useConfig';
import { statusStyle } from '../components/Badges';
import { C } from '../theme';
import WorkOrderDrawer from '../components/WorkOrderDrawer';
import { useNavigate, useSearchParams } from 'react-router-dom';

import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

function coloredIcon(color) {
  return L.divIcon({
    className: 'wo-marker',
    html: `<div style="width:100%;height:100%;box-sizing:border-box;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10],
  });
}

function FitBounds({ bounds, focus, resetKey }) {
  const map = useMap();
  useEffect(() => {
    if (focus && focus.lat != null && focus.lng != null) {
      map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 14), { duration: 1 });
    } else if (bounds && bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [bounds, focus, resetKey]);
  return null;
}

export default function MapPage() {
  const navigate = useNavigate();
  const { config } = useConfig();
  const [params, setParams] = useSearchParams();
  const focusId = params.get('focus');
  const [filters, setFilters] = useState({ q: '', status: '', channel: '', area: '', territory: '', unmapped: false });
  const [groups, setGroups] = useState([]);
  const [individuals, setIndividuals] = useState([]);
  const [showIndividual, setShowIndividual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState(null);
  const [focus, setFocus] = useState(null);
  const [resetKey, setResetKey] = useState(0);

  const loadGroups = useCallback((f, showInd) => {
    setLoading(true);
    const p = {};
    if (f.status) p.status = f.status;
    if (f.channel) p.channel = f.channel;
    if (f.area) p.area = f.area;
    if (f.territory) p.territory = f.territory;
    if (f.unmapped) p.unmapped = 'true';
    if (f.q) p.q = f.q;
    workOrderAPI.napGroups({ ...p, limit: 500 }).then((res) => setGroups(res.groups || [])).catch(() => toast.error('Failed to load groups'));
    if (showInd) {
      workOrderAPI.list({ ...p, limit: 500, sort_by: 'updated_at', sort_dir: 'desc' })
        .then((res) => setIndividuals((res.work_orders || []).filter((w) => w.latitude != null && w.longitude != null)))
        .catch(() => {});
    } else {
      setIndividuals([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadGroups(filters, showIndividual); /* eslint-disable-line */ }, [filters.q, filters.status, filters.channel, filters.area, filters.territory, filters.unmapped, showIndividual]);

  // Focus: find that WO's coordinates
  useEffect(() => {
    if (focusId) {
      workOrderAPI.get(focusId).then((res) => {
        const wo = res.work_order;
        if (wo.latitude != null && wo.longitude != null) setFocus({ lat: wo.latitude, lng: wo.longitude });
        else toast('That work order has no coordinates');
      }).catch(() => {});
    }
  }, [focusId]);

  const mappedGroups = useMemo(
    () =>
      groups
        .filter((g) => g.lat != null && g.lng != null)
        .map((g) => ({ ...g, lat: Number(g.lat), lng: Number(g.lng) })),
    [groups]
  );

  const bounds = useMemo(() => {
    const pts = [
      ...mappedGroups.map((g) => [g.lat, g.lng]),
      ...individuals.map((w) => [Number(w.latitude), Number(w.longitude)]),
    ];
    if (!pts.length) return null;
    return L.latLngBounds(pts);
  }, [mappedGroups, individuals]);

  const statuses = config?.statuses || [];
  const areas = config?.areas || [];
  const territories = config?.territories || [];

  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Map</h1>
          <p className="subtitle">Live work order locations by NAP cluster</p>
        </div>
        <div className="page-header-actions">
          <div className="search-input" style={{ width: 250 }}>
            <Search size={15} />
            <input className="input" placeholder="Search NAP / source..." value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
          </div>
          <select className="select" style={{ maxWidth: 150 }} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 150 }} value={filters.area} onChange={(e) => setFilter('area', e.target.value)}>
            <option value="">All areas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 150 }} value={filters.territory} onChange={(e) => setFilter('territory', e.target.value)}>
            <option value="">All territories</option>
            {territories.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className={`chip ${filters.unmapped ? 'active' : ''}`} onClick={() => setFilter('unmapped', !filters.unmapped)}>Unmapped</button>
        </div>
      </div>

      <div className="map-shell">
        {loading && (
          <div className="map-loading"><div className="spinner" />Loading...</div>
        )}
        <MapContainer center={[14.5995, 120.9842]} zoom={5} className="map" worldCopyJump>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds bounds={bounds} focus={focus} resetKey={resetKey} />

          <MarkerClusterGroup chunkedLoading showCoverageOnHover={false}>
            {individuals.map((wo) => (
              <Marker key={wo.id} position={[wo.latitude, wo.longitude]} icon={coloredIcon(statusStyle(wo.status).color)}>
                <Popup>
                  <div className="pop">
                    <div className="pop-title"><strong>{wo.work_order_number || `#${wo.id}`}</strong></div>
                    <div>{wo.customer_name}</div>
                    <div className="small">
                      <span style={{ color: statusStyle(wo.status).color }}><strong>{wo.status}</strong></span>
                      {wo.source_channel && <span> · {wo.source_channel}</span>}
                    </div>
                    <div className="small muted">{wo.nap_id}</div>
                    <button className="btn btn-sm mt" onClick={() => setDrawerId(wo.id)}>Open details</button>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MarkerClusterGroup>

          {!showIndividual && mappedGroups.map((g) => (
            <CircleMarker
              key={g.nap_id}
              center={[g.lat, g.lng]}
              radius={Math.min(8 + Math.round(Math.sqrt(g.total) * 2.2), 24)}
              pathOptions={{
                color: C.text,
                weight: 1,
                fillColor: g.delayed > 0 ? C.danger : g.pending > 0 ? C.warning : C.success,
                fillOpacity: 0.75,
              }}
            >
              <Popup>
                <div className="pop">
                  <div className="pop-title"><strong>{g.nap_id}</strong></div>
                  {g.building_served && <div className="small">{g.building_served}</div>}
                  <div className="pop-stats">
                    {g.pending > 0 && <span className="tag" style={{ background: C.warningSoft, color: '#B45309' }}>{g.pending} pending</span>}
                    {g.delayed > 0 && <span className="tag" style={{ background: C.dangerSoft, color: '#C2323A' }}>{g.delayed} delayed</span>}
                    <span className="tag" style={{ background: C.successSoft, color: '#15803D' }}>{g.completed} done</span>
                  </div>
                  <button className="btn btn-sm mt" onClick={() => navigate(`/naps?nap_id=${encodeURIComponent(g.nap_id)}&open=1`)}>View NAP group</button>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {mappedGroups.length === 0 && individuals.length === 0 && !loading && (
            <Marker position={[14.5995, 120.9842]} icon={coloredIcon(C.slate)}>
              <Popup>No locations match the current filters.</Popup>
            </Marker>
          )}
        </MapContainer>

        <div className="map-legend">
          <div className="legend-title">Legend</div>
          <div className="legend-item"><span style={{ background: C.success }} /> Cluster — no pending</div>
          <div className="legend-item"><span style={{ background: C.warning }} /> Cluster — pending</div>
          <div className="legend-item"><span style={{ background: C.danger }} /> Cluster — has delayed</div>
          {['NEW', 'ASSIGNED', 'IN PROGRESS', 'COMPLETED', 'DELAYED', 'ON HOLD'].map((s) => (
            <div key={s} className="legend-item"><span style={{ background: statusStyle(s).color }} /> {s}</div>
          ))}
        </div>

        <div className="map-tools">
          <label className="chip check-chip">
            <input type="checkbox" checked={showIndividual} onChange={(e) => setShowIndividual(e.target.checked)} />
            Show individual WOs
          </label>
          <button className="icon-btn" title="Re-center" onClick={() => { setFocus(null); setParams({}); setResetKey((k) => k + 1); }}>
            <Locate size={16} />
          </button>
        </div>
      </div>

      {drawerId && <WorkOrderDrawer workOrderId={drawerId} onClose={() => setDrawerId(null)} onChanged={() => {}} />}
    </div>
  );
}