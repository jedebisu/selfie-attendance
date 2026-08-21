import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, FlatList
} from 'react-native';
import { leaveAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const COLORS = {
  green: '#22c55e',
  orange: '#f59e0b',
  gray: '#6b7280',
  lightGray: '#e5e7eb',
  primary: '#c8956c',
  dark: '#1a1d23',
  red: '#ef4444',
  blue: '#3b82f6',
};

const STATUS_STYLES = {
  pending: { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
  approved: { bg: '#dcfce7', color: '#166534', label: 'Approved' },
  rejected: { bg: '#f3f4f6', color: '#6b7280', label: 'Rejected' },
};

const fmtDate = (s) => {
  if (!s) return '';
  const [y, m, d] = s.split('T')[0].split('-');
  return new Date(parseInt(y), parseInt(m) - 1, parseInt(d))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const LeaveApprovalScreen = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState('pending');
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);

  const fetchLeaves = useCallback(async (whichTab = tab) => {
    try {
      setLoading(true);
      const params = whichTab === 'pending' ? { status: 'pending' } : {};
      const data = await leaveAPI.getAll(params);
      setLeaves(data || []);
    } catch (error) {
      console.error('Error fetching leaves:', error);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { fetchLeaves(tab); }, [tab, fetchLeaves]);

  const decide = (leave, status) => {
    const action = status === 'approved' ? 'APPROVE' : 'REJECT';
    Alert.alert(
      `${action} Leave`,
      `${leave.user_name}\n${fmtDate(leave.leave_date)}${leave.end_date && leave.end_date !== leave.leave_date ? ` - ${fmtDate(leave.end_date)}` : ''}\n\n"${leave.reason}"`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action.charAt(0) + action.slice(1).toLowerCase(),
          style: status === 'approved' ? 'default' : 'destructive',
          onPress: async () => {
            try {
              setActingId(leave.id);
              await leaveAPI.update(leave.id, status);
              fetchLeaves();
            } catch (error) {
              Alert.alert('Error', error.response?.data?.error || 'Failed to update leave');
            } finally {
              setActingId(null);
            }
          }
        }
      ]
    );
  };

  const renderLeave = ({ item }) => {
    const s = STATUS_STYLES[item.status] || STATUS_STYLES.rejected;
    const isRange = item.end_date && item.end_date !== item.leave_date;
    const busy = actingId === item.id;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.employeeRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.user_name?.charAt(0)}</Text>
            </View>
            <View>
              <Text style={styles.employeeName}>{item.user_name}</Text>
              <Text style={styles.employeeId}>{item.employee_id}</Text>
            </View>
          </View>
          <View style={[styles.badge, { backgroundColor: s.bg }]}>
            <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
          </View>
        </View>

        <Text style={styles.dates}>
          {isRange
            ? `${fmtDate(item.leave_date)} - ${fmtDate(item.end_date)}`
            : fmtDate(item.leave_date)}
          <Text style={styles.days}>  ({item.days} day{item.days > 1 ? 's' : ''})</Text>
        </Text>
        <Text style={styles.reason}>"{item.reason}"</Text>

        {item.status === 'pending' && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.rejectButton]}
              disabled={busy}
              onPress={() => decide(item, 'rejected')}
            >
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.approveButton]}
              disabled={busy}
              onPress={() => decide(item, 'approved')}
            >
              {busy
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.approveText}>Approve</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (user?.role !== 'ceo') {
    return (
      <View style={styles.container}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>CEO access only</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'pending' && styles.tabActive]}
          onPress={() => setTab('pending')}
        >
          <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>Pending</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'all' && styles.tabActive]}
          onPress={() => setTab('all')}
        >
          <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>All Requests</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={styles.loader} />
      ) : leaves.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {tab === 'pending' ? 'No pending requests' : 'No leave requests yet'}
          </Text>
          <Text style={styles.emptySubtext}>You're all caught up</Text>
        </View>
      ) : (
        <FlatList
          data={leaves}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderLeave}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  tabs: {
    flexDirection: 'row',
    margin: 16,
    marginBottom: 8,
    backgroundColor: COLORS.lightGray,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray,
  },
  tabTextActive: {
    color: COLORS.dark,
  },
  loader: {
    marginTop: 40,
  },
  empty: {
    alignItems: 'center',
    marginTop: 60,
  },
  emptyText: {
    fontSize: 16,
    color: COLORS.dark,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 13,
    color: COLORS.gray,
    marginTop: 4,
  },
  list: {
    padding: 16,
    paddingTop: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.dark,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  employeeName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
  },
  employeeId: {
    fontSize: 12,
    color: COLORS.gray,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dates: {
    fontSize: 14,
    color: COLORS.dark,
    fontWeight: '500',
    marginTop: 10,
  },
  days: {
    color: COLORS.blue,
    fontWeight: '600',
    fontSize: 12,
  },
  reason: {
    fontSize: 13,
    color: COLORS.gray,
    marginTop: 4,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
  },
  rejectButton: {
    backgroundColor: '#fee2e2',
  },
  rejectText: {
    color: COLORS.red,
    fontWeight: '700',
    fontSize: 14,
  },
  approveButton: {
    backgroundColor: COLORS.green,
  },
  approveText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});

export default LeaveApprovalScreen;
