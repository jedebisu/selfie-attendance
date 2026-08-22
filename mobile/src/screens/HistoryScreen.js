import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI, leaveAPI } from '../services/api';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const COLORS = {
  P: { bg: '#dcfce7', fg: '#166534' },
  L: { bg: '#dbeafe', fg: '#1e40af' },
  A: { bg: '#fee2e2', fg: '#991b1b' },
};

const phTodayKey = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const pad2 = (n) => String(n).padStart(2, '0');

const formatTimePH = (ts) => {
  try {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Manila',
    });
  } catch (e) {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
};

const HistoryScreen = () => {
  const { user } = useAuth();
  const nowPh = new Date(Date.now() + 8 * 3600 * 1000);
  const [viewYear, setViewYear] = useState(nowPh.getFullYear());
  const [viewMonth, setViewMonth] = useState(nowPh.getMonth() + 1);
  const [records, setRecords] = useState([]);
  const [leaveDates, setLeaveDates] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const data = await attendanceAPI.getMyCalendar(viewYear, viewMonth);
      setRecords(data.records || []);

      try {
        const leavesRes = await leaveAPI.getAll();
        const mine = {};
        for (const l of leavesRes.leaves || leavesRes || []) {
          if (String(l.user_id) !== String(user?.id)) continue;
          if (l.status && l.status !== 'approved') continue;
          let d = new Date(l.leave_date + 'T00:00:00Z');
          const end = l.end_date ? new Date(l.end_date + 'T00:00:00Z') : d;
          while (d <= end) {
            const key = d.toISOString().slice(0, 10);
            mine[key] = l.reason || 'On leave';
            d = new Date(d.getTime() + 86400000);
          }
        }
        setLeaveDates(mine);
      } catch (e) {
        setLeaveDates({});
      }
    } catch (error) {
      Alert.alert('Error', 'Could not load your attendance calendar.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [viewYear, viewMonth, user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
  };

  const changeMonth = (delta) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const dayMap = {};
  for (const r of records) {
    const key = new Date(new Date(r.timestamp).getTime() + 8 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    if (!dayMap[key]) dayMap[key] = { clock_in: null, clock_out: null };
    if (r.status === 'clock_in' && !dayMap[key].clock_in) dayMap[key].clock_in = r.timestamp;
    if (r.status === 'clock_out') dayMap[key].clock_out = r.timestamp;
  }

  const todayKey = phTodayKey();
  const firstWeekday = new Date(Date.UTC(viewYear, viewMonth - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth, 0)).getUTCDate();

  let presentDays = 0;
  let leaveDays = 0;
  let workdaysSoFar = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${viewYear}-${pad2(viewMonth)}-${pad2(d)}`;
    const weekday = new Date(Date.UTC(viewYear, viewMonth - 1, d)).getUTCDay();
    const isPastOrToday = key <= todayKey;
    if (dayMap[key]?.clock_in) presentDays += 1;
    if (leaveDates[key]) leaveDays += 1;
    if (isPastOrToday && weekday >= 1 && weekday <= 5) workdaysSoFar += 1;
  }
  const absentDays = Math.max(0, workdaysSoFar - presentDays - leaveDays);

  const handleDayPress = (d) => {
    const key = `${viewYear}-${pad2(viewMonth)}-${pad2(d)}`;
    const info = dayMap[key];
    if (leaveDates[key]) {
      Alert.alert(`Leave - ${MONTH_NAMES[viewMonth - 1]} ${d}`, leaveDates[key]);
      return;
    }
    if (!info || !info.clock_in) {
      Alert.alert(`${MONTH_NAMES[viewMonth - 1]} ${d}`, 'No clock-in recorded this day.');
      return;
    }
    const lines = [`Clock In: ${formatTimePH(info.clock_in)}`];
    lines.push(info.clock_out ? `Clock Out: ${formatTimePH(info.clock_out)}` : 'Clock Out: --');
    if (info.clock_in && info.clock_out) {
      const mins = Math.round((new Date(info.clock_out) - new Date(info.clock_in)) / 60000);
      lines.push(`Duration: ${Math.floor(mins / 60)}h ${mins % 60}m`);
    }
    Alert.alert(`${MONTH_NAMES[viewMonth - 1]} ${d}, ${viewYear}`, lines.join('\n'));
  };

  const renderDay = (d) => {
    const key = `${viewYear}-${pad2(viewMonth)}-${pad2(d)}`;
    const weekday = new Date(Date.UTC(viewYear, viewMonth - 1, d)).getUTCDay();
    const isPresent = Boolean(dayMap[key]?.clock_in);
    const isLeave = Boolean(leaveDates[key]);
    const isPast = key < todayKey;
    const isToday = key === todayKey;

    let status = null;
    if (isPresent) status = 'P';
    else if (isLeave) status = 'L';
    else if ((isPast || isToday) && weekday >= 0 && weekday <= 6) status = 'A';

    const colors = status ? COLORS[status] : null;

    return (
      <TouchableOpacity
        key={key}
        style={[
          styles.dayCell,
          colors ? { backgroundColor: colors.bg } : null,
          isToday ? styles.todayCell : null,
        ]}
        onPress={() => handleDayPress(d)}
      >
        <Text style={[styles.dayNum, colors ? { color: colors.fg } : null]}>{d}</Text>
        {status ? (
          <Text style={[styles.dayStatus, { color: colors.fg }]}>{status}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>My Attendance</Text>
        <Text style={styles.subtitle}>{user?.name} · {user?.employee_id}</Text>
      </View>

      <View style={styles.monthNav}>
        <TouchableOpacity style={styles.navButton} onPress={() => changeMonth(-1)}>
          <Text style={styles.navButtonText}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{MONTH_NAMES[viewMonth - 1]} {viewYear}</Text>
        <TouchableOpacity style={styles.navButton} onPress={() => changeMonth(1)}>
          <Text style={styles.navButtonText}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statChip, { backgroundColor: COLORS.P.bg }]}>
          <Text style={[styles.statText, { color: COLORS.P.fg }]}>{presentDays} Present</Text>
        </View>
        <View style={[styles.statChip, { backgroundColor: COLORS.A.bg }]}>
          <Text style={[styles.statText, { color: COLORS.A.fg }]}>{absentDays} Absent</Text>
        </View>
        <View style={[styles.statChip, { backgroundColor: COLORS.L.bg }]}>
          <Text style={[styles.statText, { color: COLORS.L.fg }]}>{leaveDays} Leave</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#c8956c" style={{ marginTop: 40 }} />
      ) : (
        <View style={styles.calendarCard}>
          <View style={styles.weekRow}>
            {DAY_LABELS.map((d) => (
              <Text key={d} style={styles.weekLabel}>{d}</Text>
            ))}
          </View>
          <View style={styles.grid}>
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <View key={`blank-${i}`} style={styles.dayCell} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => renderDay(i + 1))}
          </View>
        </View>
      )}

      <Text style={styles.legend}>
        P = Present · L = On Leave · A = Absent{'\n'}Tap a day to see your clock in/out times
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1a1d23',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  navButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  navButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1d23',
  },
  monthLabel: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1d23',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  statChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statText: {
    fontSize: 12,
    fontWeight: '700',
  },
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 0.95,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginVertical: 1,
  },
  todayCell: {
    borderWidth: 2,
    borderColor: '#c8956c',
  },
  dayNum: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  dayStatus: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  legend: {
    marginTop: 16,
    textAlign: 'center',
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 18,
  },
});

export default HistoryScreen;
