import axios from 'axios';

const BASE_URL = 'https://selfie-api-sqgh.onrender.com/api';

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
