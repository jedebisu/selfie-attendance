import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'pending_clock_entries';

const generateLocalId = () => {
  return `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const getQueue = async () => {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error reading queue:', error);
    return [];
  }
};

const saveQueue = async (queue) => {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error('Error saving queue:', error);
  }
};

const addToQueue = async (entry) => {
  const queue = await getQueue();
  const newEntry = {
    localId: generateLocalId(),
    userId: entry.userId,
    status: entry.status,
    timestamp: entry.timestamp,
    latitude: entry.latitude,
    longitude: entry.longitude,
    photoPath: entry.photoPath,
    retryCount: 0,
    createdAt: new Date().toISOString()
  };
  queue.push(newEntry);
  await saveQueue(queue);
  return newEntry.localId;
};

const removeFromQueue = async (localId) => {
  const queue = await getQueue();
  const filtered = queue.filter(item => item.localId !== localId);
  await saveQueue(filtered);
};

const incrementRetry = async (localId) => {
  const queue = await getQueue();
  const updated = queue.map(item => {
    if (item.localId === localId) {
      return { ...item, retryCount: item.retryCount + 1 };
    }
    return item;
  });
  await saveQueue(updated);
};

const getQueueLength = async () => {
  const queue = await getQueue();
  return queue.length;
};

const clearQueue = async () => {
  await saveQueue([]);
};

export { getQueue, addToQueue, removeFromQueue, incrementRetry, getQueueLength, clearQueue };
export default { getQueue, addToQueue, removeFromQueue, incrementRetry, getQueueLength, clearQueue };
