import React, { useState, useEffect, useCallback, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';
import { getCachedTodaySummary, cacheTodaySummary } from '../services/cache';
import { checkConnection } from '../services/network';
import { getQueueLength } from '../services/offlineQueue';
import { scheduleClockOutReminder, cancelAllReminders } from '../utils/notifications';
import { syncTrackingWithShiftState } from '../services/locationTracker';

const HomeScreen = memo(({ navigation }) => {
  const { user } = useAuth();
  const [todaySummary, setTodaySummary] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const onShift = Boolean(todaySummary?.clock_in) && !todaySummary?.clock_out;

  useEffect(() => {
    if (!onShift) return;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [onShift]);

  const fetchTodaySummary = useCallback(async () => {
    try {
      const connected = await checkConnection();
      setIsOnline(connected);

      if (connected) {
        const summary = await attendanceAPI.getTodaySummary();
        setTodaySummary(summary);
        await cacheTodaySummary(summary);
      } else {
        const cached = await getCachedTodaySummary();
        if (cached) setTodaySummary(cached);
      }

      const queueLen = await getQueueLength();
      setPendingCount(queueLen);

      if (summary) {
        syncTrackingWithShiftState(Boolean(summary.clock_in) && !summary.clock_out);
      }
    } catch (error) {
      const cached = await getCachedTodaySummary();
      if (cached) setTodaySummary(cached);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTodaySummary();
    }, [fetchTodaySummary])
  );

  useEffect(() => {
    if (todaySummary?.clock_in && !todaySummary?.clock_out) {
      scheduleClockOutReminder();
    } else {
      cancelAllReminders();
    }
  }, [todaySummary]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTodaySummary();
    setRefreshing(false);
  };

  const handleClockIn = () => {
    navigation.navigate('Camera', { status: 'clock_in' });
  };

  const handleClockOut = () => {
    navigation.navigate('Camera', { status: 'clock_out' });
  };

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const formatElapsed = (ms) => {
    const mins = Math.max(0, Math.floor(ms / 60000));
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting},</Text>
        <Text style={styles.greetingName}>{user?.name?.split(' ')[0] || 'User'} 👋</Text>
        <Text style={styles.date}>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        
        {!isOnline && (
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineText}>📡 Offline Mode</Text>
          </View>
        )}
        
        {pendingCount > 0 && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>⏳ {pendingCount} pending sync</Text>
          </View>
        )}
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Today's Status</Text>
        
        <View style={styles.timeRow}>
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Clock In</Text>
            <Text style={styles.timeValue}>
              {todaySummary?.clock_in
                ? new Date(todaySummary.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                : '--:--'}
            </Text>
          </View>
          
          <View style={styles.timeDivider} />
          
          <View style={styles.timeBlock}>
            <Text style={styles.timeLabel}>Clock Out</Text>
            <Text style={styles.timeValue}>
              {todaySummary?.clock_out
                ? new Date(todaySummary.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                : '--:--'}
            </Text>
          </View>
        </View>

        {onShift && (
          <View style={styles.hoursBlock}>
            <Text style={styles.hoursLabel}>On Shift</Text>
            <Text style={styles.hoursValue}>
              {formatElapsed(now - new Date(todaySummary.clock_in))}
            </Text>
          </View>
        )}

        {todaySummary?.clock_in && todaySummary?.clock_out && (
          <View style={styles.hoursBlock}>
            <Text style={styles.hoursLabel}>Hours Worked</Text>
            <Text style={styles.hoursValue}>
              {(() => {
                const diff = new Date(todaySummary.clock_out) - new Date(todaySummary.clock_in);
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                return `${hours}h ${mins}m`;
              })()}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.buttonContainer}>
        {!todaySummary?.clock_in ? (
          <TouchableOpacity style={[styles.actionButton, styles.clockInButton]} onPress={handleClockIn}>
            <Text style={styles.actionButtonText}>Clock In</Text>
          </TouchableOpacity>
        ) : !todaySummary?.clock_out ? (
          <TouchableOpacity style={[styles.actionButton, styles.clockOutButton]} onPress={handleClockOut}>
            <Text style={styles.actionButtonText}>Clock Out</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.completedBadge}>
            <Text style={styles.completedText}>✓ Day Complete</Text>
          </View>
        )}
      </View>

      <View style={styles.quickRow}>
        <TouchableOpacity
          style={styles.quickButton}
          onPress={() => navigation.navigate('Calendar')}
        >
          <Text style={styles.quickButtonText}>📅 Calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickButton}
          onPress={() => navigation.navigate('NAPs')}
        >
          <Text style={styles.quickButtonText}>🗺️ NAP Checking</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 20,
    color: '#666',
  },
  greetingName: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#1a1d23',
    marginTop: 2,
  },
  date: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  offlineBadge: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 12,
  },
  offlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  pendingBadge: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  pendingText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1d23',
    marginBottom: 20,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  timeBlock: {
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  timeValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a1d23',
  },
  timeDivider: {
    width: 1,
    height: 60,
    backgroundColor: '#e5e7eb',
  },
  hoursBlock: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    alignItems: 'center',
  },
  hoursLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  hoursValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#22c55e',
  },
  buttonContainer: {
    marginBottom: 16,
  },
  actionButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  clockInButton: {
    backgroundColor: '#22c55e',
  },
  clockOutButton: {
    backgroundColor: '#ef4444',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  completedBadge: {
    backgroundColor: '#22c55e',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  completedText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  quickRow: {
    flexDirection: 'row',
    gap: 12,
  },
  quickButton: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  quickButtonText: {
    color: '#1a1d23',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default HomeScreen;
