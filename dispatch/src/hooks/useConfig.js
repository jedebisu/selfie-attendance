import { useEffect, useState } from 'react';
import { workOrderAPI, dispatchAPI } from '../services/api';

let cache = null;
let inFlight = null;

// Loads statuses + channels once and shares them across pages.
export function useConfig(force = false) {
  const [config, setConfig] = useState(cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cache && !force) {
      setConfig(cache);
      return;
    }
    if (inFlight) {
      inFlight.then(setConfig).catch(() => setError('failed'));
      return;
    }
    inFlight = (async () => {
      const [wo, disp] = await Promise.all([workOrderAPI.filterOptions(), dispatchAPI.statuses()]);
      const activeChannels = (disp.channels || []).filter((c) => c.is_active !== false);
      const channels = activeChannels.length
        ? activeChannels.map((c) => ({ code: c.code, label: c.label }))
        : wo.channels;
      const statuses = disp.statuses.length ? disp.statuses.map((s) => ({ code: s.code, label: s.label })) : wo.statuses;
      cache = {
        ...wo,
        statuses,
        channels,
        technicians: null,
      };
      return cache;
    })();
    inFlight
      .then(setConfig)
      .catch((e) => setError(e?.response?.data?.error || e?.message || 'failed'));
    return () => { inFlight = null; };
  }, [force]);

  return { config, error, reload: () => (cache = null) };
}

export function useTechnicians() {
  const [list, setList] = useState(null);
  useEffect(() => {
    dispatchAPI
      .technicians()
      .then((res) => setList(res.technicians))
      .catch(() => setList([]));
  }, []);
  return list;
}