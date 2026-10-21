import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, X, Check, ShieldCheck } from 'lucide-react';
import { dispatchAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';

function RowEditor({ base, onSave, onCancel, extraFields = [] }) {
  const [form, setForm] = useState({ ...base });
  const [busy, setBusy] = useState(false);
  return (
    <tr className="row-edit">
      <td><input className="input" value={form.code || ''} disabled={!!base.code} placeholder="Code" onChange={(e) => setForm({ ...form, code: e.target.value })} style={{ width: 110 }} /></td>
      <td><input className="input" value={form.label || ''} placeholder="Label" onChange={(e) => setForm({ ...form, label: e.target.value })} style={{ flex: 1 }} /></td>
      <td><input type="color" value={form.color || '#6b7280'} onChange={(e) => setForm({ ...form, color: e.target.value })} /></td>
      {extraFields.map(([k, ph]) => (
        <td key={k}><input className="input" value={form[k] || ''} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} style={{ minWidth: 110 }} /></td>
      ))}
      <td className="flex" style={{ gap: 4 }}>
        <button className="icon-btn ok" disabled={busy || !form.label} onClick={async () => { setBusy(true); await onSave(form); setBusy(false); }}><Check size={15} /></button>
        <button className="icon-btn" onClick={onCancel}><X size={15} /></button>
      </td>
    </tr>
  );
}

function TechnicianEditor({ base, onSave, onCancel }) {
  const [form, setForm] = useState({
    name: (base && base.name) || '',
    team: (base && base.team) || '',
    phone: (base && base.phone) || '',
  });
  const [busy, setBusy] = useState(false);
  const canSave = !!form.name.trim();
  const submit = async () => {
    if (busy || !canSave) return;
    setBusy(true);
    try {
      await onSave({ name: form.name.trim(), team: form.team.trim(), phone: form.phone.trim() });
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e) => { if (e.key === 'Enter') submit(); };
  return (
    <tr className="row-edit">
      <td><input className="input" autoFocus value={form.name} placeholder="Name" onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={onKey} /></td>
      <td><input className="input" value={form.team} placeholder="Team" onChange={(e) => setForm({ ...form, team: e.target.value })} onKeyDown={onKey} /></td>
      <td><input className="input" value={form.phone} placeholder="Phone" onChange={(e) => setForm({ ...form, phone: e.target.value })} onKeyDown={onKey} /></td>
      <td className="flex" style={{ gap: 4 }}>
        <button className="icon-btn ok" title="Save technician" disabled={busy || !canSave} onClick={submit}><Check size={15} /></button>
        <button className="icon-btn" title="Cancel" disabled={busy} onClick={onCancel}><X size={15} /></button>
      </td>
    </tr>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState([]);
  const [channels, setChannels] = useState([]);
  const [techs, setTechs] = useState([]);
  const [editStatus, setEditStatus] = useState(null);
  const [editChannel, setEditChannel] = useState(null);
  const [editTech, setEditTech] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const reload = useCallback(() => {
    dispatchAPI.statuses().then((r) => setStatuses(r.statuses || [])).catch(() => {});
    dispatchAPI.channels().then((r) => setChannels(r.channels || [])).catch(() => {});
    dispatchAPI.technicians().then((r) => setTechs(r.technicians || [])).catch(() => {});
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const isAdmin = !!user?.is_admin;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">Statuses, channels, and technicians used across the app</p>
        </div>
      </div>

      {!isAdmin && (
        <div className="alert alert-warn" style={{ marginTop: 0 }}>
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          You have read access. Only admins can edit statuses and channels. Anyone can maintain the technician roster.
        </div>
      )}

      <div className="card mb">
        <div className="flex-between">
          <div className="card-title">Statuses</div>
          <button className="btn btn-sm" onClick={() => setEditStatus({ code: '', label: '', color: '#6b7280' })}><Plus size={14} /> Add status</button>
        </div>
        <table className="table">
          <thead><tr><th style={{ width: 140 }}>Code</th><th>Label</th><th style={{ width: 60 }}>Color</th><th style={{ width: 70 }}>Order</th><th style={{ width: 90 }}>Actions</th></tr></thead>
          <tbody>
            {statuses.map((s) => (
              editStatus?.code === s.code ? (
                <RowEditor
                  key={s.code}
                  base={s}
                  onSave={async (form) => {
                    try { await dispatchAPI.updateStatus(s.code, form); toast.success('Status updated'); setEditStatus(null); reload(); }
                    catch (e) { toast.error(e.response?.data?.error || 'Update failed'); }
                  }}
                  onCancel={() => setEditStatus(null)}
                  extraFields={[['sort_order', 'Order']]}
                />
              ) : (
                <tr key={s.code} className={s.is_active === false ? 'row-inactive' : ''}>
                  <td><span className="tag" style={{ background: s.color, color: '#fff' }}>{s.code}</span></td>
                  <td>{s.label}</td>
                  <td><span className="swatch" style={{ background: s.color }} /></td>
                  <td>{s.sort_order}</td>
                  <td className="flex" style={{ gap: 4 }}>
                    {isAdmin && <button className="icon-btn" onClick={() => setEditStatus(s)}><Pencil size={14} /></button>}
                    <button className="icon-btn" onClick={() => setEditStatus({ ...s, code: '', label: s.label, color: s.color })}><Plus size={14} /></button>
                  </td>
                </tr>
              )
            ))}
            {editStatus && !statuses.some((s) => s.code === editStatus.code) && (
              <RowEditor
                base={editStatus}
                onSave={async (form) => {
                  try { await dispatchAPI.createStatus(form); toast.success('Status created'); setEditStatus(null); reload(); }
                  catch (e) { toast.error(e.response?.data?.error || 'Create failed'); }
                }}
                onCancel={() => setEditStatus(null)}
                extraFields={[['sort_order', 'Order']]}
              />
            )}
          </tbody>
        </table>
      </div>

      <div className="card mb">
        <div className="flex-between">
          <div className="card-title">Source channels</div>
          <button className="btn btn-sm" onClick={() => setEditChannel({ code: '', label: '', color: '#3b82f6' })}><Plus size={14} /> Add channel</button>
        </div>
        <table className="table">
          <thead><tr><th style={{ width: 140 }}>Code</th><th>Label</th><th style={{ width: 60 }}>Color</th><th style={{ width: 70 }}>Order</th><th style={{ width: 90 }}>Actions</th></tr></thead>
          <tbody>
            {channels.map((c) => (
              editChannel?.code === c.code ? (
                <RowEditor
                  key={c.code}
                  base={c}
                  onSave={async (form) => {
                    try { await dispatchAPI.updateChannel(c.code, form); toast.success('Channel updated'); setEditChannel(null); reload(); }
                    catch (e) { toast.error(e.response?.data?.error || 'Update failed'); }
                  }}
                  onCancel={() => setEditChannel(null)}
                  extraFields={[['sort_order', 'Order']]}
                />
              ) : (
                <tr key={c.code} className={c.is_active === false ? 'row-inactive' : ''}>
                  <td><span className="tag" style={{ background: c.color, color: '#fff' }}>{c.code}</span></td>
                  <td>{c.label}</td>
                  <td><span className="swatch" style={{ background: c.color }} /></td>
                  <td>{c.sort_order}</td>
                  <td className="flex" style={{ gap: 4 }}>
                    {isAdmin && <button className="icon-btn" onClick={() => setEditChannel(c)}><Pencil size={14} /></button>}
                  </td>
                </tr>
              )
            ))}
            {editChannel && !channels.some((c) => c.code === editChannel.code) && (
              <RowEditor
                base={editChannel}
                onSave={async (form) => {
                  try { await dispatchAPI.createChannel(form); toast.success('Channel created'); setEditChannel(null); reload(); }
                  catch (e) { toast.error(e.response?.data?.error || 'Create failed'); }
                }}
                onCancel={() => setEditChannel(null)}
                extraFields={[['sort_order', 'Order']]}
              />
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="flex-between">
          <div className="card-title">Technician roster</div>
          <button className="btn btn-sm" onClick={() => setEditTech({ id: null, name: '', team: '', phone: '' })}><Plus size={14} /> Add technician</button>
        </div>
        <table className="table">
          <thead><tr><th>Name</th><th>Team</th><th>Phone</th><th style={{ width: 90 }}>Actions</th></tr></thead>
          <tbody>
            {techs.map((t) => (
              editTech?.id === t.id ? (
                <TechnicianEditor
                  key={t.id}
                  base={t}
                  onSave={async (form) => {
                    try { await dispatchAPI.updateTechnician(t.id, form); toast.success('Technician updated'); setEditTech(null); reload(); }
                    catch (e) { toast.error(e.response?.data?.error || e.message || 'Update failed'); }
                  }}
                  onCancel={() => setEditTech(null)}
                />
              ) : (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.team || <span className="muted">—</span>}</td>
                  <td>{t.phone || <span className="muted">—</span>}</td>
                  <td className="flex" style={{ gap: 4 }}>
                    <button className="icon-btn" onClick={() => setEditTech(t)}><Pencil size={14} /></button>
                    <button className="icon-btn danger" onClick={() => setConfirmDelete(t)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              )
            ))}
            {editTech && !techs.some((t) => t.id === editTech.id) && (
              <TechnicianEditor
                base={editTech}
                onSave={async (form) => {
                  if (techs.some((t) => (t.name || '').trim().toLowerCase() === form.name.toLowerCase())) {
                    toast.error(`"${form.name}" is already in the roster`);
                    return;
                  }
                  try { await dispatchAPI.createTechnician(form); toast.success('Technician added'); setEditTech(null); reload(); }
                  catch (e) { toast.error(e.response?.data?.error || e.message || 'Create failed'); }
                }}
                onCancel={() => setEditTech(null)}
              />
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Remove this technician?"
        message={`"${confirmDelete?.name}" will be deactivated. Existing work orders keep their assignments.`}
        confirmLabel="Deactivate"
        onConfirm={async () => {
          try { await dispatchAPI.removeTechnician(confirmDelete.id); toast.success('Technician removed'); setConfirmDelete(null); reload(); }
          catch (e) { toast.error(e.response?.data?.error || 'Remove failed'); }
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}