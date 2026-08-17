import React, { useState, useEffect, useCallback } from 'react';
import { attendanceAPI } from '../services/api';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isToday, isWeekend } from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const Calendar = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await attendanceAPI.getMonthlySummary(year, month);
      setData(res.data.users || []);
    } catch (error) {
      console.error('Error fetching monthly data:', error);
      toast.error('Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPad = getDay(monthStart);

  const navigateMonth = (dir) => {
    const d = new Date(currentDate);
    d.setMonth(d.getMonth() + dir);
    setCurrentDate(d);
    setSelectedDay(null);
  };

  const getStatusForDay = (user, day) => {
    const dateKey = format(day, 'yyyy-MM-dd');
    return user.days[dateKey] || null;
  };

  const getCellClass = (dayStatus) => {
    if (!dayStatus || !dayStatus.clock_in) return 'cal-cell absent';
    if (dayStatus.clock_out) return 'cal-cell present full';
    return 'cal-cell present partial';
  };

  const getTooltip = (user, day) => {
    const ds = getStatusForDay(user, day);
    if (!ds || !ds.clock_in) return `${user.name} - Absent`;
    const ci = new Date(ds.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    let tip = `${user.name}\nClock In: ${ci}`;
    if (ds.clock_out) {
      const co = new Date(ds.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      tip += `\nClock Out: ${co}`;
    }
    return tip;
  };

  const totalPresent = (user) => {
    return Object.values(user.days).filter(d => d.clock_in).length;
  };

  const totalAbsent = (user) => {
    const today = new Date();
    const effectiveDays = days.filter(d => d <= today && !isWeekend(d));
    return effectiveDays.length - totalPresent(user);
  };

  const selectedDayData = selectedDay ? data.map(u => ({ user: u, day: getStatusForDay(u, selectedDay) })).filter(d => d.day) : [];

  return (
    <div className="calendar-page">
      <div className="page-header">
        <div>
          <h1><CalendarDays size={28} style={{ marginRight: 8, verticalAlign: 'middle' }} />Attendance Calendar</h1>
          <p className="subtitle">Monthly attendance overview for all employees</p>
        </div>
        <div className="calendar-nav">
          <button className="btn btn-icon" onClick={() => navigateMonth(-1)}><ChevronLeft size={24} /></button>
          <span className="calendar-month-label">{format(currentDate, 'MMMM yyyy')}</span>
          <button className="btn btn-icon" onClick={() => navigateMonth(1)}><ChevronRight size={24} /></button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Loading attendance data...</div>
      ) : (
        <>
          <div className="cal-card">
            <div className="cal-scroll">
              <table className="cal-table">
                <thead>
                  <tr>
                    <th className="cal-name-header">Employee</th>
                    {days.map((day, i) => {
                      const dayNum = day.getDate();
                      const weekend = isWeekend(day);
                      const todayClass = isToday(day) ? ' today' : '';
                      return (
                        <th key={i} className={`cal-day-header${weekend ? ' weekend' : ''}${todayClass}`}>
                          <span className="day-num">{dayNum}</span>
                          <span className="day-label">{DAY_LABELS[getDay(day)]}</span>
                        </th>
                      );
                    })}
                    <th className="cal-summary-header">P</th>
                    <th className="cal-summary-header">A</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(user => (
                    <tr key={user.user_id}>
                      <td className="cal-name-cell">
                        <div className="cal-employee">
                          <span className="avatar">{user.name.charAt(0)}</span>
                          <div>
                            <span className="name">{user.name}</span>
                            <span className="id">{user.employee_id}</span>
                          </div>
                        </div>
                      </td>
                      {days.map((day, i) => {
                        const ds = getStatusForDay(user, day);
                        const cellClass = getCellClass(ds);
                        const weekend = isWeekend(day);
                        return (
                          <td
                            key={i}
                            className={`${cellClass}${weekend ? ' weekend' : ''}`}
                            title={getTooltip(user, day)}
                            onClick={() => setSelectedDay(day)}
                          >
                            {ds && ds.clock_in ? (
                              <div className="cal-punch">
                                <span className="cal-badge">P</span>
                                {ds.clock_out && <span className="cal-checkout-dot" title="Clocked out">✓</span>}
                              </div>
                            ) : (
                              weekend ? '' : <span className="cal-absent-badge">A</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="cal-summary-cell present-count">{totalPresent(user)}</td>
                      <td className="cal-summary-cell absent-count">{totalAbsent(user)}</td>
                    </tr>
                  ))}
                  {data.length === 0 && (
                    <tr><td colSpan={days.length + 3} className="no-data">No employee data</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cal-legend">
            <span className="legend-item"><span className="cal-legend-dot present" /> Present (clocked in)</span>
            <span className="legend-item"><span className="cal-legend-badge full" /> Full Day (clocked in & out)</span>
            <span className="legend-item"><span className="cal-legend-dot absent" /> Absent</span>
            <span className="legend-item"><span className="cal-legend-dot weekend" /> Weekend</span>
          </div>

          {selectedDay && (
            <div className="cal-day-detail card" style={{ marginTop: 24 }}>
              <div className="card-header">
                <h2>Details for {format(selectedDay, 'EEEE, MMMM d, yyyy')}</h2>
              </div>
              <div className="card-body">
                {selectedDayData.length > 0 ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Status</th>
                        <th>Clock In</th>
                        <th>Clock Out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDayData.map(({ user, day }) => (
                        <tr key={user.user_id}>
                          <td>
                            <div className="employee-cell">
                              <div className="avatar">{user.name.charAt(0)}</div>
                              <div>
                                <span className="name">{user.name}</span>
                                <span className="id">{user.employee_id}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${day.clock_in ? 'badge-green' : 'badge-gray'}`}>
                              {day.clock_in ? 'Present' : 'Absent'}
                            </span>
                          </td>
                          <td>{day.clock_in ? new Date(day.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--'}</td>
                          <td>{day.clock_out ? new Date(day.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="no-data">No attendance records for this day</p>
                )}
              </div>
            </div>
          )}

          <div className="cal-stats" style={{ marginTop: 24 }}>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon blue"><CalendarDays size={24} /></div>
                <div>
                  <span className="stat-value">{days.length}</span>
                  <span className="stat-label">Days in Month</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green"><CalendarDays size={24} /></div>
                <div>
                  <span className="stat-value">{data.length}</span>
                  <span className="stat-label">Active Employees</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon orange"><CalendarDays size={24} /></div>
                <div>
                  <span className="stat-value">{data.reduce((sum, u) => sum + totalPresent(u), 0)}</span>
                  <span className="stat-label">Total Present (all)</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon purple"><CalendarDays size={24} /></div>
                <div>
                  <span className="stat-value">{data.reduce((sum, u) => sum + totalAbsent(u), 0)}</span>
                  <span className="stat-label">Total Absent (all)</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Calendar;
