import React, { useEffect, useState } from 'react';
import { X, TriangleAlert, Loader2 } from 'lucide-react';
import { workOrderAPI } from '../services/api';

const REQUIRED_TEXT = 'CLEAR ALL WORK ORDERS';

export default function ClearAllDialog({ open, onClose, onDone }) {
  const [status, setStatus] = useState({ loading: true, enabled: true, total: 0, env: 'development', reason: null, error: null });
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTyped('');
    setRunning(false);
    setRunError(null);
    setBlocked(false);
    setStatus({ loading: true, enabled: true, total: 0, env: 'development', reason: null, error: null });
    let cancelled = false;
    workOrderAPI
      .clearAllPreview()
      .then((res) => {
        if (cancelled) return;
        setStatus({ loading: false, enabled: true, total: 0, env: 'development', reason: null, error: null, ...res });
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus({ loading: false, enabled: false, total: 0, env: 'unknown', reason: err.response?.data?.error || err.message, error: err.response?.data?.error || err.message });
      });
    return () => { cancelled = true; };
  }, [open]);

  if (!open) return null;

  const textMatches = typed.trim().toUpperCase() === REQUIRED_TEXT;

  const handleFailure = async (err, expected) => {
    const serverMsg = err.response?.data?.error;
    if (serverMsg) {
      setRunError(serverMsg);
      return;
    }
    try {
      const check = await workOrderAPI.clearAllPreview();
      if (typeof check?.total === 'number' && check.total < expected) {
        onDone({ success: true, deleted: expected - check.total, verified: true });
        return;
      }
      setRunError(
        `The request did not return a response (${err.code || 'network error'}). ` +
        `Verified ${check?.total ?? '?'} work orders still present — nothing was cleared. You can safely retry.`
      );
    } catch (_) {
      setBlocked(true);
      setRunError(
        'The request did not return a response and the current work order count could not be verified. ' +
        'Close this dialog and reopen it to re-check before retrying.'
      );
    }
  };

  const confirm = async () => {
    if (!textMatches || running || !status.enabled || status.loading || blocked) return;
    const expected = status.total;
    setRunning(true);
    setRunError(null);
    try {
      const res = await workOrderAPI.clearAll(REQUIRED_TEXT, expected);
      if (!res || res.success !== true) {
        setRunError('The server did not confirm the operation. No records were removed.');
        return;
      }
      onDone(res);
    } catch (err) {
      await handleFailure(err, expected);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape' && !running) onClose(); }}>
        <div className="modal-head">
          <h3>Clear All Work Orders</h3>
          <button className="icon-btn" onClick={onClose} disabled={running}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {status.loading ? (
            <p className="muted small flex" style={{ gap: 8, alignItems: 'center' }}><Loader2 size={16} className="spin" /> Loading work order count…</p>
          ) : status.error ? (
            <div className="alert alert-error" style={{ marginTop: 0 }}>
              <TriangleAlert size={16} style={{ flexShrink: 0 }} />
              <div>
                <strong>Cannot preview work orders</strong>
                <div className="small">{status.error}</div>
              </div>
            </div>
          ) : status.enabled ? (
            <>
              <div className="alert alert-error" style={{ marginTop: 0 }}>
                <TriangleAlert size={16} style={{ flexShrink: 0 }} />
                <div>
                  <strong>This will permanently remove all {status.total.toLocaleString()} work orders</strong>
                  <div className="small">
                    Closed, trashed, and open records are all deleted, along with their history and disposition reviews.
                    Technicians, user accounts, NAP data, dispatch settings, import batches, and sync records are NOT touched.
                    This cannot be undone — re-import the source CSV to restore records.
                  </div>
                </div>
              </div>
              <p className="small muted">
                Type <code style={{ fontWeight: 700, color: 'var(--danger)' }}>{REQUIRED_TEXT}</code> to confirm.
              </p>
              <input
                className="input"
                autoFocus
                placeholder={REQUIRED_TEXT}
                value={typed}
                disabled={running}
                onChange={(e) => setTyped(e.target.value)}
              />
              {runError && (
                <p className="small" style={{ color: '#C2323A', marginTop: 8 }}>{runError}</p>
              )}
            </>
          ) : (
            <div className="alert alert-error" style={{ marginTop: 0 }}>
              <TriangleAlert size={16} style={{ flexShrink: 0 }} />
              <div>
                <strong>Clear All Work Orders is disabled here</strong>
                <div className="small">{status.reason}</div>
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={running}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={confirm}
            disabled={!status.enabled || !textMatches || running || status.loading || blocked}
          >
            {running ? <><Loader2 size={15} className="spin" /> Clearing…</> : 'Confirm Clear'}
          </button>
        </div>
      </div>
    </div>
  );
}