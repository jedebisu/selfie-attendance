import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Layers3, RefreshCw, User } from 'lucide-react';
import { workOrderAPI } from '../services/api';
import { useConfig, useTechnicians } from '../hooks/useConfig';
import { StatusBadge, ChannelBadge } from '../components/Badges';
import { C } from '../theme';
import TechnicianSelect from '../components/TechnicianSelect';
import WorkOrderDrawer from '../components/WorkOrderDrawer';
import useSyncRefresh from '../hooks/useSyncRefresh';

function toggle(sel, v) {
  if (!sel.includes(v)) return sel.concat(v);
  return sel.filter((x) => x !== v);
}

export default function DispatchBoard() {
  const { config } = useConfig();
  const [view, setView] = useState('status');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState(null);
  const [statusSel, setStatusSel] = useState([]);
  const [techSel, setTechSel] = useState('');

  const statuses = config?.statuses || [];
  const technicians = useMemo(() => [...new Set(rows.map((r) => r.assigned_technician).filter(Boolean))], [rows]);
  const roster = useTechnicians();
  const [savingId, setSavingId] = useState(null);

  const fetchRows = useCallback(() => {
    setLoading(true);
    const p = { limit: 500, sort_by: 'updated_at', sort_dir: 'desc' };
    if (statusSel.length) p.status = statusSel.join(',');
    if (view === 'tech' && techSel) p.assigned_technician = techSel;
    workOrderAPI.list(p)
      .then((res) => setRows(res.work_orders || []))
      .catch(() => toast.error('Failed to load board'))
      .finally(() => setLoading(false));
  }, [statusSel, techSel, view]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useSyncRefresh(fetchRows);

  const grouped = useMemo(() => {
    if (view === 'status') {
      const map = {};
      for (const s of statuses) map[s.code] = [];
      for (const wo of rows) {
        (map[wo.status] ||= []).push(wo);
      }
      return map;
    }
    const map = { Unassigned: [] };
    for (const wo of rows) {
      const k = wo.assigned_technician || 'Unassigned';
      (map[k] ||= []).push(wo);
    }
    return map;
  }, [rows, statuses, view]);

  const assignTech = async (wo, value) => {
    setSavingId(wo.id);
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
      setSavingId(null);
    }
  };

  const columnKeys = view === 'status' ? Object.keys(grouped) : Object.keys(grouped).sort();
  const STATUS_COLORS = { COMPLETED: C.success, DELAYED: C.danger, CANCELLED: C.slate };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dispatch Board</h1>
          <p className="subtitle">Work orders grouped for daily dispatch</p>
        </div>
        <div className="page-header-actions">
          <div className="seg">
            <button className={`seg-btn ${view === 'status' ? 'active' : ''}`} onClick={() => setView('status')}><Layers3 size={14} /> By status</button>
            <button className={`seg-btn ${view === 'tech' ? 'active' : ''}`} onClick={() => setView('tech')}><User size={14} /> By technician</button>
          </div>
          {view === 'tech' && (
            <select className="select" style={{ width: 180 }} value={techSel} onChange={(e) => setTechSel(e.target.value)}>
              <option value="">All technicians</option>
              {technicians.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select
            className="select"
            style={{ width: 220 }}
            value=""
            onChange={(e) => { if (e.target.value) { setStatusSel((s) => [...s, e.target.value]); } }}
          >
            <option value="">+ Filter by status…</option>
            {statuses.map((s) => <option key={s.code} value={s.code} disabled={statusSel.includes(s.code)}>{s.label || s.code}</option>)}
          </select>
          <button className="btn" onClick={fetchRows}><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>

      {statusSel.length > 0 && (
        <div className="alert alert-info" style={{ marginTop: 0 }}>
          {statusSel.map((s) => (
            <span key={s} className="tag" style={{ cursor: 'pointer', marginRight: 6 }} onClick={() => setStatusSel((x) => toggle(x, s))}>
              {s} ✕
            </span>
          ))}
          <button className="btn btn-sm" onClick={() => setStatusSel([])}>Clear</button>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading board...</div>
      ) : (
        <div className="board">
          {columnKeys.map((key) => {
            const items = grouped[key] || [];
            const accent = STATUS_COLORS[key] || C.primary;
            return (
              <div className="board-col" key={key}>
                <div className="board-head" style={{ borderColor: accent }}>
                  <span style={{ color: accent }}><strong>{key}</strong></span>
                  <span className="tag">{items.length}</span>
                </div>
                <div className="board-body">
                  {items.map((wo) => (
                    <div key={wo.id} className="board-card" onClick={() => setDrawerId(wo.id)}>
                      <div className="flex-between" style={{ marginBottom: 4 }}>
                        <span className="wo-link">{wo.work_order_number || `#${wo.id}`}</span>
                        <StatusBadge status={wo.status} />
                      </div>
                      <div className="small" style={{ fontWeight: 600 }}>{wo.customer_name || '—'}</div>
                      {wo.customer_address ? <div className="small muted ellipsis">{wo.customer_address}</div> : null}
                      {wo.territory || wo.barangay ? <div className="small muted ellipsis">{[wo.territory, wo.barangay].filter(Boolean).join(' · ')}</div> : null}
                      {wo.nap_id && <div className="small muted mono">{wo.nap_id}</div>}
                      <div className="flex-between" style={{ marginTop: 6 }}>
                        <TechnicianSelect
                          value={wo.assigned_technician}
                          roster={roster}
                          saving={savingId === wo.id}
                          onChange={(v) => assignTech(wo, v)}
                          style={{ flex: 1, minWidth: 0, marginRight: 6, padding: '2px 6px', fontSize: 12, height: 26 }}
                        />
                        <ChannelBadge channel={wo.source_channel} />
                      </div>
                      {wo.delay_reason && <div className="small" style={{ color: '#C2323A', marginTop: 4 }}>⏱ {wo.delay_reason}</div>}
                    </div>
                  ))}
                  {items.length === 0 && <div className="board-empty">No work orders</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {drawerId && <WorkOrderDrawer workOrderId={drawerId} onClose={() => setDrawerId(null)} onChanged={() => fetchRows()} />}
    </div>
  );
}