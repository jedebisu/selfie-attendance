import React, { useState, useEffect } from 'react';
import { attendanceAPI, SERVER_URL } from '../services/api';
import { format } from 'date-fns';
import { Users, Clock, CheckCircle, AlertCircle } from 'lucide-react';

const Dashboard = () => {
  const [summary, setSummary] = useState([]);
  const [recentAttendance, setRecentAttendance] = useState([]);
  const [stats, setStats] = useState({
    totalEmployees: 0,
    clockedIn: 0,
    pending: 0,
    totalToday: 0
  });
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
