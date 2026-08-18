import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';
import { scheduleClockOutReminder, cancelAllReminders } from '../utils/notifications';

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [todaySummary, setTodaySummary] = useState(null);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => { fetchTodaySummary(); });
    return unsubscribe;
  }, [navigation]);

  const fetchTodaySummary = async () => {
    try {
      const res = await attendanceAPI.getTodaySummary();
      const data = res.data || [];
      const myRecord = data.find(r => r.id === user.id);
      setTodaySummary(myRecord);
    } catch (error) {
      console.error('Error fetching summary:', error);
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '--:--';
    return new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const hasClockedIn = !!todaySummary?.first_clock_in;

  useEffect(() => {
    if (hasClockedIn && !todaySummary?.last_clock_out) {
      scheduleClockOutReminder();
    } else {
      cancelAllReminders();
    }
  }, [hasClockedIn, todaySummary]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Image source={require('../../assets/logo.png')} style={styles.headerLogo} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>Hello, {user?.name?.split(' ')[0]}</Text>
            <Text style={styles.employeeId}>{user?.employee_id}</Text>
          </View>
          <TouchableOpacity onPress={() => Alert.alert('Logout', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Logout', onPress: logout, style: 'destructive' }
          ])} style={styles.logoutBtn}>
            <Text style={styles.logoutText}> Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, { backgroundColor: '#4ade80' }]} />
            <Text style={styles.statusLabel}>Clock In</Text>
            <Text style={styles.statusValue}>{formatTime(todaySummary?.first_clock_in)}</Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, { backgroundColor: '#f87171' }]} />
            <Text style={styles.statusLabel}>Clock Out</Text>
            <Text style={styles.statusValue}>{formatTime(todaySummary?.last_clock_out)}</Text>
          </View>
          <View style={styles.statusDivider} />
          <View style={styles.statusItem}>
            <View style={[styles.statusDot, { backgroundColor: '#60a5fa' }]} />
            <Text style={styles.statusLabel}>Entries</Text>
            <Text style={styles.statusValue}>{todaySummary?.clock_in_count || 0}</Text>
          </View>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('Camera', { status: 'clock_in' })}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryIcon}>Clock In</Text>
          <Text style={styles.primarySubtext}>Take a selfie to start your day</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, !hasClockedIn && styles.disabledButton]}
          onPress={() => Alert.alert('Confirm Clock Out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clock Out', onPress: () => navigation.navigate('Camera', { status: 'clock_out' }) }
          ])}
          disabled={!hasClockedIn}
          activeOpacity={0.85}
        >
          <Text style={styles.secondaryIcon}>Clock Out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.historyLink} onPress={() => navigation.navigate('History')} activeOpacity={0.7}>
        <Text style={styles.historyText}>View Attendance History</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  header: {
    backgroundColor: '#1a1d23', paddingTop: 60, paddingBottom: 28, paddingHorizontal: 24,
    borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerLogo: { width: 44, height: 44, marginRight: 14, borderRadius: 12 },
  greeting: { fontSize: 22, fontWeight: '700', color: '#fff' },
  employeeId: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 2, letterSpacing: 1 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  logoutText: { color: 'rgba(255,255,255,0.5)', fontSize: 13 },

  statusCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20, marginTop: -14, marginHorizontal: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 4,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusItem: { flex: 1, alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
  statusLabel: { fontSize: 11, color: '#9ca3af', marginBottom: 4, letterSpacing: 0.5 },
  statusValue: { fontSize: 18, fontWeight: '700', color: '#1a1d23' },
  statusDivider: { width: 1, height: 36, backgroundColor: '#e5e7eb' },

  buttonContainer: { marginTop: 28, paddingHorizontal: 20, gap: 14 },
  primaryButton: {
    backgroundColor: '#1a1d23', borderRadius: 20, padding: 24, alignItems: 'center',
    shadowColor: '#1a1d23', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 6,
  },
  primaryIcon: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  primarySubtext: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 6 },
  secondaryButton: {
    backgroundColor: '#fff', borderRadius: 20, padding: 22, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#e5e7eb',
  },
  disabledButton: { opacity: 0.4 },
  secondaryIcon: { color: '#1a1d23', fontSize: 20, fontWeight: '700', letterSpacing: 0.5 },

  historyLink: { alignItems: 'center', paddingTop: 24, paddingBottom: 16 },
  historyText: { color: '#6b7280', fontSize: 14, fontWeight: '500', letterSpacing: 0.3 },
});
