import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';

export default function CameraScreen({ route, navigation }) {
  const { status } = route.params;
  const { user } = useAuth();
  const cameraRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [locationError, setLocationError] = useState(null);
  const [countdown, setCountdown] = useState(null);

  const fetchLocation = async () => {
    try {
      const locStatus = await Location.requestForegroundPermissionsAsync();
      if (locStatus.status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        setLocationError(null);
      } else {
        setLocationError('Location permission denied');
      }
    } catch (e) {
      setLocationError('Tap to retry location');
    }
  };

  useEffect(() => { fetchLocation(); }, []);

  useEffect(() => {
    (async () => {
      const camStatus = await requestCameraPermission();
      if (!camStatus.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed.', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      }
    })();
  }, []);

  const takePicture = async () => {
    if (!cameraRef.current || loading) return;
    setLoading(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      const formData = new FormData();
      formData.append('photo', { uri: photo.uri, type: 'image/jpeg', name: `photo_${Date.now()}.jpg` });
      formData.append('user_id', user.id.toString());
      formData.append('status', status);
      if (location) {
        formData.append('latitude', location.latitude.toString());
        formData.append('longitude', location.longitude.toString());
      }
      await attendanceAPI.submit(formData);
      Alert.alert('Success!', `Clocked ${status === 'clock_in' ? 'in' : 'out'}!`, [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      console.error('Submit error:', error);
      const msg = error.response?.data?.error || error.message || 'Failed to submit. Try again.';
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  if (!cameraPermission?.granted) {
    return <View style={styles.container}><Text style={{ color: '#fff', textAlign: 'center', marginTop: 100 }}>Camera permission required</Text></View>;
  }

  const now = new Date();
  const isClockIn = status === 'clock_in';

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="front">
        <View style={styles.topOverlay}>
          <View style={[styles.statusBadge, { backgroundColor: isClockIn ? 'rgba(74,222,128,0.9)' : 'rgba(248,113,113,0.9)' }]}>
            <Text style={styles.statusBadgeText}>{isClockIn ? 'CLOCK IN' : 'CLOCK OUT'}</Text>
          </View>
        </View>

        <View style={styles.infoOverlay}>
          <Text style={styles.timeDisplay}>
            {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}
          </Text>
          <Text style={styles.dateDisplay}>
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </Text>
          {location && (
            <View style={styles.locationPill}>
              <Text style={styles.locationText}>
                {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
              </Text>
            </View>
          )}
          {locationError && (
            <TouchableOpacity onPress={fetchLocation} style={styles.locationPill}>
              <Text style={styles.locationError}>{locationError}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.captureArea}>
          <TouchableOpacity
            style={[styles.captureButton, loading && { opacity: 0.4 }]}
            onPress={takePicture}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="large" color="#fff" />
            ) : (
              <View style={styles.captureInner} />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} disabled={loading} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  topOverlay: { paddingTop: 56, paddingHorizontal: 20, alignItems: 'center' },
  statusBadge: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20 },
  statusBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  infoOverlay: { flex: 1, justifyContent: 'flex-end', paddingBottom: 160, alignItems: 'center' },
  timeDisplay: { color: '#fff', fontSize: 44, fontWeight: '200', letterSpacing: 2 },
  dateDisplay: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 4, fontWeight: '400' },
  locationPill: {
    marginTop: 12, backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
  },
  locationText: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: 'monospace' },
  locationError: { color: '#fbbf24', fontSize: 12 },
  captureArea: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' },
  captureButton: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#fff',
  },
  captureInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  cancelBtn: { marginTop: 20 },
  cancelText: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '500' },
});
