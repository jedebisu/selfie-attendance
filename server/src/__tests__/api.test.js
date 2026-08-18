const request = require('supertest');
const app = require('../server');

// These tests require a running database
// Run with: npm test

describe('API Health', () => {
  it('GET /api/health should return ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Auth', () => {
  it('POST /api/auth/login should reject invalid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ employee_id: 'INVALID', pin: '0000' });
    expect(res.statusCode).toBe(401);
  });

  it('POST /api/auth/login should reject missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.statusCode).toBe(400);
  });
});

describe('Users', () => {
  it('GET /api/users should require auth', async () => {
    const res = await request(app).get('/api/users');
    expect(res.statusCode).toBe(401);
  });
});

describe('Attendance', () => {
  it('GET /api/attendance should require auth', async () => {
    const res = await request(app).get('/api/attendance');
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/attendance/summary/today should require auth', async () => {
    const res = await request(app).get('/api/attendance/summary/today');
    expect(res.statusCode).toBe(401);
  });
});
