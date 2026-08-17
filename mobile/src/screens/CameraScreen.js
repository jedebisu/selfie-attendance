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

  useEffect(() => {
    (async () => {
      const camStatus = await requestCameraPermission();
      if (!camStatus.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed.', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      }
      const locStatus = await Location.requestForegroundPermissionsAsync();
      if (locStatus.status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      } else {
        setLocationError('Location permission denied');
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
      Alert.alert('Error', 'Failed to submit. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!cameraPermission?.granted) {
    return <View style={styles.container}><Text style={{ color: '#fff', textAlign: 'center', marginTop: 100 }}>Camera permission required</Text></View>;
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="front">
        <View style={styles.topBar}>
          <Text style={styles.statusText}>{status === 'clock_in' ? '📍 CLOCK IN' : '📍 CLOCK OUT'}</Text>
        </View>
        <View style={styles.bottomBar}>
          <Text style={styles.timeText}>{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}</Text>
          <Text style={styles.dateText}>{new Date().toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</Text>
          {location && <Text style={styles.locationText}>📍 {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</Text>}
          {locationError && <Text style={styles.locationError}>⚠️ {locationError}</Text>}
        </View>
        <View style={styles.captureContainer}>
          <TouchableOpacity style={[styles.captureButton, loading && { opacity: 0.5 }]} onPress={takePicture} disabled={loading}>
            {loading ? <ActivityIndicator size="large" color="#fff" /> : <View style={styles.captureInner} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.goBack()} disabled={loading}>
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
  topBar: { backgroundColor: 'rgba(0,0,0,0.6)', padding: 20, paddingTop: 50, alignItems: 'center' },
  statusText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  bottomBar: { backgroundColor: 'rgba(0,0,0,0.6)', padding: 20, paddingBottom: 120, alignItems: 'center' },
  timeText: { color: '#4CAF50', fontSize: 32, fontWeight: 'bold' },
  dateText: { color: '#fff', fontSize: 16, marginTop: 5 },
  locationText: { color: '#fff', fontSize: 14, marginTop: 10 },
  locationError: { color: '#FFD700', fontSize: 14, marginTop: 10 },
  captureContainer: { position: 'absolute', bottom: 30, left: 0, right: 0, alignItems: 'center' },
  captureButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center', borderWidth: 4, borderColor: '#fff' },
  captureInner: { width: 65, height: 65, borderRadius: 32.5, backgroundColor: '#fff' },
  cancelText: { color: '#fff', fontSize: 16, marginTop: 20 },
});
