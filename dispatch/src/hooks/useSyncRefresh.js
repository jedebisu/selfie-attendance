import { useEffect } from 'react';

// Re-run a fetch callback whenever a sync run lands new data. Used by list
// pages so they refresh in place instead of forcing a full page reload.
export default function useSyncRefresh(fetchFn) {
  useEffect(() => {
    if (typeof fetchFn !== 'function') return undefined;
    const handler = () => fetchFn();
    window.addEventListener('workorders-synced', handler);
    return () => window.removeEventListener('workorders-synced', handler);
  }, [fetchFn]);
}