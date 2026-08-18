import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const TODAY_SUMMARY_KEY = 'cached_today_summary';
const HISTORY_KEY = 'cached_history';
const CACHE_TIMESTAMP_KEY = 'cache_timestamp';

const isCacheValid = async () => {
  try {
    const timestamp = await AsyncStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!timestamp) return false;
    const age = Date.now() - parseInt(timestamp, 10);
    return age < CACHE_TTL;
  } catch (error) {
    return false;
  }
};

const updateCacheTimestamp = async () => {
  await AsyncStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
};

const cacheTodaySummary = async (summary) => {
  try {
    await AsyncStorage.setItem(TODAY_SUMMARY_KEY, JSON.stringify(summary));
    await updateCacheTimestamp();
  } catch (error) {
    console.error('Error caching today summary:', error);
  }
};

const getCachedTodaySummary = async () => {
  try {
    const data = await AsyncStorage.getItem(TODAY_SUMMARY_KEY);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    return null;
  }
};

const cacheHistory = async (records) => {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(records));
  } catch (error) {
    console.error('Error caching history:', error);
  }
};

const getCachedHistory = async () => {
  try {
    const data = await AsyncStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    return [];
  }
};

const clearCache = async () => {
  await AsyncStorage.removeItem(TODAY_SUMMARY_KEY);
  await AsyncStorage.removeItem(HISTORY_KEY);
  await AsyncStorage.removeItem(CACHE_TIMESTAMP_KEY);
};

export { cacheTodaySummary, getCachedTodaySummary, cacheHistory, getCachedHistory, isCacheValid, clearCache };
export default { cacheTodaySummary, getCachedTodaySummary, cacheHistory, getCachedHistory, isCacheValid, clearCache };
