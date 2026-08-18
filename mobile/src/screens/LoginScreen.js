import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen() {
  const [employeeId, setEmployeeId] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async () => {
    if (!employeeId.trim() || !pin.trim()) {
      Alert.alert('Error', 'Please enter both Employee ID and PIN');
      return;
    }
    setLoading(true);
    const result = await login(employeeId.trim(), pin);
    setLoading(false);
    if (!result.success) Alert.alert('Login Failed', result.error);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.bgAccent} />
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          <View style={styles.logoWrap}>
            <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
          </View>
          <Text style={styles.title}>EBISU</Text>
          <Text style={styles.subtitle}>Time & Attendance</Text>
        </View>
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Employee ID</Text>
            <TextInput
              style={styles.input}
              value={employeeId}
              onChangeText={setEmployeeId}
              placeholder="e.g. EMP001"
              placeholderTextColor="#9ca3af"
              autoCapitalize="characters"
              editable={!loading}
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={setPin}
              placeholder="Enter your password"
              placeholderTextColor="#9ca3af"
              secureTextEntry
              keyboardType="numeric"
              maxLength={20}
              editable={!loading}
            />
          </View>
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.footer}>Secure employee attendance tracking</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f2f5' },
  bgAccent: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 320,
    backgroundColor: '#1a1d23', borderBottomLeftRadius: 40, borderBottomRightRadius: 40,
  },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, marginTop: 40 },
  logoContainer: { alignItems: 'center', marginBottom: 48 },
  logoWrap: {
    width: 100, height: 100, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 10,
  },
  logo: { width: 72, height: 72 },
  title: { fontSize: 32, fontWeight: '800', color: '#fff', letterSpacing: 3 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 6, letterSpacing: 1 },
  form: {
    backgroundColor: '#fff', padding: 28, borderRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 20, elevation: 8,
  },
  inputGroup: { marginBottom: 18 },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8, letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 14, padding: 16, fontSize: 16,
    backgroundColor: '#f9fafb', color: '#1a1d23',
  },
  button: {
    backgroundColor: '#1a1d23', padding: 18, borderRadius: 14, alignItems: 'center', marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700', letterSpacing: 1 },
  footer: { textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 32, letterSpacing: 0.5 },
});
