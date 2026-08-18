import axios from 'axios';
import { checkConnection } from './network';

const API_BASE_URL = 'https://selfie-api-sqgh.onrender.com/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  async (config) => {
    const isConnected = await checkConnection();
    if (!isConnected) {
      return Promise.reject({ message: 'No internet connection' });
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export const attendanceAPI = {
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
    const response = await api.get('/attendance/summary/today');
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
};

export { SERVER_URL: API_BASE_URL.replace('/api', '') };
export default api;
