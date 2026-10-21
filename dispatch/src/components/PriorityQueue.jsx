import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Search, RefreshCw } from 'lucide-react';
import { workOrderAPI } from '../services/api';
import { StatusBadge } from './Badges';
import Pagination from './Pagination';
import useSyncRefresh from '../hooks/useSyncRefresh';

// Scopes are all backed by real business rules — never an invented SLA:
//   priority : DELAYED status OR non-terminal with an appointment before today
//   overdue  : non-terminal with an appointment before today (Asia/Manila)
//   delayed  : status = DELAYED
const SCOPES = [
  ['priority', 'Priority · delayed or overdue'],
  ['overdue', 'Overdue only'],
  ['delayed', 'Delayed only'],
];

const SORTS = [
  ['appointment', 'asc', 'Appointment (oldest first)'],
  ['appointment', 'desc', 'Appointment (newest first)'],
  ['date_created', 'desc', 'Most recently created'],
];

function dayOf(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function ageDays(createdDay, todayISO) {
  const a = dayOf(createdDay);
  if (!a || !todayISO) return null;
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = todayISO.split('-').map(Number);
  const diff = (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000;
  return Number.isFinite(diff) ? Math.max(0, Math.round(diff)) : null;
}

export default function PriorityQueue({ today, dateFrom, dateTo, area, territory, technician }) {
  const [scope, setScope] = useState('priority');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sortIdx, setSortIdx] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { setPage(1); }, [scope, debouncedQ, sortIdx, dateFrom, dateTo, area, territory, technician]);

  const params = useMemo(() => {
    const [sort_by, sort_dir] = SORTS[sortIdx];
    const p = { page, limit, sort_by, sort_dir };
    if (dateFrom) p.date_from = dateFrom;
    if (dateTo) p.date_to = dateTo;
    if (area) p.area = area;
    if (territory) p.territory = territory;
    if (technician) p.assigned_technician = technician;
    if (debouncedQ) p.q = debouncedQ;
    if (scope === 'priority') p.priority = 'true';
    if (scope === 'overdue') p.overdue = 'true';
    if (scope === 'delayed') p.status = 'DELAYED';
    return p;
  }, [page, limit, sortIdx, scope, debouncedQ, dateFrom, dateTo, area, territory, technician]);

  const load = useCallback(() => {
    setLoading(true);
    workOrderAPI
      .list(params)
      .then((res) => {
        setRows(res.work_orders || []);
        setTotal(res.total || 0);
        setPages(res.pages || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => { load(); }, [load]);
  useSyncRefresh(load);

  return (
    <div className="card mb">
      <div className="flex-between wrap" style={{ marginBottom: 10, gap: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>
          <AlertTriangle size={15} /> Priority queue
          <span className="muted small" style={{ fontWeight: 400, marginLeft: 8 }}>
            delayed or overdue work · no SLA applied
          </span>
        </div>
        <div className="flex wrap" style={{ gap: 8, alignItems: 'center' }}>
          <select className="select" style={{ maxWidth: 210 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            {SCOPES.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
          </select>
          <select className="select" style={{ maxWidth: 200 }} value={sortIdx} onChange={(e) => setSortIdx(Number(e.target.value))}>
            {SORTS.map(([, , lbl], i) => <option key={lbl} value={i}>{lbl}</option>)}
          </select>
          <div className="search-input">
            <Search size={15} />
            <input
              className="input"
              style={{ minWidth: 200 }}
              placeholder="Search WO, customer, NAP…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn" onClick={load} title="Refresh priority queue"><RefreshCw size={15} /></button>
        </div>
      </div>

      <div className="table-hscroll">
        <table className="table">
          <thead>
            <tr>
              <th>Work order</th>
              <th>Type</th>
              <th>Area</th>
              <th>Territory</th>
              <th>Technician</th>
              <th>Status</th>
              <th>Appointment</th>
              <th className="num">Age (days)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className="wo-link" to={`/workorders?focus=${r.id}`}>{r.work_order_number || `#${r.id}`}</Link>
                  {r.customer_name && <div className="muted small">{r.customer_name}</div>}
                </td>
                <td>{r.extra?.type || '—'}</td>
                <td>{r.area || '—'}</td>
                <td>{r.territory || '—'}</td>
                <td>{r.assigned_technician ? <span className="mono">{r.assigned_technician}</span> : <span className="muted">Unassigned</span>}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{dayOf(r.appointment) || '—'}</td>
                <td className="num">{ageDays(r.date_created || r.created_at, today) ?? '—'}</td>
                <td><Link className="btn btn-sm" to={`/workorders?focus=${r.id}`}>Open</Link></td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="empty">Nothing in the priority queue for the current filters.</td></tr>
            )}
            {loading && rows.length === 0 && (
              <tr><td colSpan={9} className="empty">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt">
        <Pagination page={page} pages={pages} total={total} limit={limit} onChange={setPage} />
      </div>
    </div>
  );
}
