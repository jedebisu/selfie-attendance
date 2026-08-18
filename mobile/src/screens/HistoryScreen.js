import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';
import { getCachedHistory, cacheHistory } from '../services/cache';
import { checkConnection } from '../services/network';

const HistoryScreen = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const fetchHistory = useCallback(async () => {
    try {
      const connected = await checkConnection();
      setIsOnline(connected);

      if (connected) {
        const data = await attendanceAPI.getAll({ user_id: user.id, limit: 50 });
        setRecords(data);
        await cacheHistory(data);
      } else {
        const cached = await getCachedHistory();
        if (cached.length > 0) {
          setRecords(cached);
        }
      }
    } catch (error) {
      const cached = await getCachedHistory();
      if (cached.length > 0) {
        setRecords(cached);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const renderItem = ({ item }) => (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <Text style={styles.recordDate}>{formatDate(item.timestamp)}</Text>
        <Text style={[
          styles.recordStatus,
          item.status === 'clock_in' ? styles.statusIn : styles.statusOut
        ]}>
          {item.status === 'clock_in' ? 'Clock In' : 'Clock Out'}
        </Text>
      </View>
      <View style={styles.recordBody}>
        <Text style={styles.recordTime}>{formatTime(item.timestamp)}</Text>
        {item.latitude && item.longitude && (
          <Text style={styles.recordLocation}>
            📍 {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
          </Text>
        )}
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#c8956c" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!isOnline && (
        <View style={styles.offlineBar}>
          <Text style={styles.offlineText}>📡 Offline - Showing cached data</Text>
        </View>
      )}
      
      <FlatList
        data={records}
        keyExtractor={(item) => item.id?.toString() || item.timestamp}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No attendance records found</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  offlineBar: {
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  list: {
    padding: 16,
  },
  recordCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  recordDate: {
    fontSize: 14,
    color: '#666',
  },
  recordStatus: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusIn: {
    backgroundColor: '#dcfce7',
    color: '#166534',
  },
  statusOut: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
  },
  recordBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  recordTime: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1a1d23',
  },
  recordLocation: {
    fontSize: 12,
    color: '#666',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});

export default HistoryScreen;
