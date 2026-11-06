import React, { useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { leaveAPI } from '../services/api';

const LeaveRequestScreen = ({ navigation }) => {
  const { user } = useAuth();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!startDate || !reason.trim()) {
      Alert.alert('Required Fields', 'Please enter start date and reason');
      return;
    }
    if (loading) return;

    // Basic date format validation (YYYY-MM-DD)
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startDate) || (endDate && !dateRe.test(endDate))) {
      Alert.alert('Invalid Date', 'Use YYYY-MM-DD format (e.g., 2026-11-15)');
      return;
    }

    const finalEndDate = endDate.trim() || startDate;
    if (finalEndDate < startDate) {
      Alert.alert('Invalid Range', 'End date cannot be before start date');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        start_date: startDate,
        end_date: finalEndDate,
        reason: reason.trim()
      };
      await leaveAPI.create(payload);
      Alert.alert(
        'Leave Requested',
        'Your leave request has been submitted and is pending approval.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      console.error('Leave request error:', error);
      const msg = error.response?.data?.error || error.message || 'Failed to submit leave request';
      Alert.alert('Request Failed', msg);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, reason, loading, navigation]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Request Leave</Text>
        <Text style={styles.subtitle}>{user?.name}</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>Start Date <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD (e.g., 2026-11-15)"
            value={startDate}
            onChangeText={setStartDate}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.hint}>First day of leave</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>End Date</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD (leave blank for single day)"
            value={endDate}
            onChangeText={setEndDate}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.hint}>Last day of leave (optional for 1-day requests)</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Reason <Text style={styles.required}>*</Text></Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="e.g., Personal matter, Medical appointment"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.hint}>{reason.length}/500 characters</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]}
          onPress={() => navigation.goBack()}
          disabled={loading}
        >
          <Text style={styles.buttonSecondaryText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.buttonPrimaryText}>Submit Request</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          💡 Your request will be reviewed by HR/management. You'll see the status in your calendar once approved.
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  content: {
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1a1d23',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#666',
  },
  form: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1a1d23',
    marginBottom: 8,
  },
  required: {
    color: '#ef4444',
  },
  input: {
    borderWidth: 1,
    borderColor: '#dce7f2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
    color: '#1a1d23',
  },
  textArea: {
    minHeight: 100,
    paddingTop: 10,
  },
  hint: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: '#c8956c',
  },
  buttonSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dce7f2',
  },
  buttonPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSecondaryText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  notice: {
    backgroundColor: '#e0f2fe',
    borderRadius: 8,
    padding: 16,
  },
  noticeText: {
    fontSize: 14,
    color: '#0369a1',
    lineHeight: 20,
  },
});

export default LeaveRequestScreen;
