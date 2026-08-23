import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

const ROLE_LABELS = {
  admin: 'Admin',
  hr: 'HR',
  ceo: 'Executive',
  employee: 'Employee',
};

const ProfileScreen = ({ navigation }) => {
  const { user, logout } = useAuth();

  const roleLabel = ROLE_LABELS[user?.role] || 'Employee';
  const canApproveLeave = user?.role === 'ceo' || user?.role === 'hr' || user?.role === 'admin';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user?.name || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.name}>{user?.name || 'User'}</Text>
        <Text style={styles.employeeId}>{user?.employee_id || ''}</Text>
        <View style={[styles.roleBadge, user?.role === 'ceo' && styles.roleBadgeExec]}>
          <Text style={styles.roleBadgeText}>{roleLabel}</Text>
        </View>
      </View>

      {canApproveLeave && (
        <TouchableOpacity
          style={styles.row}
          onPress={() => navigation.navigate('LeaveApproval')}
        >
          <Ionicons name="checkmark-done" size={22} color="#c8956c" />
          <Text style={styles.rowText}>Leave Approvals</Text>
          <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('Calendar')}>
        <Ionicons name="calendar" size={22} color="#c8956c" />
        <Text style={styles.rowText}>My Calendar</Text>
        <Ionicons name="chevron-forward" size={18} color="#d1d5db" />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.row, styles.logoutRow]} onPress={logout}>
        <Ionicons name="log-out" size={22} color="#ef4444" />
        <Text style={[styles.rowText, { color: '#ef4444' }]}>Log Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>EBISU T&A v1.3.0</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
  },
  profileCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  avatar: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#c8956c',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fff',
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1a1d23',
  },
  employeeId: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 4,
    marginBottom: 10,
  },
  roleBadge: {
    backgroundColor: '#1a1d23',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
  },
  roleBadgeExec: {
    backgroundColor: '#c8956c',
  },
  roleBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1d23',
  },
  logoutRow: {
    marginTop: 8,
  },
  version: {
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 16,
  },
});

export default ProfileScreen;
