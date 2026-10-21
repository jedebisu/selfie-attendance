import axios from 'axios';

// In dev the Vite proxy forwards /api to the Express server (localhost:3001).
// In production set VITE_API_URL to the deployed API base (e.g. https://.../api).
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dispatch_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('dispatch_token');
      localStorage.removeItem('dispatch_user');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

const unwrap = (p) => p.then((r) => r.data);

export const authAPI = {
  login: (employee_id, pin) => unwrap(api.post('/auth/login', { employee_id, pin })),
  verify: () => unwrap(api.get('/auth/verify')),
};

export const workOrderAPI = {
  list: (params) => unwrap(api.get('/workorders', { params })),
  get: (id) => unwrap(api.get(`/workorders/${id}`)),
  update: (id, data) => unwrap(api.patch(`/workorders/${id}`, data)),
  setStatus: (id, data) => unwrap(api.patch(`/workorders/${id}/status`, data)),
  setChannel: (id, channel) => unwrap(api.patch(`/workorders/${id}/channel`, { channel })),
  setAssignment: (id, data) => unwrap(api.patch(`/workorders/${id}/assignment`, data)),
  setCoordinates: (id, latitude, longitude) =>
    unwrap(api.patch(`/workorders/${id}/coordinates`, { latitude, longitude })),
  addNote: (id, note, type) => unwrap(api.post(`/workorders/${id}/notes`, { note, type })),
  history: (id) => unwrap(api.get(`/workorders/${id}/history`)),
  remove: (id, permanent) =>
    unwrap(api.delete(`/workorders/${id}`, { params: permanent ? { permanent: true } : {} })),
  bulk: (payload) => unwrap(api.post('/workorders/bulk', payload)),

  stats: (params) => unwrap(api.get('/workorders/stats', { params })),
  trends: (params) => unwrap(api.get('/workorders/trends', { params })),
  napGroups: (params) => unwrap(api.get('/workorders/nap-groups', { params })),
  napGroup: (napId) => unwrap(api.get(`/workorders/nap-groups/${encodeURIComponent(napId)}`)),
  groupBy: (params) => unwrap(api.get('/workorders/group', { params })),
  unmapped: (params) => unwrap(api.get('/workorders/unmapped', { params })),
  reviewQueue: (params) => unwrap(api.get('/workorders/review-queue', { params })),
  filterOptions: () => unwrap(api.get('/workorders/filter-options')),
  clearAllPreview: () => unwrap(api.get('/workorders/clear-all')),
  clearAll: (confirmation, count) => unwrap(api.post('/workorders/clear-all', { confirmation, count })),
};

export const productivityAPI = {
  summary: (params) => unwrap(api.get('/productivity', { params })),
};

export const importAPI = {
  preview: (file, mapping, options) => {
    const form = new FormData();
    form.append('file', file);
    if (mapping) form.append('mapping', JSON.stringify(mapping));
    if (options) form.append('options', JSON.stringify(options));
    return unwrap(api.post('/workorders/import/preview', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }));
  },
  commit: (batchId, mapping, options) =>
    unwrap(api.post(`/workorders/import/${batchId}/commit`, { mapping, options })),
  batches: () => unwrap(api.get('/workorders/import/batches')),
};

export const dispatchAPI = {
  statuses: () => unwrap(api.get('/dispatch/statuses')),
  createStatus: (data) => unwrap(api.post('/dispatch/statuses', data)),
  updateStatus: (code, data) => unwrap(api.patch(`/dispatch/statuses/${code}`, data)),
  channels: () => unwrap(api.get('/dispatch/channels')),
  createChannel: (data) => unwrap(api.post('/dispatch/channels', data)),
  updateChannel: (code, data) => unwrap(api.patch(`/dispatch/channels/${code}`, data)),
  technicians: () => unwrap(api.get('/dispatch/technicians')),
  createTechnician: (data) => unwrap(api.post('/dispatch/technicians', data)),
  updateTechnician: (id, data) => unwrap(api.patch(`/dispatch/technicians/${id}`, data)),
  removeTechnician: (id) => unwrap(api.delete(`/dispatch/technicians/${id}`)),
};

export const dispositionAPI = {
  rules: () => unwrap(api.get('/disposition/rules')),
  createRule: (data) => unwrap(api.post('/disposition/rules', data)),
  updateRule: (id, data) => unwrap(api.patch(`/disposition/rules/${id}`, data)),
  reviewQueue: (params) => unwrap(api.get('/disposition/review-queue', { params })),
  reviewStats: () => unwrap(api.get('/disposition/review-queue/stats')),
  approveReview: (workOrderId, payload) =>
    unwrap(api.post(`/disposition/review/${workOrderId}/approve`, payload)),
  clearReview: (workOrderId, note) => unwrap(api.post(`/disposition/review/${workOrderId}/clear`, { note })),
  bulkReview: (payload) => unwrap(api.post('/disposition/review/bulk', payload)),
  correct: (payload) => unwrap(api.post('/disposition/correct', payload)),
  rollback: (reviewId) => unwrap(api.post('/disposition/corrections/rollback', { review_id: reviewId })),
  audit: () => unwrap(api.get('/disposition/audit')),
  metrics: () => unwrap(api.get('/disposition/metrics')),
};

export const syncAPI = {
  status: () => unwrap(api.get('/sync')),
  run: () => unwrap(api.post('/sync/run')),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap(api.post('/sync/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }));
  },
  logs: (limit) => unwrap(api.get('/sync/logs', { params: { limit } })),
  rewind: () => unwrap(api.post('/sync/rewind')),
};

export function exportUrl(params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const base = BASE_URL.startsWith('http') ? BASE_URL : `${window.location.origin}${BASE_URL}`;
  return `${base}/workorders/export${qs ? `?${qs}` : ''}`;
}

export default api;
