import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { locationAPI } from './api';

const TRACKING_TASK = 'selfie-attendance-location-tracking';
const PINGS_QUEUE_KEY = 'location_pings_queue';
const TRACKING_DIAG_KEY = 'location_tracking_diagnostics';
const MAX_QUEUE_SIZE = 1000;
const BATCH_SIZE = 200;

const setDiag = async (patch) => {
  try {
    const current = JSON.parse((await AsyncStorage.getItem(TRACKING_DIAG_KEY)) || '{}');
    await AsyncStorage.setItem(TRACKING_DIAG_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (e) {}
};

TaskManager.defineTask(TRACKING_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = data?.locations;
  if (!locations || locations.length === 0) return;

  const pings = locations.map((loc) => ({
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy_m: loc.coords.accuracy ?? null,
    speed_mps: loc.coords.speed ?? null,
    pinged_at: new Date(loc.timestamp || Date.now()).toISOString(),
  }));

  try {
    const existing = JSON.parse((await AsyncStorage.getItem(PINGS_QUEUE_KEY)) || '[]');
    const merged = [...existing, ...pings].slice(-MAX_QUEUE_SIZE);
    await AsyncStorage.setItem(PINGS_QUEUE_KEY, JSON.stringify(merged));
  } catch (e) {
    return;
  }

  flushPings().catch(() => {});
});

const readQueue = async () => {
  try {
    const raw = await AsyncStorage.getItem(PINGS_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

const writeQueue = async (pings) => {
  await AsyncStorage.setItem(PINGS_QUEUE_KEY, JSON.stringify(pings));
};

export const flushPings = async () => {
  const queue = await readQueue();
  if (queue.length === 0) {
    return { flushed: 0 };
  }

  const batch = queue.slice(0, BATCH_SIZE);
  let response;
  try {
    response = await locationAPI.sendPings(batch);
  } catch (error) {
    await setDiag({
      lastFlushAt: new Date().toISOString(),
      lastFlushError: error.response?.data?.error || error.message,
      lastFlushStatus: error.response?.status || null,
    });
    throw error;
  }

  await setDiag({
    lastFlushAt: new Date().toISOString(),
    lastFlushError: null,
    lastUploaded: response?.stored ?? 0,
  });

  if (response && response.reason === 'not_clocked_in') {
    await writeQueue(queue.slice(batch.length));
    return { flushed: 0, reason: 'not_clocked_in' };
  }

  await writeQueue(queue.slice(batch.length));
  return { flushed: batch.length };
};

export const startLocationTracking = async () => {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted) {
      const request = await Location.requestForegroundPermissionsAsync();
      if (request.status !== 'granted') {
        return { success: false, reason: 'foreground_permission_denied' };
      }
    }

    const background = await Location.getBackgroundPermissionsAsync();
    if (!background.granted) {
      await new Promise((resolve) => {
        Alert.alert(
          'One more step',
          'On the next screen, please tap "Allow all the time".\n\nThis lets EBISU record your work route even when the app is closed, while you are clocked in.',
          [{ text: 'Continue', onPress: resolve }]
        );
      });
    }

    const backgroundRequest = await Location.requestBackgroundPermissionsAsync();
    if (backgroundRequest.status !== 'granted') {
      await setDiag({
        lastStartAt: new Date().toISOString(),
        lastStartError: 'background_permission_denied',
      });
      Alert.alert(
        'Location Permission Needed',
        'To track your work location while clocked in, set location permission to "Allow all the time".\n\nSettings > Apps > EBISU T&A > Permissions > Location',
        [{ text: 'Open Settings', onPress: () => Location.openSettings?.() }, { text: 'Not now' }]
      );
      return { success: false, reason: 'background_permission_denied' };
    }

    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
    if (alreadyRunning) {
      flushPings().catch(() => {});
      return { success: true, reason: 'already_running' };
    }

    await Location.startLocationUpdatesAsync(TRACKING_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 120000,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'EBISU T&A',
        notificationBody: 'Attendance sync active',
        notificationColor: '#007AFF',
        killServiceOnDestroy: false,
      },
      showsBackgroundLocationIndicator: false,
    });

    await setDiag({ lastStartAt: new Date().toISOString(), lastStartError: null });
    return { success: true };
  } catch (error) {
    await setDiag({
      lastStartAt: new Date().toISOString(),
      lastStartError: error.message || String(error),
    });
    return { success: false, reason: error.message };
  }
};

export const stopLocationTracking = async () => {
  try {
    await flushPings().catch(() => {});
    const running = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
    if (running) {
      await Location.stopLocationUpdatesAsync(TRACKING_TASK);
    }
    return { success: true };
  } catch (error) {
    return { success: false, reason: error.message };
  }
};

export const isTrackingActive = async () => {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
  } catch (e) {
    return false;
  }
};

export const getTrackingDiagnostics = async () => {
  const diag = JSON.parse((await AsyncStorage.getItem(TRACKING_DIAG_KEY)) || '{}');
  const queue = await readQueue();
  let fg = 'unknown';
  let bg = 'unknown';
  try {
    fg = (await Location.getForegroundPermissionsAsync()).granted ? 'granted' : 'denied';
    bg = (await Location.getBackgroundPermissionsAsync()).status;
  } catch (e) {}
  const active = await isTrackingActive();
  return {
    foregroundPermission: fg,
    backgroundPermission: bg,
    trackingStarted: active,
    queuedPings: queue.length,
    lastStartAt: diag.lastStartAt,
    lastStartError: diag.lastStartError,
    lastFlushAt: diag.lastFlushAt,
    lastFlushError: diag.lastFlushError,
    lastUploaded: diag.lastUploaded,
  };
};

export const syncTrackingWithShiftState = async (clockedIn) => {
  const running = await isTrackingActive();
  if (clockedIn && !running) {
    return startLocationTracking();
  }
  if (!clockedIn && running) {
    return stopLocationTracking();
  }
  if (clockedIn && running) {
    flushPings().catch(() => {});
  }
  return { success: true };
};
