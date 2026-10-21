import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  X, MapPin, Phone, User, Wrench, Download, History, AlertTriangle,
  Save, ArrowLeftRight, Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { workOrderAPI } from '../services/api';
import { useConfig, useTechnicians } from '../hooks/useConfig';
import { StatusBadge, ChannelBadge } from './Badges';
import { C } from '../theme';
import ConfirmDialog from './ConfirmDialog';
import ErrorBoundary from './ErrorBoundary';
import { useAuth } from '../context/AuthContext';
import { format } from 'date-fns';

function fmtDate(v) {
  if (!v) return '—';
  try {
    return format(new Date(v), 'MMM d, yyyy h:mm a');
  } catch (_) {
    return '—';
  }
}

export default function WorkOrderDrawer({ workOrderId, onClose, onChanged }) {
  const { config } = useConfig();
  const { user } = useAuth();
  const roster = useTechnicians();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [completionNotes, setCompletionNotes] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [channel, setChannel] = useState('');
  const [technician, setTechnician] = useState('');
  const [team, setTeam] = useState('');
  const [note, setNote] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [edits, setEdits] = useState(null);

  const load = () => {
    setLoading(true);
    setLoadError('');
    workOrderAPI
      .get(workOrderId)
      .then((res) => {
        const wo = res.work_order;
        setData({ ...res, work_order: wo });
        setStatus(wo.status || '');
        setDelayReason(wo.delay_reason || '');
        setCompletionNotes(wo.completion_notes || '');
        setChannel(wo.source_channel || '');
        setTechnician(wo.assigned_technician || '');
        setTeam(wo.assigned_team || '');
        setEdits({
          customer_name: wo.customer_name || '',
          customer_address: wo.customer_address || '',
          customer_contact: wo.customer_contact || '',
          nap_id: wo.nap_id || '',
          dispatch_notes: wo.dispatch_notes || '',
          area: wo.area || '',
          territory: wo.territory || '',
          barangay: wo.barangay || '',
          facility: wo.facility || '',
          contractor: wo.contractor || '',
          appointment: (wo.appointment || '').split(' ')[0],
        });
      })
      .catch((e) => setLoadError(e.response?.data?.error || 'Failed to load work order'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (workOrderId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  const wo = data?.work_order;
  const statuses = config?.statuses || [];
  const channels = config?.channels || [];

  if (loading || !data) {
    if (loadError) {
      return (
        <div className="drawer-backdrop" onClick={onClose}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-body">
              <div className="alert alert-warn" style={{ marginTop: 0 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong>Could not load this work order.</strong>
                  <div className="muted small">{loadError}</div>
                </div>
              </div>
              <div className="form-row">
                <button className="btn" onClick={load}>Retry</button>
                <button className="btn" onClick={onClose}>Close</button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="drawer-backdrop" onClick={onClose}>
        <div className="drawer"><div className="loading"><div className="spinner" />Loading...</div></div>
      </div>
    );
  }

  const refresh = () => {
    workOrderAPI.get(workOrderId).then((res) => {
      setData(res);
      setStatus(res.work_order.status || '');
      setDelayReason(res.work_order.delay_reason || '');
      setCompletionNotes(res.work_order.completion_notes || '');
      setChannel(res.work_order.source_channel || '');
      setTechnician(res.work_order.assigned_technician || '');
      setTeam(res.work_order.assigned_team || '');
      onChanged?.(res.work_order);
    });
  };

  const saveStatus = async () => {
    if (!status) return toast.error('Select a status');
    setSaving(true);
    try {
      await workOrderAPI.setStatus(workOrderId, {
        status,
        note: statusNote,
        delay_reason: status === 'DELAYED' ? delayReason : undefined,
        completion_notes: status === 'COMPLETED' ? completionNotes : undefined,
      });
      toast.success(`Status updated to ${status}`);
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  const saveChannel = async () => {
    if (!channel) return;
    setSaving(true);
    try {
      await workOrderAPI.setChannel(workOrderId, channel);
      toast.success('Channel assigned');
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to assign channel');
    } finally {
      setSaving(false);
    }
  };

  const saveAssignment = async () => {
    setSaving(true);
    try {
      await workOrderAPI.setAssignment(workOrderId, {
        assigned_technician: technician || null,
        assigned_team: team || null,
      });
      toast.success('Assignment saved');
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save assignment');
    } finally {
      setSaving(false);
    }
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      const payload = {};
      for (const [k, v] of Object.entries(edits)) {
        if (String(wo[k] ?? '') !== String(v ?? '')) payload[k] = v;
      }
      if (Object.keys(payload).length === 0) {
        toast('No changes');
        return;
      }
      await workOrderAPI.update(workOrderId, payload);
      toast.success('Changes saved');
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await workOrderAPI.addNote(workOrderId, note.trim(), 'dispatch');
      setNote('');
      toast.success('Note added');
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  const deleteWo = async () => {
    try {
      await workOrderAPI.remove(workOrderId, false);
      toast.success('Work order hidden (soft delete)');
      setShowDelete(false);
      onClose();
      onChanged?.(null);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to delete');
    }
  };

  const flags = [];
  if (wo.nap_match_status === 'not_found') flags.push('NAP ID not found in NAP database');
  if (wo.coord_conflict) flags.push(`Coordinate conflict (${Math.round(Number(wo.coord_diff_meters) || 0)}m vs NAP DB)`);
  if (!wo.latitude || !wo.longitude) flags.push('No valid coordinates — unmapped');
  if (!wo.source_channel) flags.push('Missing source channel');
  if (wo.nap_match_status === 'matched_no_coords') flags.push('Matched NAP has no coordinates');

  // lat/long come back as strings (numeric columns); coerce safely.
  const hasCoords =
    wo.latitude != null && wo.longitude != null &&
    String(wo.latitude).trim() !== '' && String(wo.longitude).trim() !== '' &&
    Number.isFinite(Number(wo.latitude)) && Number.isFinite(Number(wo.longitude));

  return (
    <ErrorBoundary key={workOrderId} onClose={onClose}>
      <div className="drawer-backdrop" onClick={onClose}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="drawer-header">
          <div>
            <div className="flex wrap" style={{ marginBottom: 6 }}>
              {wo.work_order_number ? <h3 style={{ marginRight: 8 }}>{wo.work_order_number}</h3> : <h3>#{wo.id}</h3>}
              <StatusBadge status={wo.status} />
              <ChannelBadge channel={wo.source_channel} />
            </div>
            <div className="small muted">{wo.customer_name || 'No customer'} · {wo.nap_id || 'No NAP ID'}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="drawer-body">
          {flags.length > 0 && (
            <div className="alert alert-warn" style={{ marginTop: 0 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                {flags.map((f, i) => (<div key={i}>{f}</div>))}
              </div>
            </div>
          )}

          <section className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="card-title"><ArrowLeftRight size={15} /> Status</div>
            <div className="form-row">
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {statuses.map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
              </select>
              <button className="btn btn-primary" onClick={saveStatus} disabled={saving}>Save</button>
            </div>
            {status === 'DELAYED' && (
              <div className="form-group mt-sm">
                <label>Delay reason *</label>
                <input className="input" value={delayReason} onChange={(e) => setDelayReason(e.target.value)} placeholder="Why is this delayed?" />
              </div>
            )}
            {status === 'COMPLETED' && (
              <div className="form-group mt-sm">
                <label>Completion notes</label>
                <textarea className="textarea" rows={2} value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} placeholder="What was done?" />
              </div>
            )}
            <div className="form-group mt-sm">
              <label>Optional note for history</label>
              <input className="input" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="e.g. returned at 3PM" />
            </div>
          </section>

          <section className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="card-title"><ArrowLeftRight size={15} /> Source Channel</div>
            <div className="form-row">
              <select className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="">Select channel...</option>
                {channels.map((c) => <option key={c.code} value={c.code}>{c.label || c.code}</option>)}
              </select>
              <button className="btn btn-primary" onClick={saveChannel} disabled={saving || !channel}>Save</button>
            </div>
          </section>

          <section className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="card-title"><Wrench size={15} /> Assignment</div>
            <div className="form-group">
              <label>Technician</label>
              <select
                className="select"
                value={technician}
                onChange={(e) => setTechnician(e.target.value)}
                disabled={!roster}
              >
                <option value="">Unassigned</option>
                {(roster || []).map((t) => (
                  <option key={t.id} value={t.name}>{t.name}{t.team ? ` (${t.team})` : ''}</option>
                ))}
                {technician && !(roster || []).some((t) => t.name === technician) && (
                  <option value={technician}>{technician}</option>
                )}
              </select>
            </div>
            <div className="form-group">
              <label>Team</label>
              <input className="input" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team name" />
            </div>
            <button className="btn" onClick={saveAssignment} disabled={saving}>Save assignment</button>
          </section>

          <section className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="card-title"><User size={15} /> Customer & Location</div>
            <div className="form-group"><label>Customer</label><input className="input" value={edits.customer_name} onChange={(e) => setEdits({ ...edits, customer_name: e.target.value })} /></div>
            <div className="form-group"><label>Address</label><input className="input" value={edits.customer_address} onChange={(e) => setEdits({ ...edits, customer_address: e.target.value })} /></div>
            <div className="form-group"><label>Contact</label><input className="input" value={edits.customer_contact} onChange={(e) => setEdits({ ...edits, customer_contact: e.target.value })} /></div>
            <div className="form-group"><label>NAP ID</label><input className="input" value={edits.nap_id} onChange={(e) => setEdits({ ...edits, nap_id: e.target.value })} /></div>
            <div className="form-row">
              <div className="form-group"><label>Area</label><input className="input" value={edits.area} onChange={(e) => setEdits({ ...edits, area: e.target.value })} /></div>
              <div className="form-group"><label>Territory</label><input className="input" value={edits.territory} onChange={(e) => setEdits({ ...edits, territory: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Barangay</label><input className="input" value={edits.barangay} onChange={(e) => setEdits({ ...edits, barangay: e.target.value })} /></div>
              <div className="form-group"><label>Facility</label><input className="input" value={edits.facility} onChange={(e) => setEdits({ ...edits, facility: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Contractor</label><input className="input" value={edits.contractor} onChange={(e) => setEdits({ ...edits, contractor: e.target.value })} /></div>
              <div className="form-group"><label>Appointment</label><input type="date" className="input" value={edits.appointment} onChange={(e) => setEdits({ ...edits, appointment: e.target.value })} /></div>
            </div>
            <div className="form-group"><label>Dispatch notes</label><textarea className="textarea" rows={2} value={edits.dispatch_notes} onChange={(e) => setEdits({ ...edits, dispatch_notes: e.target.value })} /></div>
            <button className="btn" onClick={saveEdits} disabled={saving}>Save details</button>
          </section>

          <section className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="card-title"><MapPin size={15} /> Location</div>
            <div className="kv"><span className="k">Coordinates</span><span className="v mono">{hasCoords ? `${Number(wo.latitude).toFixed(6)}, ${Number(wo.longitude).toFixed(6)}` : 'Unmapped'}</span></div>
            <div className="kv"><span className="k">Coordinate source</span><span className="v">{wo.coordinate_source || '—'}</span></div>
            {data.nap && (
              <>
                <div className="kv"><span className="k">NAP verified location</span><span className="v mono">{data.nap.dp_nap_lat}, {data.nap.dp_nap_long}</span></div>
                <div className="kv"><span className="k">NAP building</span><span className="v">{data.nap.building_served || '—'}</span></div>
                <div className="kv"><span className="k">NAP barangay</span><span className="v">{data.nap.barangay_name || data.nap.city_name || '—'}</span></div>
              </>
            )}
          </section>

          <section className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div className="card-title"><History size={15} /> Notes & History</div>
            <div className="form-row mb">
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note..." onKeyDown={(e) => e.key === 'Enter' && addNote()} />
              <button className="btn" onClick={addNote} disabled={saving}>Add</button>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {(data.history || []).map((h) => (
                <div key={h.id} className="kv" style={{ alignItems: 'flex-start' }}>
                  <span className="k" style={{ minWidth: 90 }}>{fmtDate(h.created_at)}</span>
                  <span className="v" style={{ textAlign: 'left' }}>
                    <span className="tag" style={{ marginRight: 6 }}>{(h.action || '').replace('_', ' ')}</span>
                    {h.old_value != null && h.new_value != null && (
                      <span className="mono">{h.old_value} → {h.new_value}</span>
                    )}
                    {h.note && <div className="muted" style={{ marginTop: 3 }}>{h.note}</div>}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="card" style={{ padding: 14 }}>
            <div className="card-title"><Download size={15} /> Imported data</div>
            <div className="kv"><span className="k">Original status</span><span className="v">{wo.original_status || '—'}</span></div>
            <div className="kv"><span className="k">Source file</span><span className="v">{wo.source_file || '—'}</span></div>
            <div className="kv"><span className="k">Created</span><span className="v">{fmtDate(wo.created_at)}</span></div>
            <div className="kv"><span className="k">Updated</span><span className="v">{fmtDate(wo.updated_at)}</span></div>
          </section>

          {(wo.fsm_disposition != null || wo.disposition != null || wo.disposition_review_status) && (
            <section className="card" style={{ padding: 14, marginTop: 14 }}>
              <div className="flex-between" style={{ marginBottom: 6 }}>
                <div className="card-title flex" style={{ gap: 6, alignItems: 'center' }}>
                  <AlertTriangle size={15} /> Disposition
                  <Link className="small" to="/disposition" style={{ fontSize: 11 }}>Open center</Link>
                </div>
                {wo.disposition_review_status && (
                  <span className="action-chip" style={{
                    color: wo.disposition_review_status === 'review_required' ? '#B45309' : '#166534',
                    background: wo.disposition_review_status === 'review_required' ? C.warningSoft : C.successSoft,
                  }}>
                    {(wo.disposition_review_status || '').replace('_', ' ')}
                  </span>
                )}
              </div>
              <div className="kv"><span className="k">Raw FSM disposition</span><span className="v">{wo.fsm_disposition || '—'}</span></div>
              <div className="kv"><span className="k">Normalized disposition</span><span className="v">{wo.disposition || '—'}</span></div>
              <div className="kv"><span className="k">Category</span><span className="v">{wo.disposition_category || '—'}</span></div>
              <div className="kv">
                <span className="k">Confidence</span>
                <span className="v">
                  {wo.disposition_confidence
                    ? <span className={`tag ${wo.disposition_confidence === 'approved' ? 'ok' : ''}`}>{wo.disposition_confidence}</span>
                    : '—'}
                </span>
              </div>
              {wo.disposition_review_note && (
                <div className="kv"><span className="k">Review note</span><span className="v">{wo.disposition_review_note}</span></div>
              )}
            </section>
          )}

          {user?.is_admin && (
            <div className="mt">
              <button className="btn btn-danger btn-sm" onClick={() => setShowDelete(true)}><Trash2 size={14} /> Delete work order</button>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={showDelete}
          title="Delete this work order?"
          message="This work order will be soft-deleted (hidden). It can be restored from a backup. This is not a permanent deletion."
          confirmLabel="Hide it"
          onConfirm={deleteWo}
          onCancel={() => setShowDelete(false)}
        />
      </div>
    </div>
    </ErrorBoundary>
  );
}