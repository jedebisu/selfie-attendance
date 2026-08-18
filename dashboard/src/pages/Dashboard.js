import React, { useState, useEffect } from 'react';
import { attendanceAPI, analyticsAPI, SERVER_URL } from '../services/api';
import { format } from 'date-fns';
import { Users, Clock, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

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

  if (loading) {
    return <div className="loading">Loading dashboard...</div>;
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">{format(new Date(), 'EEEE, MMMM dd, yyyy')}</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Users size={22} /></div>
          <div>
            <span className="stat-value">{stats.totalEmployees}</span>
            <span className="stat-label">Total Employees</span>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle size={22} /></div>
          <div>
            <span className="stat-value">{stats.clockedIn}</span>
            <span className="stat-label">Clocked In</span>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon orange"><Clock size={22} /></div>
          <div>
            <span className="stat-value">{stats.pending}</span>
            <span className="stat-label">Pending</span>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon purple"><AlertCircle size={22} /></div>
          <div>
            <span className="stat-value">{stats.totalToday}</span>
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
                    contentStyle={{ background: '#1a1d23', border: 'none', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#ccc' }}
                    formatter={(value) => [`${value}%`, 'Attendance']}
                  />
                  <Area type="monotone" dataKey="attendance_rate" stroke="#c8956c" fill="#c8956c" fillOpacity={0.2} />
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
                  <tr key={emp.id}>
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
              <p className="no-data">No attendance records today</p>
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
                  <img 
                    src={`${SERVER_URL}${record.photo_url}`} 
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
