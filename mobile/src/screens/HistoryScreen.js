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

  const formatDate = (ts) => new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const formatTime = (ts) => new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <View style={styles.container}>
      <View style={styles.headerBar}>
        <Text style={styles.headerTitle}>History</Text>
        <Text style={styles.headerSub}>{records.length} records</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color="#1a1d23" style={{ marginTop: 50 }} />
      ) : records.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No attendance records yet</Text>
        </View>
      ) : (
        <FlatList
          data={records}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={{ paddingBottom: 20 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardLeft}>
                <View style={[styles.dot, { backgroundColor: item.status === 'clock_in' ? '#4ade80' : '#f87171' }]} />
                <View>
                  <Text style={styles.cardTitle}>{item.status === 'clock_in' ? 'Clock In' : 'Clock Out'}</Text>
                  <Text style={styles.cardDate}>{formatDate(item.timestamp)}</Text>
                </View>
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.cardTime}>{formatTime(item.timestamp)}</Text>
                {item.latitude && (
                  <Text style={styles.cardLocation}>{parseFloat(item.latitude).toFixed(4)}, {parseFloat(item.longitude).toFixed(4)}</Text>
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  headerBar: {
    backgroundColor: '#1a1d23', paddingTop: 56, paddingBottom: 20, paddingHorizontal: 24,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginHorizontal: 16, marginTop: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1a1d23' },
  cardDate: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
  cardRight: { alignItems: 'flex-end' },
  cardTime: { fontSize: 16, fontWeight: '700', color: '#1a1d23' },
  cardLocation: { fontSize: 10, color: '#9ca3af', marginTop: 2, fontFamily: 'monospace' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#9ca3af' },
});
