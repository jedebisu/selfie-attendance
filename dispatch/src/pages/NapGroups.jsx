import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Network, Search, MapPin, TriangleAlert, X,
} from 'lucide-react';
import { workOrderAPI } from '../services/api';
import { useConfig } from '../hooks/useConfig';
import { StatusBadge, ChannelBadge } from '../components/Badges';
import { C } from '../theme';
import Pagination from '../components/Pagination';
import WorkOrderDrawer from '../components/WorkOrderDrawer';
import { useSearchParams } from 'react-router-dom';

const SORTS = [
  ['volume', 'Volume'],
  ['nap_id', 'NAP ID'],
  ['pending', 'Pending'],
  ['delayed', 'Delayed'],
  ['completed', 'Completed'],
];

export default function NapGroups() {
  const { config } = useConfig();
  const [params, setParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState(params.get('q') || '');
  const [sortBy, setSortBy] = useState(params.get('sort') || 'volume');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [openNap, setOpenNap] = useState(params.get('nap_id') || null);
  const [drawerId, setDrawerId] = useState(null);
  const [detail, setDetail] = useState(null);

  const areas = config?.areas || [];
  const territories = config?.territories || [];
  const barangays = config?.barangays || [];
  const statuses = config?.statuses || [];
  const [area, setArea] = useState('');
  const [territory, setTerritory] = useState('');
  const [barangay, setBarangay] = useState('');
  const [status, setStatus] = useState('');
  const seqRef = useRef(0);

  const fetchList = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    const p = { page, limit: 24, sort_by: sortBy, sort_dir: sortDir };
    if (q) p.q = q;
    if (area) p.area = area;
    if (territory) p.territory = territory;
    if (barangay) p.barangay = barangay;
    if (status) p.status = status;
    workOrderAPI.napGroups(p)
      .then((res) => {
        if (seq !== seqRef.current) return;
        setRows(res.groups || []);
        setTotal(res.total || res.count || 0);
      })
      .catch(() => { if (seq === seqRef.current) toast.error('Failed to load NAP groups'); })
      .finally(() => { if (seq === seqRef.current) setLoading(false); });
  }, [page, q, area, territory, barangay, status, sortBy, sortDir]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const loadDetail = useCallback((napId) => {
    if (!napId) { setDetail(null); return; }
    workOrderAPI.napGroup(napId)
      .then((res) => setDetail(res))
      .catch(() => toast.error('Failed to load NAP detail'));
  }, []);

  useEffect(() => { loadDetail(openNap); }, [openNap, loadDetail]);

  const openGroup = (napId) => {
    setOpenNap(napId);
    setParams({ nap_id: napId, open: '1' });
  };
  const closeGroup = () => {
    setOpenNap(null);
    setParams({});
  };

  return (
    <div className="nap-groups">
      <div className="nap-groups-main">
        <div className="page-header">
          <div>
            <h1>NAP Groups</h1>
            <p className="subtitle">{total} NAP IDs with work orders</p>
          </div>
          <div className="page-header-actions">
            <div className="search-input" style={{ width: 220 }}>
              <Search size={15} />
              <input className="input" placeholder="Search NAP ID / building..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
            <div className="seg">
              {SORTS.map(([k, label]) => (
                <button
                  key={k}
                  className={`seg-btn ${sortBy === k ? 'active' : ''}`}
                  onClick={() => {
                    if (sortBy === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
                    else { setSortBy(k); setSortDir('desc'); }
                  }}
                >
                  {label} {sortBy === k && (sortDir === 'asc' ? '↑' : '↓')}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="toolbar wrap">
          <select className="select" style={{ maxWidth: 160 }} value={area} onChange={(e) => { setArea(e.target.value); setPage(1); }}>
            <option value="">All areas</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 160 }} value={territory} onChange={(e) => { setTerritory(e.target.value); setPage(1); }}>
            <option value="">All territories</option>
            {territories.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 160 }} value={barangay} onChange={(e) => { setBarangay(e.target.value); setPage(1); }}>
            <option value="">All barangays</option>
            {barangays.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 160 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
          </select>
          {(area || territory || barangay || status) && (
            <button className="chip active" title="Clear filters" onClick={() => { setArea(''); setTerritory(''); setBarangay(''); setStatus(''); setPage(1); }}>
              ✕ Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading"><div className="spinner" />Loading groups...</div>
        ) : (
          <div className="grid nap-grid">
            {rows.map((g) => (
              <div className="card nap-card" key={g.nap_id} onClick={() => openGroup(g.nap_id)}>
                <div className="flex-between" style={{ marginBottom: 8 }}>
                  <span className="nap-id mono"><Network size={14} /> <span className="ellipsis">{g.nap_id}</span></span>
                  <span className="tag">{g.total}</span>
                </div>
                {g.building_served && <div className="small muted ellipsis">{g.building_served}</div>}
                <div className="small muted ellipsis">
                  {g.city_name || ''}{g.city_name && g.nap_barangay ? ', ' : ''}{g.nap_barangay}
                </div>
                <div className="nap-meta">
                  <span className="tag" style={{ background: C.warningSoft, color: '#B45309' }}>{g.pending} pending</span>
                  {g.delayed > 0 && <span className="tag" style={{ background: C.dangerSoft, color: '#C2323A' }}>{g.delayed} delayed</span>}
                  <span className="tag" style={{ background: C.successSoft, color: '#15803D' }}>{g.completed} done</span>
                </div>
                {(g.unmapped > 0 || g.conflicted > 0 || g.nap_missing > 0) && (
                  <div className="small flex" style={{ gap: 10, marginTop: 6, color: C.danger }}>
                    {g.unmapped > 0 && <span className="flex" style={{ gap: 3, alignItems: 'center' }}><MapPin size={12} /> {g.unmapped}</span>}
                    {g.conflicted > 0 && <span className="flex" style={{ gap: 3, alignItems: 'center' }}><TriangleAlert size={12} /> {g.conflicted}</span>}
                    {g.nap_missing > 0 && <span className="flex" style={{ gap: 3, alignItems: 'center' }}><TriangleAlert size={12} /> missing</span>}
                  </div>
                )}
              </div>
            ))}
            {rows.length === 0 && <div className="card" style={{ gridColumn: '1 / -1' }}><div className="empty">No NAP groups found</div></div>}
          </div>
        )}

        <div className="nap-pagination">
          <Pagination page={page} pages={Math.max(1, Math.ceil(total / 24))} total={total} limit={24} onChange={setPage} />
        </div>
      </div>

      {detail && (
        <aside className="nap-detail">
          <div className="flex-between" style={{ marginBottom: 8 }}>
            <h3 className="mono"><Network size={15} style={{ verticalAlign: -2 }} /> {detail.nap_id}</h3>
            <button className="icon-btn" onClick={closeGroup}><X size={18} /></button>
          </div>

          {detail.nap ? (
            <div className="nap-detail-info">
              <div className="kv"><span className="k">Building</span><span className="v">{detail.nap.building_served || '—'}</span></div>
              <div className="kv"><span className="k">City / Province</span><span className="v">{[detail.nap.city_name, detail.nap.province_name].filter(Boolean).join(', ') || '—'}</span></div>
              <div className="kv"><span className="k">Barangay</span><span className="v">{detail.nap.barangay_name || '—'}</span></div>
              <div className="kv"><span className="k">Coordinates</span><span className="v mono">{detail.nap.dp_nap_lat}, {detail.nap.dp_nap_long}</span></div>
            </div>
          ) : (
            <div className="alert alert-warn" style={{ marginTop: 0 }}><TriangleAlert size={15} /> NAP ID not found in NAP database</div>
          )}

          <div className="small muted" style={{ margin: '10px 0 6px' }}>
            {detail.work_orders.length} work orders
          </div>
          <div className="nap-detail-list">
            {detail.work_orders.map((wo) => (
              <div key={wo.id} className="nap-wo-row" onClick={() => setDrawerId(wo.id)}>
                <div>
                  <div className="wo-link">{wo.work_order_number || `#${wo.id}`}</div>
                  <div className="small muted ellipsis">{wo.customer_name || '—'}</div>
                </div>
                <div className="flex" style={{ gap: 4 }}>
                  <StatusBadge status={wo.status} />
                  <ChannelBadge channel={wo.source_channel} />
                </div>
              </div>
            ))}
            {detail.work_orders.length === 0 && <div className="empty">No work orders for this NAP</div>}
          </div>
        </aside>
      )}

      {drawerId && <WorkOrderDrawer workOrderId={drawerId} onClose={() => setDrawerId(null)} onChanged={() => openNap && loadDetail(openNap)} />}
    </div>
  );
}