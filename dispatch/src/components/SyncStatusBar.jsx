import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { syncAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Compact, always-mounted connection strip for the Globe FSM sync. Polls the
// sync state, detects completed runs, and fans out a workorders-synced event
// so open pages refresh their data in place (no full reload). Admins get a
// manual "Sync now" retry button.
export default function SyncStatusBar() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const lastKey = useRef('');

  const load = useCallback(async () => {
    try {
      const s = await syncAPI.status();
      const key = `${s.last_run_at || ''}|${s.last_status || ''}`;
      if (lastKey.current !== key) {
        lastKey.current = key;
        if (s.last_status === 'ok') {
          window.dispatchEvent(new CustomEvent('workorders-synced'));
        }
      }
      setStatus(s);
    } catch (_) {
      // API unreachable; leave the strip silently inert.
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const runNow = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncAPI.run();
      if (r.status === 'disabled') {
        toast.error(`FSM sync is not configured. ${r.reason || ''}`);
      } else if (r.status === 'error') {
        toast.error(`Sync failed: ${r.last_error || 'unknown error'}`);
      } else {
        const s = (r.summary && r.summary.added) || 0;
        const u = (r.summary && r.summary.updated) || 0;
        toast.success(
          r.status === 'ok'
            ? `FSM sync complete · ${s} added, ${u} updated`
            : `FSM sync partial — check sync log`
        );
        if (r.status === 'ok') window.dispatchEvent(new CustomEvent('workorders-synced'));
      }
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run sync');
    } finally {
      setSyncing(false);
    }
  };

  if (!status) return null;

  const ok = status.configured && status.last_status === 'ok';
  const running = status.running;
  const configured = status.configured;
  const moderate = configured && !(status.last_status === 'ok') && status.last_status !== 'error';
  const tone = running ? 'running' : ok ? 'ok' : status.last_status === 'error' ? 'error' : configured ? 'idle' : 'off';

  return (
    <div className={`sync-strip sync-${tone}`} title={status.last_error || status.reason}>
      <span className="sync-strip-dot" />
      <span className="sync-strip-label">FSM Sync</span>
      <span className="sync-strip-state">
        {running ? 'Syncing…' : ok ? `Last synced ${fmtTime(status.last_success_at)}` : configured ? 'Waiting for push' : 'Not configured'}
      </span>
      {status.last_error && !running && <span className="sync-strip-err" title={status.last_error}>{status.last_error}</span>}
      {isAdmin && (
        <button onClick={runNow} disabled={!configured || running || syncing} className="sync-strip-btn">
          <RefreshCw size={12} className={running || syncing ? 'spin' : ''} />
          {running || syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </div>
  );
}