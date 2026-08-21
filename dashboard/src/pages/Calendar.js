import React, { useState, useEffect, useCallback, useRef } from 'react';
import { attendanceAPI, leaveAPI } from '../services/api';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isToday, isWeekend, isFuture, addMonths, subMonths, startOfWeek, endOfWeek
} from 'date-fns';
import { ChevronLeft, ChevronRight, CalendarDays, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_COLORS = {
  P: { bg: '#dcfce7', color: '#166534', label: 'Present' },
  A: { bg: '#fee2e2', color: '#991b1b', label: 'Absent' },
  L: { bg: '#dbeafe', color: '#1e40af', label: 'On Leave' },
};

const SingleCalendar = ({ user, monthDate, onClickDay, leaveDates }) => {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const allDays = eachDayOfInterval({ start: calStart, end: calEnd });

  const presentDays = Object.keys(user.days).filter(d => user.days[d].status === 'present').length;
  const leaveDays = allDays.filter(d => {
    const dateKey = format(d, 'yyyy-MM-dd');
    return leaveDates.has(dateKey) && d >= monthStart && d <= monthEnd && !isWeekend(d);
  }).length;
  const totalWorkdays = allDays.filter(d =>
    !isWeekend(d) && d >= monthStart && d <= monthEnd && !isFuture(d)
  ).length;
  const absentDays = totalWorkdays - presentDays - leaveDays;

  return (
    <div className="emp-cal-card">
      <div className="emp-cal-header">
        <div className="emp-cal-user">
          <div className="emp-cal-avatar">{user.name.charAt(0)}</div>
          <div>
            <div className="emp-cal-name">{user.name}</div>
            <div className="emp-cal-id">{user.employee_id}</div>
          </div>
        </div>
        <div className="emp-cal-summary">
          <span className="emp-cal-stat present">{presentDays}P</span>
          <span className="emp-cal-stat absent">{Math.max(0, absentDays)}A</span>
          <span className="emp-cal-stat leave">{leaveDays}L</span>
        </div>
      </div>

      <div className="emp-cal-grid">
        {DAY_LABELS.map(d => (
          <div key={d} className="emp-cal-day-label">{d}</div>
        ))}
        {allDays.map((day, i) => {
          const inMonth = day >= monthStart && day <= monthEnd;
          const weekend = isWeekend(day);
          const today = isToday(day);
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayData = user.days[dateKey];
          const isPresent = dayData && dayData.status === 'present';
          const isLeave = leaveDates.has(dateKey);

          let status = null;
          let cellBg = 'transparent';
          let cellColor = '#ccc';

          if (inMonth) {
            if (isPresent) {
              status = 'P';
              cellBg = STATUS_COLORS.P.bg;
              cellColor = STATUS_COLORS.P.color;
            } else if (isLeave) {
              status = 'L';
              cellBg = STATUS_COLORS.L.bg;
              cellColor = STATUS_COLORS.L.color;
            } else if (!isFuture(day)) {
              status = 'A';
              cellBg = STATUS_COLORS.A.bg;
              cellColor = STATUS_COLORS.A.color;
            }
          }

          return (
            <div
              key={i}
              className={`emp-cal-day${!inMonth ? ' outside' : ''}${today ? ' today' : ''}${status ? ' has-status' : ''}`}
              style={status ? { backgroundColor: cellBg, color: cellColor } : {}}
              title={status ? `${format(day, 'MMM d')}: ${STATUS_COLORS[status].label}` : format(day, 'MMM d')}
              onClick={() => inMonth && onClickDay(day, user)}
            >
              <span className="emp-day-num">{day.getDate()}</span>
              {status && <span className="emp-day-status">{status}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Calendar = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [data, setData] = useState([]);
  const [leaveDates, setLeaveDates] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  const inFlight = useRef(false);

  // silent=true for background polling/manual refresh (no loading flash);
  // silent=false shows the full loading state on first load / month change.
  const fetchData = useCallback(async ({ silent = false } = {}) => {
    if (silent && inFlight.current) return;
    inFlight.current = true;
    if (!silent) setLoading(true);
    try {
      const [attendRes, leaveRes] = await Promise.all([
        attendanceAPI.getMonthlySummary(year, month),
        leaveAPI.getMonth(year, month)
      ]);
      setData(attendRes.data.users || []);

      const dates = new Set();
      (leaveRes.data || []).forEach(l => {
        if (l.status === 'approved') dates.add(l.leave_date);
      });
      setLeaveDates(dates);
    } catch (error) {
      if (!silent) {
        console.error('Error fetching calendar data:', error);
        toast.error('Failed to load calendar data');
      }
    } finally {
      inFlight.current = false;
      if (!silent) setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => fetchData({ silent: true }), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const navigateMonth = (dir) => {
    setCurrentDate(dir === 1 ? addMonths(currentDate, 1) : subMonths(currentDate, 1));
    setSelectedUser(null);
  };

  const onClickDay = (day, user) => {
    const dateKey = format(day, 'yyyy-MM-dd');
    const dayData = user.days[dateKey];
    setSelectedUser({ user, day, dayData });
  };

  return (
    <div className="calendar-page">
      <div className="page-header">
        <div>
          <h1><CalendarDays size={28} style={{ marginRight: 8, verticalAlign: 'middle' }} />Attendance Calendar</h1>
          <p className="subtitle">Per-employee monthly attendance view</p>
        </div>
        <div className="calendar-nav">
          <button className="btn btn-icon" onClick={() => fetchData({ silent: true })} title="Refresh"><RefreshCw size={18} /></button>
          <button className="btn btn-icon" onClick={() => navigateMonth(-1)}><ChevronLeft size={24} /></button>
          <span className="calendar-month-label">{format(currentDate, 'MMMM yyyy')}</span>
          <button className="btn btn-icon" onClick={() => navigateMonth(1)}><ChevronRight size={24} /></button>
        </div>
      </div>

      <div className="cal-legend-bar">
        <span className="legend-item"><span className="cal-legend-swatch" style={{ background: STATUS_COLORS.P.bg, border: `1px solid ${STATUS_COLORS.P.color}` }} /> P = Present</span>
        <span className="legend-item"><span className="cal-legend-swatch" style={{ background: STATUS_COLORS.A.bg, border: `1px solid ${STATUS_COLORS.A.color}` }} /> A = Absent</span>
        <span className="legend-item"><span className="cal-legend-swatch" style={{ background: STATUS_COLORS.L.bg, border: `1px solid ${STATUS_COLORS.L.color}` }} /> L = On Leave</span>
        <span className="legend-item"><span className="cal-legend-swatch today-swatch" /> Today</span>
      </div>

      {loading ? (
        <div className="loading">Loading attendance data...</div>
      ) : (
        <>
          <div className="emp-cal-grid-container">
            {data.length === 0 ? (
              <div className="no-data">No employee data found</div>
            ) : (
              data.map(user => (
                <SingleCalendar
                  key={user.user_id}
                  user={user}
                  monthDate={currentDate}
                  onClickDay={onClickDay}
                  leaveDates={leaveDates}
                />
              ))
            )}
          </div>

          {selectedUser && (
            <div className="day-detail-overlay" onClick={() => setSelectedUser(null)}>
              <div className="day-detail-modal" onClick={e => e.stopPropagation()}>
                <div className="day-detail-header">
                  <div>
                    <strong>{selectedUser.user.name}</strong> &mdash; {format(selectedUser.day, 'EEEE, MMMM d, yyyy')}
                  </div>
                  <button className="modal-close" onClick={() => setSelectedUser(null)}>&times;</button>
                </div>
                <div className="day-detail-body">
                  {selectedUser.dayData ? (
                    <table className="data-table">
                      <thead>
                        <tr><th>Type</th><th>Time</th></tr>
                      </thead>
                      <tbody>
                        {selectedUser.dayData.records.map((r, i) => (
                          <tr key={i}>
                            <td>
                              <span className={`badge ${r.status === 'clock_in' ? 'badge-green' : 'badge-orange'}`}>
                                {r.status === 'clock_in' ? 'Clock In' : 'Clock Out'}
                              </span>
                            </td>
                            <td>{new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : leaveDates.has(format(selectedUser.day, 'yyyy-MM-dd')) ? (
                    <p className="no-data" style={{ color: '#1e40af' }}>On Leave</p>
                  ) : (
                    <p className="no-data">No records — Absent</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Calendar;
