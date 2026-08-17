import axios from 'axios';
import { Platform } from 'react-native';

const BASE_URL = Platform.select({
  android: 'http://192.168.254.125:3001/api',
  ios: 'http://192.168.254.125:3001/api',
  default: 'http://192.168.254.125:3001/api'
});

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' }
});

export const attendanceAPI = {
  submit: (formData) => api.post('/attendance', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  getAll: (params) => api.get('/attendance', { params }),
  getTodaySummary: () => api.get('/attendance/summary/today')
};
