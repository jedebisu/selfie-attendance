import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { attendanceAPI, analyticsAPI } from '../services/api';
import AttendancePhoto from '../components/AttendancePhoto';
import AnimatedNumber from '../components/AnimatedNumber';
import ProgressRing from '../components/ProgressRing';
import { format } from 'date-fns';
import { Users, Clock, AlertCircle, TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { animate, stagger, createDrawable } from 'animejs';

/** Respect the OS "reduce motion" setting — show everything instantly instead. */
const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const clearInline = (els) =>
  els.forEach((el) => {
    el.style.transform = '';
    el.style.opacity = '';
  });

const Dashboard = () => {
  const [summary, setSummary] = useState([]);
  const [recentAttendance, setRecentAttendance] = useState([]);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    clockedIn: 0,
    pending: 0,
    totalToday: 0
  });
  const [weeklyTrend, setWeeklyTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const rootRef = useRef(null);
  const rowsEnteredRef = useRef(false);
  const prevStatusRef = useRef({});
  const prevClockRef = useRef(null);

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [summaryRes, attendanceRes] = await Promise.all([
        attendanceAPI.getTodaySummary(),
        attendanceAPI.getAll({ date: format(new Date(), 'yyyy-MM-dd'), limit: 10 })
      ]);

      const summaryData = summaryRes.data || [];
      const attendanceData = attendanceRes.data || {};

      setSummary(Array.isArray(summaryData) ? summaryData : []);
      setRecentAttendance(attendanceData.records || []);

      const clockedIn = (Array.isArray(summaryData) ? summaryData : []).filter(s => s.first_clock_in).length;
      const totalEmployees = Array.isArray(summaryData) ? summaryData.length : 0;
      setStats({
        totalEmployees,
        clockedIn,
        pending: totalEmployees - clockedIn,
        totalToday: attendanceData.pagination?.total || 0
      });

      try {
        const end = new Date().toISOString().split('T')[0];
        const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const trendRes = await analyticsAPI.getAttendanceTrend({ start_date: start, end_date: end });
        setWeeklyTrend((trendRes.data.trend || []).map(d => ({
          ...d,
          date: new Date(d.day).toLocaleDateString('en-US', { weekday: 'short' })
        })));
      } catch (e) {
        // Analytics endpoint might not be available yet
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--';
    return format(new Date(timestamp), 'hh:mm a');
  };

  /* ---------- Entrance animation (once, after data loads) ---------- */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (loading || !root || prefersReducedMotion()) return;
    const els = [
      ...root.querySelectorAll('.page-header'),
      ...root.querySelectorAll('.stat-card'),
      ...root.querySelectorAll('.dashboard-grid .card'),
    ];
    const anim = animate(els, {
      y: [18, 0],
      opacity: [0, 1],
      delay: stagger(70, { start: 80 }),
      duration: 650,
      ease: 'outExpo',
      onComplete: () => clearInline(els),
    });
    return () => anim.revert();
  }, [loading]);

  /* ---------- Employee rows unroll on first load ---------- */
  useLayoutEffect(() => {
    if (loading || !rootRef.current || !summary.length || rowsEnteredRef.current) return;
    rowsEnteredRef.current = true;
    if (prefersReducedMotion()) return;
    const rows = [...rootRef.current.querySelectorAll('tbody tr')];
    const anim = animate(rows, {
      y: [12, 0],
      opacity: [0, 1],
      delay: stagger(25),
      duration: 450,
      ease: 'outQuad',
      onComplete: () => clearInline(rows),
    });
    return () => anim.revert();
  }, [loading, summary.length]);

  /* ---------- Badge pulse when an employee's status changes ---------- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !summary.length) return;
    const changedIds = [];
    const statusMap = {};
    summary.forEach((emp) => {
      const active = !!emp.first_clock_in;
      statusMap[emp.employee_id] = active;
      const was = prevStatusRef.current[emp.employee_id];
      if (was !== undefined && was !== active) changedIds.push(emp.employee_id);
    });
    prevStatusRef.current = statusMap;
    if (!changedIds.length || prefersReducedMotion()) return;
    root.querySelectorAll('tr[data-emp-id]').forEach((row) => {
      if (!changedIds.includes(row.dataset.empId)) return;
      const badge = row.querySelector('.badge');
      if (badge) animate(badge, { scale: [0.8, 1.25, 1], duration: 500, ease: 'outBack', onComplete: () => clearInline([badge]) });
      animate(row, { backgroundColor: ['#d1fae5', 'transparent'], duration: 700, ease: 'outQuad', onComplete: () => clearInline([row]) });
    });
  }, [summary]);

  /* ---------- Pop the clocked-in ring when the count rises ---------- */
  useEffect(() => {
    const was = prevClockRef.current;
    prevClockRef.current = stats.clockedIn;
    if (was === null || !rootRef.current || stats.clockedIn <= was || prefersReducedMotion()) return;
    const ring = rootRef.current.querySelector('.stat-ring');
    if (ring) animate(ring, { scale: [1, 1.3, 1], duration: 600, ease: 'outElastic(1, 0.5)', onComplete: () => clearInline([ring]) });
  }, [stats.clockedIn]);

  /* ---------- Empty "Recent Activity" state: clock draws itself, then bobs ---------- */
  const activityEmpty = !loading && recentAttendance.length === 0;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!activityEmpty || !root) return;
    if (prefersReducedMotion()) return;
    const circle = root.querySelector('.empty-clock-track');
    const svg = root.querySelector('.empty-clock');
    if (!circle || !svg) return;
    const draw = animate(createDrawable(circle), { draw: '0 1', duration: 1100, ease: 'inOutSine' });
    const bob = animate(svg, { y: [0, -7, 0], duration: 2600, ease: 'inOutSine', delay: 1100, loop: true });
    return () => { draw.revert(); bob.revert(); };
  }, [activityEmpty]);

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  return (
    <div className="dashboard" ref={rootRef}>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">Welcome to EWMS · {format(new Date(), 'EEEE, MMMM dd, yyyy')}</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Users size={22} /></div>
          <div>
            <AnimatedNumber value={stats.totalEmployees} className="stat-value" />
            <span className="stat-label">Total Employees</span>
          </div>
        </div>

        <div className="stat-card">
          <ProgressRing value={stats.clockedIn} max={stats.totalEmployees} />
          <div>
            <AnimatedNumber value={stats.clockedIn} className="stat-value" />
            <span className="stat-label">Clocked In</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon orange"><Clock size={22} /></div>
          <div>
            <AnimatedNumber value={stats.pending} className="stat-value" />
            <span className="stat-label">Pending</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple"><AlertCircle size={22} /></div>
          <div>
            <AnimatedNumber value={stats.totalToday} className="stat-value" />
            <span className="stat-label">Total Entries</span>
          </div>
        </div>
      </div>

      {weeklyTrend.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <h2><TrendingUp size={18} style={{ marginRight: 8, verticalAlign: 'middle' }} />Weekly Attendance Trend</h2>
          </div>
          <div className="card-body">
            <div className="mini-chart-container">
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={weeklyTrend}>
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: 'var(--primary)', border: 'none', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#ccc' }}
                    formatter={(value) => [`${value}%`, 'Attendance']}
                  />
                  <Area type="monotone" dataKey="attendance_rate" stroke="#0072CE" fill="#0072CE" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header">
            <h2>Employee Status</h2>
          </div>
          <div className="card-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Clock In</th>
                  <th>Clock Out</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((emp) => (
                  <tr key={emp.id} data-emp-id={emp.employee_id}>
                    <td>
                      <div className="employee-cell">
                        <div className="avatar">{emp.name.charAt(0)}</div>
                        <span>{emp.name}</span>
                      </div>
                    </td>
                    <td>{emp.employee_id}</td>
                    <td>
                      <span className={`badge ${emp.first_clock_in ? 'badge-green' : 'badge-gray'}`}>
                        {emp.first_clock_in ? 'Active' : 'Absent'}
                      </span>
                    </td>
                    <td>{formatTime(emp.first_clock_in)}</td>
                    <td>{formatTime(emp.last_clock_out)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2>Recent Activity</h2>
          </div>
          <div className="card-body activity-feed">
            {recentAttendance.length === 0 ? (
              <div className="empty-state">
                <svg className="empty-clock" width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
                  <circle
                    className="empty-clock-track"
                    cx="36" cy="36" r="27"
                    fill="none" stroke="var(--primary)" strokeOpacity="0.55"
                    strokeWidth="4" strokeLinecap="round"
                  />
                  <line x1="36" y1="36" x2="36" y2="21" stroke="var(--text-secondary)" strokeWidth="4" strokeLinecap="round" />
                  <line x1="36" y1="36" x2="47" y2="41" stroke="var(--text-secondary)" strokeWidth="3.5" strokeLinecap="round" />
                  <circle cx="36" cy="36" r="2.5" fill="var(--text-secondary)" />
                </svg>
                <p className="empty-title">No one has clocked in yet today</p>
                <p className="empty-hint">Clock-ins usually start around shift time · this page refreshes every 30 seconds</p>
              </div>
            ) : (
              recentAttendance.map((record) => (
                <div key={record.id} className="activity-item">
                  <div className={`activity-status ${record.status}`}>
                    {record.status === 'clock_in' ? '↓' : '↑'}
                  </div>
                  <div className="activity-info">
                    <span className="activity-name">{record.user_name}</span>
                    <span className="activity-time">
                      {record.status === 'clock_in' ? 'Clocked in' : 'Clocked out'} at {formatTime(record.timestamp)}
                    </span>
                  </div>
                  <AttendancePhoto
                    url={record.photo_url}
                    alt=""
                    className="activity-photo"
                  />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
