import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';
import { addToQueue } from '../services/offlineQueue';
import { checkConnection } from '../services/network';
import { cacheTodaySummary } from '../services/cache';

const CameraScreen = ({ navigation, route }) => {
  const { user } = useAuth();
  const { status } = route.params;
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus === 'granted') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        } catch (err) {
          setLocationError('Location unavailable');
        }
      } else {
        setLocationError('Location permission denied');
      }
    })();
  }, []);

  const handleCapture = async () => {
    if (loading || !cameraRef.current) return;
    setLoading(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });

      const dir = FileSystem.documentDirectory + 'offline_photos/';
      const dirInfo = await FileSystem.getInfoAsync(dir);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      }
      const filename = `selfie_${Date.now()}.jpg`;
      const localPath = dir + filename;
      await FileSystem.copyAsync({ from: photo.uri, to: localPath });

      const isConnected = await checkConnection();

      if (!isConnected) {
        await addToQueue({
          userId: user.id,
          status: status,
          timestamp: new Date().toISOString(),
          latitude: location?.latitude,
          longitude: location?.longitude,
          photoPath: localPath,
        });

        Alert.alert(
          'Saved Offline',
          `Your ${status === 'clock_in' ? 'clock-in' : 'clock-out'} has been saved. It will sync when you're back online.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
        return;
      }

      const formData = new FormData();
      formData.append('photo', {
        uri: localPath,
        type: 'image/jpeg',
        name: 'selfie.jpg',
      });
      formData.append('user_id', user.id);
      formData.append('status', status);
      formData.append('timestamp', new Date().toISOString());

      if (location) {
        formData.append('latitude', location.latitude);
        formData.append('longitude', location.longitude);
      }

      const result = await attendanceAPI.submit(formData);

      try {
        await cacheTodaySummary(result.attendance);
      } catch (e) {}

      try {
        await FileSystem.deleteAsync(localPath, { idempotent: true });
      } catch (e) {}

      Alert.alert(
        'Success!',
        `Successfully ${status === 'clock_in' ? 'clocked in' : 'clocked out'}`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (error) {
      const errorMsg = error.response?.data?.error || error.message || 'Failed to submit';

      if (errorMsg.includes('No internet') || errorMsg.includes('Network Error')) {
        const dir = FileSystem.documentDirectory + 'offline_photos/';
        const dirInfo = await FileSystem.getInfoAsync(dir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        }
        const filename = `selfie_${Date.now()}.jpg`;
        const localPath = dir + filename;

        const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
        await FileSystem.copyAsync({ from: photo.uri, to: localPath });

        await addToQueue({
          userId: user.id,
          status: status,
          timestamp: new Date().toISOString(),
          latitude: location?.latitude,
          longitude: location?.longitude,
          photoPath: localPath,
        });

        Alert.alert(
          'Saved Offline',
          `Your ${status === 'clock_in' ? 'clock-in' : 'clock-out'} has been saved. It will sync when you're back online.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert('Error', errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRetryLocation = async () => {
    setLocationError(null);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    } catch (err) {
      setLocationError('Location unavailable');
    }
  };

  if (!cameraPermission) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#c8956c" /></View>;
  }

  if (!cameraPermission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Camera permission is required</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="front">
        <View style={styles.overlay}>
          <View style={styles.header}>
            <Text style={styles.statusText}>
              {status === 'clock_in' ? '📷 Clock In' : '📷 Clock Out'}
            </Text>
          </View>

          {locationError && (
            <TouchableOpacity style={styles.locationRetry} onPress={handleRetryLocation}>
              <Text style={styles.locationRetryText}>📍 {locationError} (Tap to retry)</Text>
            </TouchableOpacity>
          )}

          {location && !locationError && (
            <View style={styles.locationBadge}>
              <Text style={styles.locationText}>📍 Location acquired</Text>
            </View>
          )}

          <View style={styles.bottomControls}>
            <TouchableOpacity
              style={[styles.captureButton, loading && styles.captureButtonDisabled]}
              onPress={handleCapture}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="large" color="#fff" />
              ) : (
                <View style={styles.captureButtonInner} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    flex: 1,
    width: '100%',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    paddingTop: 40,
  },
  statusText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  locationBadge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  locationText: {
    color: '#fff',
    fontSize: 12,
  },
  locationRetry: {
    alignSelf: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  locationRetryText: {
    color: '#fff',
    fontSize: 12,
  },
  bottomControls: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  captureButtonDisabled: {
    opacity: 0.5,
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
  },
  errorText: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#c8956c',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default CameraScreen;
