import axios from 'axios';

const BASE_URL = process.env.REACT_APP_API_URL || 'https://selfie-api-sqgh.onrender.com/api';
export const SERVER_URL = BASE_URL.replace(/\/api$/, '');

// Resolve a photo URL: Cloudinary returns absolute https URLs,
// legacy records use relative /uploads/ paths served by the API server
export const photoUrl = (url) => {
  if (!url) return '';
  return url.startsWith('http') ? url : `${SERVER_URL}${url}`;
};

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const attendanceAPI = {
  getAll: (params) => api.get('/attendance', { params }),
  getById: (id) => api.get(`/attendance/${id}`),
  getTodaySummary: () => api.get('/attendance/summary/today'),
  getMonthlySummary: (year, month) => api.get('/attendance/summary/monthly', { params: { year, month } })
};

export const userAPI = {
  getAll: () => api.get('/users'),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  resetPin: (id, newPin) => api.post(`/users/${id}/reset-pin`, { new_pin: newPin })
};

export const leaveAPI = {
  getAll: (params) => api.get('/leave', { params }),
  getMonth: (year, month) => api.get('/leave/month', { params: { year, month } }),
  getMyBalance: () => api.get('/leave/balance/me'),
  create: (data) => api.post('/leave', data),
  update: (id, status) => api.put(`/leave/${id}`, { status }),
  delete: (id) => api.delete(`/leave/${id}`)
};

export const exportAPI = {
  attendance: (params) => api.get('/export/attendance', { params, responseType: 'blob' }),
  leaves: (params) => api.get('/export/leaves', { params, responseType: 'blob' })
};

export const analyticsAPI = {
  getOverview: (params) => api.get('/analytics/overview', { params }),
  getAttendanceTrend: (params) => api.get('/analytics/attendance-trend', { params }),
  getHoursWorked: (params) => api.get('/analytics/hours-worked', { params }),
  getClockInDistribution: (params) => api.get('/analytics/clock-in-distribution', { params }),
  getDayOfWeek: (params) => api.get('/analytics/day-of-week', { params })
};

export const locationAPI = {
  getLive: () => api.get('/location/live'),
  getTrail: (userId, date) => api.get(`/location/trail/${userId}`, { params: { date } })
};
