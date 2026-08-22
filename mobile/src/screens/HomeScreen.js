import React, { useState, useEffect, useCallback, memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';
import { getCachedTodaySummary, cacheTodaySummary } from '../services/cache';
import { checkConnection } from '../services/network';
import { getQueueLength } from '../services/offlineQueue';
import { scheduleClockOutReminder, cancelAllReminders } from '../utils/notifications';
import { syncTrackingWithShiftState, getTrackingDiagnostics, flushPings } from '../services/locationTracker';

const HomeScreen = memo(({ navigation }) => {
  const { user, logout } = useAuth();
  const [todaySummary, setTodaySummary] = useState(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

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

  const handleLogout = () => {
    logout();
  };

  const showTrackingStatus = async () => {
    const d = await getTrackingDiagnostics();
    flushPings().catch(() => {});
    Alert.alert(
      'Tracking Status',
      [
        `Background permission: ${d.backgroundPermission}`,
        `Tracker running: ${d.trackingStarted ? 'YES' : 'NO'}`,
        `Pings waiting to upload: ${d.queuedPings}`,
        `Last upload: ${d.lastFlushAt ? new Date(d.lastFlushAt).toLocaleTimeString() : 'never'}${d.lastUploaded != null ? ` (${d.lastUploaded} stored)` : ''}`,
        d.lastFlushError ? `Upload error: ${d.lastFlushError}` : '',
        d.lastStartError ? `Start error: ${d.lastStartError}` : '',
      ].filter(Boolean).join('\n')
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.greeting}>Hello, {user?.name || 'User'}!</Text>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
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

      <TouchableOpacity style={styles.historyButton} onPress={() => navigation.navigate('History')}>
        <Text style={styles.historyButtonText}>View History</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.historyButton, { backgroundColor: '#1a1d23', marginTop: 12 }]}
        onPress={() => navigation.navigate('NapMap')}
      >
        <Text style={[styles.historyButtonText, { color: '#fff' }]}>CVN | CVS Naps</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.historyButton, { marginTop: 12 }]}
        onPress={showTrackingStatus}
      >
        <Text style={styles.historyButtonText}>GPS Tracking Status</Text>
      </TouchableOpacity>

      {user?.role === 'ceo' && (
        <TouchableOpacity
          style={[styles.historyButton, { backgroundColor: '#22c55e', marginTop: 12 }]}
          onPress={() => navigation.navigate('LeaveApproval')}
        >
          <Text style={[styles.historyButtonText, { color: '#fff' }]}>Leave Approvals</Text>
        </TouchableOpacity>
      )}
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
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  greeting: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1d23',
  },
  logoutButton: {
    padding: 8,
  },
  logoutText: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
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
  historyButton: {
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  historyButtonText: {
    color: '#1a1d23',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default HomeScreen;
