import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { locationAPI } from './api';

const TRACKING_TASK = 'selfie-attendance-location-tracking';
const PINGS_QUEUE_KEY = 'location_pings_queue';
const MAX_QUEUE_SIZE = 1000;
const BATCH_SIZE = 200;

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
  const response = await locationAPI.sendPings(batch);

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

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== 'granted') {
      return { success: false, reason: 'background_permission_denied' };
    }

    const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK);
    if (alreadyRunning) {
      flushPings().catch(() => {});
      return { success: true, reason: 'already_running' };
    }

    await Location.startLocationUpdatesAsync(TRACKING_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50,
      deferredUpdatesInterval: 120000,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'EBISU T&A tracking active',
        notificationBody: 'Your location is recorded while you are clocked in.',
        notificationColor: '#007AFF',
        killServiceOnDestroy: false,
      },
      showsBackgroundLocationIndicator: true,
    });

    return { success: true };
  } catch (error) {
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
