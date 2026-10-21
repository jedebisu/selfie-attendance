import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Search, RefreshCw, Download, ArrowUpDown, MapPin, CalendarDays, CalendarRange, CheckSquare, Trash2,
} from 'lucide-react';
import { workOrderAPI, exportUrl } from '../services/api';
import { useConfig, useTechnicians } from '../hooks/useConfig';
import { StatusBadge, ChannelBadge } from '../components/Badges';
import { C } from '../theme';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
import TechnicianSelect from '../components/TechnicianSelect';
import WorkOrderDrawer from '../components/WorkOrderDrawer';
import ClearAllDialog from '../components/ClearAllDialog';
import useSyncRefresh from '../hooks/useSyncRefresh';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZES = [20, 50, 100];

function SortHeader({ label, k, sort, onSort }) {
  const active = sort.sort_by === k;
  return (
    <th className="sortable" onClick={() => onSort(k)}>
      <span className="flex" style={{ gap: 4 }}>
        {label}
        <ArrowUpDown size={12} style={{ opacity: active ? 1 : 0.4 }} />
        {active && <span className="muted">{sort.sort_dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  );
}

export default function WorkOrders() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { config } = useConfig();
  const roster = useTechnicians();
  const [options, setOptions] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [drawerId, setDrawerId] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [editCell, setEditCell] = useState(null);
  const [savingTechId, setSavingTechId] = useState(null);
  const [filters, setFilters] = useState(() => ({
    q: searchParams.get('q') || '',
    status: searchParams.get('status') || '',
    channel: searchParams.get('channel') || '',
    area: searchParams.get('area') || '',
    territory: searchParams.get('territory') || '',
    barangay: searchParams.get('barangay') || '',
    unmapped: searchParams.get('unmapped') === 'true',
    no_channel: searchParams.get('no_channel') === 'true',
    coord_conflict: searchParams.get('coord_conflict') === 'true',
  }));
  const [sort, setSort] = useState({ sort_by: 'updated_at', sort_dir: 'desc' });
  const debounceRef = useRef(null);
  const [dateRange, setDateRange] = useState(() =>
    (searchParams.get('date_from') || searchParams.get('date_to')) ? 'custom' : 'all');
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('date_from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('date_to') || '');
  const [clearOpen, setClearOpen] = useState(false);
  const [drillIds, setDrillIds] = useState(null);

  const fmtDate = (d) => {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };

  const dateBounds = useMemo(() => {
    const today = new Date();
    if (dateRange === 'today') return { from: fmtDate(today), to: fmtDate(today) };
    if (dateRange === 'yesterday') {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return { from: fmtDate(d), to: fmtDate(d) };
    }
    if (dateRange === 'last_7') {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      return { from: fmtDate(d), to: fmtDate(today) };
    }
    if (dateRange === 'this_month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: fmtDate(start), to: fmtDate(end) };
    }
    if (dateRange === 'custom') {
      if (customFrom && customTo && customFrom > customTo) return { invalid: true };
      return { from: customFrom, to: customTo };
    }
    return null;
  }, [dateRange, customFrom, customTo]);

  const dateActive = !!(dateBounds && !dateBounds.invalid && (dateBounds.from || dateBounds.to));

  const [apptRange, setApptRange] = useState('all');
  const [apptFrom, setApptFrom] = useState('');
  const [apptTo, setApptTo] = useState('');

  const apptBounds = useMemo(() => {
    const today = new Date();
    const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return fmtDate(d); };
    if (apptRange === 'today') return { from: fmtDate(today), to: fmtDate(today) };
    if (apptRange === 'tomorrow') return { from: addDays(1), to: addDays(1) };
    if (apptRange === 'yesterday') return { from: addDays(-1), to: addDays(-1) };
    if (apptRange === 'next_7') return { from: fmtDate(today), to: addDays(7) };
    if (apptRange === 'this_month') {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return { from: fmtDate(start), to: fmtDate(end) };
    }
    if (apptRange === 'custom') {
      if (apptFrom && apptTo && apptFrom > apptTo) return { invalid: true };
      return { from: apptFrom, to: apptTo };
    }
    return null;
  }, [apptRange, apptFrom, apptTo]);

  const apptActive = !!(apptBounds && !apptBounds.invalid && (apptBounds.from || apptBounds.to));

  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (focusId && /^\d+$/.test(focusId)) setDrawerId(Number(focusId));
  }, [searchParams]);

  // Drill-down from the Technician Productivity report: ?ids=1,2,3 filters the
  // list to exactly that set (metric cells pass the exact ids they counted).
  useEffect(() => {
    const ids = searchParams.get('ids');
    if (ids) {
      const parsed = ids.split(',').map((v) => v.trim()).filter((v) => /^\d+$/.test(v));
      if (parsed.length) setDrillIds(parsed);
    }
  }, [searchParams]);

  const loadOptions = useCallback(() => {
    workOrderAPI.filterOptions().then(setOptions).catch(() => {});
  }, []);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  const fetchRows = useCallback(() => {
    setLoading(true);
    const params = { page, limit, ...sort };
    if (filters.q) params.q = filters.q;
    if (filters.status) params.status = filters.status;
    if (filters.channel) params.channel = filters.channel;
    if (filters.area) params.area = filters.area;
    if (filters.territory) params.territory = filters.territory;
    if (filters.barangay) params.barangay = filters.barangay;
    if (filters.unmapped) params.unmapped = 'true';
    if (filters.no_channel) params.no_channel = 'true';
    if (filters.coord_conflict) params.coord_conflict = 'true';
    if (dateBounds && !dateBounds.invalid) {
      if (dateBounds.from) params.date_from = dateBounds.from;
      if (dateBounds.to) params.date_to = dateBounds.to;
    }
    if (apptBounds && !apptBounds.invalid) {
      if (apptBounds.from) params.appointment_from = apptBounds.from;
      if (apptBounds.to) params.appointment_to = apptBounds.to;
    }
    if (drillIds && drillIds.length) params.ids = drillIds.join(',');
    workOrderAPI
      .list(params)
      .then((res) => {
        setRows(res.work_orders || []);
        setTotal(res.total || 0);
      })
      .catch(() => toast.error('Failed to load work orders'))
      .finally(() => setLoading(false));
  }, [page, limit, sort, filters, dateBounds, apptBounds, drillIds]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useSyncRefresh(fetchRows);

  const onQuery = (q) => {
    setFilters((f) => ({ ...f, q }));
    const t = debounceRef.current;
    clearTimeout(t);
    debounceRef.current = setTimeout(() => setPage(1), 400);
  };

  const setFilter = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  const toggleAll = () => {
    if (selected.size === rows.length && rows.length > 0) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.id)));
  };

  const toggleOne = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const onBulk = async () => {
    const payload = { ids: [...selected], ...bulk };
    try {
      await workOrderAPI.bulk(payload);
      toast.success(`${bulk.action} applied to ${selected.size} work orders`);
      setSelected(new Set());
      setBulk(null);
      fetchRows();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Bulk action failed');
    }
  };

  const openDrawer = (id) => setDrawerId(id);

  const saveStatusInline = async (wo, val) => {
    setEditCell(null);
    if (!val || val === wo.status) return;
    try {
      await workOrderAPI.setStatus(wo.id, { status: val });
      toast.success(`Status → ${val}`);
      fetchRows();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to update status');
    }
  };

  const saveChannelInline = async (wo, val) => {
    setEditCell(null);
    if (!val || val === wo.source_channel) return;
    try {
      await workOrderAPI.setChannel(wo.id, val);
      toast.success(`Channel → ${val}`);
      fetchRows();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to update channel');
    }
  };

  const assignTech = async (wo, value) => {
    if ((value || '') === (wo.assigned_technician || '')) return;
    setSavingTechId(wo.id);
    try {
      await workOrderAPI.setAssignment(wo.id, {
        assigned_technician: value || null,
        assigned_team: wo.assigned_team || null,
      });
      toast.success(value ? `Assigned to ${value}` : 'Assignment cleared');
      fetchRows();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save assignment');
    } finally {
      setSavingTechId(null);
    }
  };

  const statusCell = (wo) =>
    editCell?.id === wo.id && editCell?.field === 'status' ? (
      <select
        className="select badge-edit-menu"
        autoFocus
        defaultValue={wo.status}
        onChange={(e) => saveStatusInline(wo, e.target.value)}
        onBlur={() => setEditCell(null)}
      >
        <option value="">—</option>
        {statuses.map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
      </select>
    ) : (
      <span className="badge-edit" onClick={() => setEditCell({ id: wo.id, field: 'status' })} title="Change status">
        <StatusBadge status={wo.status} />
      </span>
    );

  const channelCell = (wo) =>
    editCell?.id === wo.id && editCell?.field === 'channel' ? (
      <select
        className="select badge-edit-menu"
        autoFocus
        defaultValue={wo.source_channel || ''}
        onChange={(e) => saveChannelInline(wo, e.target.value)}
        onBlur={() => setEditCell(null)}
      >
        <option value="">Unassigned</option>
        {channels.map((c) => <option key={c.code} value={c.code}>{c.label || c.code}</option>)}
      </select>
    ) : (
      <span className="badge-edit" onClick={() => setEditCell({ id: wo.id, field: 'channel' })} title="Assign channel">
        <ChannelBadge channel={wo.source_channel} />
      </span>
    );

  const statuses = options?.statuses || config?.statuses || [];
  const channels = options?.channels || config?.channels || [];

  const fitMap = (wo) => {
    if (wo.latitude != null && wo.longitude != null) {
      navigate(`/map?focus=${wo.id}`);
    } else {
      toast('This work order has no coordinates');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Work Orders</h1>
          <p className="subtitle">{total.toLocaleString()} records</p>
        </div>
        <div className="page-header-actions">
          <button className="btn" onClick={() => { loadOptions(); fetchRows(); }}><RefreshCw size={15} /> Refresh</button>
          <a className="btn" href={exportUrl(drillIds && drillIds.length ? { ids: drillIds.join(',') } : {})}><Download size={15} /> Export CSV</a>
          <a className="btn" href={exportUrl({ format: 'xlsx', ...(drillIds && drillIds.length ? { ids: drillIds.join(',') } : {}) })}><Download size={15} /> Export XLSX</a>
        </div>
      </div>

      {drillIds && drillIds.length > 0 && (
        <div className="card mb" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span className="small">
            Drill-down from Technician Productivity — showing exactly <strong>{drillIds.length}</strong> selected work order{drillIds.length === 1 ? '' : 's'} (matched: <strong>{total}</strong>).
          </span>
          <button className="btn" onClick={() => { setDrillIds(null); setPage(1); navigate('/workorders', { replace: true }); }}>Clear drill-down</button>
        </div>
      )}

      <div className="toolbar wrap">
        <div className="search-input grow">
          <Search size={15} />
          <input
            className="input"
            placeholder="Search WO number, customer, NAP, address, barangay..."
            value={filters.q}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <span className="flex" style={{ gap: 6, alignItems: 'center' }}>
          <CalendarDays size={15} className="muted" />
          <label className="muted small" htmlFor="dateRangeSel">Date:</label>
          <select
            id="dateRangeSel"
            className="select"
            style={{ maxWidth: 150 }}
            value={dateRange}
            onChange={(e) => { setDateRange(e.target.value); setPage(1); }}
          >
            <option value="all">All Dates</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_7">Last 7 Days</option>
            <option value="this_month">This Month</option>
            <option value="custom">Custom Range…</option>
          </select>
          {dateRange === 'custom' && (
            <>
              <input
                type="date"
                className="input"
                aria-label="Custom start date"
                style={{ maxWidth: 150 }}
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomFrom(v);
                  if (v && customTo && v > customTo) toast.error('Start date must be on or before the end date');
                  setPage(1);
                }}
              />
              <span className="muted">→</span>
              <input
                type="date"
                className="input"
                aria-label="Custom end date"
                style={{ maxWidth: 150 }}
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustomTo(v);
                  if (v && customFrom && customFrom > v) toast.error('Start date must be on or before the end date');
                  setPage(1);
                }}
              />
              {dateBounds?.invalid && (
                <span className="small" style={{ color: '#C2323A' }}>Start must be on or before end</span>
              )}
            </>
          )}
          {dateActive && (
            <button
              className="chip active"
              title="Clear date filter"
              onClick={() => {
                setDateRange('all');
                setCustomFrom('');
                setCustomTo('');
                setPage(1);
              }}
            >
              ✕ Clear date
            </button>
          )}
        </span>
        <span className="flex" style={{ gap: 6, alignItems: 'center' }}>
          <CalendarRange size={15} className="muted" />
          <label className="muted small" htmlFor="apptRangeSel">Appt:</label>
          <select
            id="apptRangeSel"
            className="select"
            style={{ maxWidth: 150 }}
            value={apptRange}
            onChange={(e) => { setApptRange(e.target.value); setPage(1); }}
          >
            <option value="all">All Appointments</option>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="yesterday">Yesterday</option>
            <option value="next_7">Next 7 Days</option>
            <option value="this_month">This Month</option>
            <option value="custom">Custom Range…</option>
          </select>
          {apptRange === 'custom' && (
            <>
              <input
                type="date"
                className="input"
                aria-label="Appointment start date"
                style={{ maxWidth: 150 }}
                value={apptFrom}
                max={apptTo || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setApptFrom(v);
                  if (v && apptTo && v > apptTo) toast.error('Start date must be on or before the end date');
                  setPage(1);
                }}
              />
              <span className="muted">→</span>
              <input
                type="date"
                className="input"
                aria-label="Appointment end date"
                style={{ maxWidth: 150 }}
                value={apptTo}
                min={apptFrom || undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setApptTo(v);
                  if (v && apptFrom && apptFrom > v) toast.error('Start date must be on or before the end date');
                  setPage(1);
                }}
              />
              {apptBounds?.invalid && (
                <span className="small" style={{ color: '#C2323A' }}>Start must be on or before end</span>
              )}
            </>
          )}
          {apptActive && (
            <button
              className="chip active"
              title="Clear appointment filter"
              onClick={() => {
                setApptRange('all');
                setApptFrom('');
                setApptTo('');
                setPage(1);
              }}
            >
              ✕ Clear appt
            </button>
          )}
        </span>
        <select className="select" style={{ maxWidth: 160 }} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 140 }} value={filters.channel} onChange={(e) => setFilter('channel', e.target.value)}>
          <option value="">All channels</option>
          {channels.map((c) => <option key={c.code} value={c.code}>{c.label || c.code}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={filters.area} onChange={(e) => setFilter('area', e.target.value)}>
          <option value="">All areas</option>
          {(options?.areas || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 160 }} value={filters.territory} onChange={(e) => setFilter('territory', e.target.value)}>
          <option value="">All territories</option>
          {(options?.territories || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className={`chip ${filters.unmapped ? 'active' : ''}`} onClick={() => setFilter('unmapped', !filters.unmapped)}>Unmapped</button>
        <button className={`chip ${filters.no_channel ? 'active' : ''}`} onClick={() => setFilter('no_channel', !filters.no_channel)}>No channel</button>
        <button className={`chip ${filters.coord_conflict ? 'active' : ''}`} onClick={() => setFilter('coord_conflict', !filters.coord_conflict)}>Coord conflicts</button>
        {user?.is_admin && (
          <button
            className="btn btn-danger"
            style={{ marginLeft: 'auto', flexShrink: 0 }}
            title="Delete every work order in this environment. Requires admin and typed confirmation."
            onClick={(e) => { e.stopPropagation(); setClearOpen(true); }}
          >
            <Trash2 size={15} /> Clear All Work Orders
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="alert alert-info" style={{ marginTop: 0 }}>
          <CheckSquare size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div className="flex wrap" style={{ flex: 1, justifyContent: 'space-between' }}>
            <span><strong>{selected.size}</strong> selected</span>
            <span className="flex wrap">
              <select className="select" style={{ width: 150 }} onChange={(e) => { if (e.target.value) setBulk({ action: 'status', value: e.target.value }); e.target.value = ''; }}>
                <option value="">Set status…</option>
                {statuses.map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
              </select>
              <select className="select" style={{ width: 150 }} onChange={(e) => { if (e.target.value) setBulk({ action: 'channel', value: e.target.value }); e.target.value = ''; }}>
                <option value="">Set channel…</option>
                {channels.map((c) => <option key={c.code} value={c.code}>{c.label || c.code}</option>)}
              </select>
              <select className="select" style={{ width: 160 }} onChange={(e) => { if (e.target.value) setBulk({ action: 'technician', value: e.target.value }); e.target.value = ''; }}>
                <option value="">Assign technician…</option>
                {(options?.technicians || []).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <button className="btn btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </span>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 34 }}><input type="checkbox" className="checkrow" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></th>
              <SortHeader label="Work Order" k="work_order_number" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <SortHeader label="Customer Name" k="customer_name" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <th>CONTACT NUMBER</th>
              <SortHeader label="ADDRESS" k="customer_address" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <th>SERVICE ID NUMBER</th>
              <th>ACCOUNT NUMBER</th>
              <SortHeader label="Facility / NAP" k="facility" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <SortHeader label="Channel" k="source_channel" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <SortHeader label="Status" k="status" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <SortHeader label="Territory" k="territory" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <SortHeader label="Appointment" k="appointment" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <SortHeader label="Technician" k="assigned_technician" sort={sort} onSort={(k) => setSort((s) => ({ sort_by: k, sort_dir: s.sort_dir === 'asc' ? 'desc' : 'asc' }))} />
              <th>Contractor</th>
              <th style={{ width: 50 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((wo) => (
              <tr key={wo.id} className={selected.has(wo.id) ? 'selected' : ''}>
                <td><input type="checkbox" className="checkrow" checked={selected.has(wo.id)} onChange={() => toggleOne(wo.id)} /></td>
                <td><span className="wo-link" onClick={() => openDrawer(wo.id)}>{wo.work_order_number || `#${wo.id}`}</span></td>
                <td>{wo.customer_name || <span className="muted">—</span>}</td>
                <td className="muted small mono">{wo.customer_contact || '—'}</td>
                <td className="muted small">{wo.customer_address || '—'}</td>
                <td className="muted small mono">{wo.extra?.serviceidnumber || wo.extra?.serviceIdNumber || wo.extra?.serviceId || '—'}</td>
                <td className="muted small mono">{wo.extra?.accountnumber || wo.extra?.accountNumber || '—'}</td>
                <td>
                  <div>{wo.facility || <span className="muted">—</span>}</div>
                  {wo.nap_id ? (
                    <a className="wo-link mono small" onClick={(e) => { e.preventDefault(); navigate(`/naps?nap_id=${encodeURIComponent(wo.nap_id)}&open=1`); }}>{wo.nap_id}</a>
                  ) : null}
                  {wo.coord_conflict && <span title="Coordinate conflict" style={{ color: C.danger }}> ⚠</span>}
                  {wo.nap_match_status === 'not_found' && <span title="NAP not found" style={{ color: C.danger }}> ✕</span>}
                </td>
                <td>{channelCell(wo)}</td>
                <td>{statusCell(wo)}</td>
                <td className="muted small">
                  {wo.territory || '—'}
                  {wo.barangay && <div>{wo.barangay}</div>}
                </td>
                <td className="muted small">{(wo.appointment || '').split(' ')[0] || '—'}</td>
                <td>
                  <div className="flex" style={{ gap: 4, alignItems: 'center' }}>
                    <TechnicianSelect
                      value={wo.assigned_technician}
                      roster={roster}
                      saving={savingTechId === wo.id}
                      onChange={(v) => assignTech(wo, v)}
                      style={{ padding: '2px 6px', fontSize: 12, minWidth: 0, maxWidth: 200 }}
                    />
                    {savingTechId === wo.id && <span className="spinner-sm" title="Saving…" />}
                  </div>
                </td>
                <td className="muted small">{wo.contractor || '—'}</td>
                <td>
                  <button className="icon-btn" title="Show on map" onClick={() => fitMap(wo)}><MapPin size={15} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
                              <tr><td colSpan={15} className="empty">No work orders match these filters{dateActive ? ' for the selected date range' : ''}{apptActive ? ' for the selected appointment range' : ''}. Try different filters or import a file to get started.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} pages={Math.max(1, Math.ceil(total / limit))} total={total} limit={limit} onChange={setPage} />
      <div className="flex" style={{ justifyContent: 'flex-end' }}>
        <select className="select" style={{ width: 110 }} value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} rows</option>)}
        </select>
      </div>

      <ConfirmDialog
        open={!!bulk}
        title={`Apply bulk ${bulk?.action}?`}
        message={`This will ${bulk?.action === 'status' ? `change status to "${bulk?.value}"` : bulk?.action === 'channel' ? `assign channel "${bulk?.value}"` : `assign technician "${bulk?.value}"`} for ${selected.size} selected work orders.`}
        confirmLabel="Apply"
        onConfirm={onBulk}
        onCancel={() => setBulk(null)}
      />

      {drawerId && <WorkOrderDrawer workOrderId={drawerId} onClose={() => setDrawerId(null)} onChanged={() => fetchRows()} />}

      <ClearAllDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onDone={() => {
          setClearOpen(false);
          setPage(1);
          setSelected(new Set());
          fetchRows();
          toast.success('All work orders cleared');
        }}
      />
    </div>
  );
}