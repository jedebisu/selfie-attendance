import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkConnection } from './network';

const API_BASE_URL = 'https://selfie-api-sqgh.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  async (config) => {
    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export const attendanceAPI = {
  login: async (credentials) => {
    const response = await api.post('/auth/login', credentials);
    return response.data;
  },

  logout: async () => {
    const response = await api.post('/auth/logout');
    return response.data;
  },

  submit: async (formData) => {
    const response = await api.post('/attendance', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  getAll: async (params = {}) => {
    const response = await api.get('/attendance', { params });
    return response.data;
  },

  getTodaySummary: async () => {
    const response = await api.get('/attendance/summary/me');
    return response.data;
  },

  getMyCalendar: async (year, month) => {
    const response = await api.get('/attendance/calendar/me', { params: { year, month } });
    return response.data;
  },
};

export const locationAPI = {
  sendPings: async (pings) => {
    const response = await api.post('/location/pings', { pings });
    return response.data;
  },
};

export const leaveAPI = {
  getAll: async (params = {}) => {
    const response = await api.get('/leave', { params });
    return response.data;
  },

  update: async (id, status) => {
    const response = await api.put(`/leave/${id}`, { status });
    return response.data;
  },
};

export const napsAPI = {
  getAll: async (params = {}) => {
    const response = await api.get('/naps', { params });
    return response.data;
  },

  getNearest: async (params = {}) => {
    const response = await api.get('/naps/nearest', { params });
    return response.data;
  },

  getById: async (napId) => {
    const response = await api.get(`/naps/${napId}`);
    return response.data;
  },

  getStats: async () => {
    const response = await api.get('/naps/stats/summary');
    return response.data;
  },

  search: async (params = {}) => {
    const response = await api.get('/naps/search', { params });
    return response.data;
  },
};

export const SERVER_URL = API_BASE_URL.replace('/api', '');
export default api;
