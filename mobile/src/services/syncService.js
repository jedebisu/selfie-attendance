import { getQueue, removeFromQueue, incrementRetry } from './offlineQueue';
import { checkConnection } from './network';
import { attendanceAPI } from './api';
import * as FileSystem from 'expo-file-system';
import { cacheTodaySummary } from './cache';

let isSyncing = false;
let syncListeners = [];

const addSyncListener = (callback) => {
  syncListeners.push(callback);
  return () => {
    syncListeners = syncListeners.filter(l => l !== callback);
  };
};

const notifyListeners = (status, count) => {
  syncListeners.forEach(cb => cb(status, count));
};

const processQueue = async () => {
  if (isSyncing) return;
  
  const isConnected = await checkConnection();
  if (!isConnected) return;
  
  isSyncing = true;
  let processedCount = 0;
  
  try {
    const queue = await getQueue();
    
    for (const entry of queue) {
      try {
        const isConnectedNow = await checkConnection();
        if (!isConnectedNow) break;
        
        const photoInfo = await FileSystem.getInfoAsync(entry.photoPath);
        if (!photoInfo.exists) {
          await removeFromQueue(entry.localId);
          continue;
        }
        
        const formData = new FormData();
        formData.append('photo', {
          uri: entry.photoPath,
          type: 'image/jpeg',
          name: 'selfie.jpg'
        });
        formData.append('user_id', entry.userId);
        formData.append('status', entry.status);
        
        if (entry.latitude && entry.longitude) {
          formData.append('latitude', entry.latitude);
          formData.append('longitude', entry.longitude);
        }
        
        await attendanceAPI.submit(formData);
        
        await removeFromQueue(entry.localId);
        
        try {
          await FileSystem.deleteAsync(entry.photoPath, { idempotent: true });
        } catch (e) {
          console.warn('Failed to delete synced photo:', e.message);
        }
        
        processedCount++;
        
      } catch (error) {
        if (error.response?.status === 429 || error.response?.status === 400) {
          await removeFromQueue(entry.localId);
          continue;
        }
        
        await incrementRetry(entry.localId);
        
        if (entry.retryCount >= 3) {
          await removeFromQueue(entry.localId);
        }
        
        break;
      }
    }
    
    if (processedCount > 0) {
      notifyListeners('completed', processedCount);
    }
    
  } catch (error) {
    console.error('Sync error:', error);
    notifyListeners('error', 0);
  } finally {
    isSyncing = false;
  }
};

const startSyncOnConnect = () => {
  const { addListener } = require('./network');
  return addListener(async (isConnected) => {
    if (isConnected) {
      await processQueue();
    }
  });
};

const syncOnStartup = async () => {
  setTimeout(async () => {
    await processQueue();
  }, 2000);
};

export { processQueue, startSyncOnConnect, syncOnStartup, addSyncListener, isSyncing };
export default { processQueue, startSyncOnConnect, syncOnStartup, addSyncListener };
