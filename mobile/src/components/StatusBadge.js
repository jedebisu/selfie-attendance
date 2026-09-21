import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getNapStatusColor } from '../utils/helpers';

const StatusBadge = ({ status, size = 'sm' }) => {
  const bgColor = getNapStatusColor(status);
  return (
    <View style={[styles.badge, { backgroundColor: bgColor }, size === 'lg' && styles.badgeLg]}>
      <Text style={[styles.text, size === 'lg' && styles.textLg]}>
        {status || 'Unknown'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  badgeLg: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  textLg: {
    fontSize: 12,
  },
});

export default StatusBadge;