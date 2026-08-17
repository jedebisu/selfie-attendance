import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';

export default function HomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [todaySummary, setTodaySummary] = useState(null);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchTodaySummary();
    });
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Hello, {user?.name}!</Text>
        <Text style={styles.employeeId}>ID: {user?.employee_id}</Text>
      </View>

      <View style={styles.statusCard}>
        <Text style={styles.statusTitle}>Today's Status</Text>
        <View style={styles.statusContent}>
          <View style={styles.statusItem}>
            <Text style={styles.statusLabel}>First Clock In</Text>
            <Text style={styles.statusValue}>{formatTime(todaySummary?.first_clock_in)}</Text>
          </View>
          <View style={styles.statusItem}>
            <Text style={styles.statusLabel}>Last Clock Out</Text>
            <Text style={styles.statusValue}>{formatTime(todaySummary?.last_clock_out)}</Text>
          </View>
          <View style={styles.statusItem}>
            <Text style={styles.statusLabel}>Total Entries</Text>
            <Text style={styles.statusValue}>{todaySummary?.clock_in_count || 0}</Text>
          </View>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Camera', { status: 'clock_in' })}>
          <Text style={styles.primaryButtonText}>📸 Clock In</Text>
          <Text style={styles.primaryButtonSubtext}>Take a selfie to start</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.secondaryButton, !todaySummary?.first_clock_in && styles.disabledButton]}
          onPress={() => Alert.alert('Confirm Clock Out', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clock Out', onPress: () => navigation.navigate('Camera', { status: 'clock_out' }) }
          ])}
          disabled={!todaySummary?.first_clock_in}
        >
          <Text style={styles.secondaryButtonText}>🚪 Clock Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.bottomActions}>
        <TouchableOpacity onPress={() => navigation.navigate('History')}>
          <Text style={styles.linkButtonText}>📋 View History</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Alert.alert('Logout', 'Are you sure?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Logout', onPress: logout, style: 'destructive' }
        ])}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 20 },
  header: { marginBottom: 30 },
  greeting: { fontSize: 28, fontWeight: 'bold', color: '#333' },
  employeeId: { fontSize: 16, color: '#666', marginTop: 5 },
  statusCard: { backgroundColor: '#fff', borderRadius: 20, padding: 25, marginBottom: 30, elevation: 5 },
  statusTitle: { fontSize: 18, fontWeight: '600', color: '#333', marginBottom: 20 },
  statusContent: { flexDirection: 'row', justifyContent: 'space-between' },
  statusItem: { alignItems: 'center' },
  statusLabel: { fontSize: 12, color: '#666', marginBottom: 5 },
  statusValue: { fontSize: 18, fontWeight: '600', color: '#007AFF' },
  buttonContainer: { flex: 1, justifyContent: 'center', gap: 15 },
  primaryButton: { backgroundColor: '#007AFF', borderRadius: 20, padding: 25, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  primaryButtonSubtext: { color: '#fff', fontSize: 14, marginTop: 5, opacity: 0.9 },
  secondaryButton: { backgroundColor: '#fff', borderRadius: 20, padding: 25, alignItems: 'center', borderWidth: 2, borderColor: '#FF3B30' },
  disabledButton: { opacity: 0.5, borderColor: '#ccc' },
  secondaryButtonText: { color: '#FF3B30', fontSize: 22, fontWeight: '700' },
  bottomActions: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 20, borderTopWidth: 1, borderTopColor: '#eee' },
  linkButtonText: { color: '#007AFF', fontSize: 16, padding: 10 },
  logoutButtonText: { color: '#FF3B30', fontSize: 16, padding: 10 },
});
