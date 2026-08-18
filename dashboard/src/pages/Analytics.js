import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { analyticsAPI } from '../services/api';
import { BarChart3, TrendingUp, Clock, Calendar } from 'lucide-react';

const COLORS = {
  primary: '#c8956c',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  gray: '#6b7280',
  lightGray: '#e5e7eb'
};

const Analytics = () => {
  const [dateRange, setDateRange] = useState('30');
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState([]);
  const [hoursWorked, setHoursWorked] = useState([]);
  const [clockInDist, setClockInDist] = useState([]);
  const [dayOfWeek, setDayOfWeek] = useState([]);
  const [loading, setLoading] = useState(true);

  const getDateRange = () => {
    const end = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - parseInt(dateRange) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { start_date: start, end_date: end };
  };

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange]);

  const fetchAnalytics = async () => {
    setLoading(true);
    const params = getDateRange();
    try {
      const [overviewRes, trendRes, hoursRes, distRes, dowRes] = await Promise.all([
        analyticsAPI.getOverview(params),
        analyticsAPI.getAttendanceTrend(params),
        analyticsAPI.getHoursWorked(params),
        analyticsAPI.getClockInDistribution(params),
        analyticsAPI.getDayOfWeek({ ...params, start_date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] })
      ]);

      setOverview(overviewRes.data);
      setTrend(trendRes.data.trend.map(d => ({
        ...d,
        date: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      })));
      setHoursWorked(hoursRes.data.employees);
      setClockInDist(distRes.data.distribution);
      setDayOfWeek(dowRes.data.days.filter(d => d.dow >= 1 && d.dow <= 5));
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="chart-tooltip">
          <p className="tooltip-label">{label}</p>
          {payload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return <div className="loading">Loading analytics...</div>;
  }

  return (
    <div className="analytics-page">
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <p>Attendance insights and trends</p>
        </div>
        <div className="analytics-filters">
          <label>Date Range</label>
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      {overview && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon blue"><TrendingUp size={20} /></div>
            <div className="stat-info">
              <span className="stat-value">{overview.avgAttendanceRate}%</span>
              <span className="stat-label">Avg Attendance</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green"><Clock size={20} /></div>
            <div className="stat-info">
              <span className="stat-value">{overview.avgHoursWorked}h</span>
              <span className="stat-label">Avg Hours/Day</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon orange"><BarChart3 size={20} /></div>
            <div className="stat-info">
              <span className="stat-value">{overview.totalOvertimeHours}h</span>
              <span className="stat-label">Overtime Hours</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon red"><Calendar size={20} /></div>
            <div className="stat-info">
              <span className="stat-value">{overview.lateArrivals}</span>
              <span className="stat-label">Late Arrivals</span>
            </div>
          </div>
        </div>
      )}

      <div className="analytics-grid">
        <div className="chart-card full-width">
          <h3>Attendance Trend</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="attendance_rate" stroke={COLORS.primary} strokeWidth={2} dot={false} name="Attendance %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h3>Clock-in Distribution</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={clockInDist}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Count">
                  {clockInDist.map((entry, index) => (
                    <Cell key={index} fill={entry.count > 5 ? COLORS.primary : COLORS.lightGray} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h3>Attendance by Day</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dayOfWeek}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day_name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="attendance_rate" radius={[4, 4, 0, 0]} name="Attendance %">
                  {dayOfWeek.map((entry, index) => (
                    <Cell key={index} fill={entry.attendance_rate >= 80 ? COLORS.success : entry.attendance_rate >= 60 ? COLORS.warning : COLORS.danger} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card full-width">
          <h3>Hours Worked per Employee</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={Math.max(200, hoursWorked.length * 50)}>
              <BarChart data={hoursWorked} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={100} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total_hours" fill={COLORS.primary} radius={[0, 4, 4, 0]} name="Total Hours" />
                <Bar dataKey="overtime_hours" fill={COLORS.warning} radius={[0, 4, 4, 0]} name="Overtime" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Analytics;
