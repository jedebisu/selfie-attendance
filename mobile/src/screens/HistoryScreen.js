import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { attendanceAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function HistoryScreen() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { fetchRecords(); }, []);

  const fetchRecords = async () => {
    try {
      const res = await attendanceAPI.getAll({ user_id: user.id, limit: 50 });
      setRecords(res.data?.records || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); fetchRecords(); };

  const formatDateTime = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 50 }} />
      ) : records.length === 0 ? (
        <View style={styles.empty}><Text style={styles.emptyText}>No attendance records yet</Text></View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id.toString()}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.badge, { backgroundColor: item.status === 'clock_in' ? '#4CAF50' : '#FF9800' }]}>
                  <Text style={styles.badgeText}>{item.status === 'clock_in' ? 'IN' : 'OUT'}</Text>
                </View>
                <Text style={styles.time}>{formatDateTime(item.timestamp)}</Text>
              </View>
              {item.latitude && <Text style={styles.location}>📍 {parseFloat(item.latitude).toFixed(4)}, {parseFloat(item.longitude).toFixed(4)}</Text>}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', padding: 15 },
  card: { backgroundColor: '#fff', borderRadius: 15, padding: 15, marginBottom: 15, elevation: 3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  time: { fontSize: 14, color: '#333' },
  location: { fontSize: 12, color: '#888', marginTop: 5 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#666' },
});
