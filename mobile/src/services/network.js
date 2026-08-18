import NetInfo from '@react-native-community/netinfo';

let isConnected = true;
let listeners = [];

const getNetworkState = async () => {
  const state = await NetInfo.fetch();
  isConnected = state.isConnected && state.isInternetReachable !== false;
  return isConnected;
};

const addListener = (callback) => {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter(l => l !== callback);
  };
};

NetInfo.addEventListener(state => {
  const wasConnected = isConnected;
  isConnected = state.isConnected && state.isInternetReachable !== false;
  
  if (wasConnected !== isConnected) {
    listeners.forEach(cb => cb(isConnected));
  }
});

const checkConnection = async () => {
  const state = await NetInfo.fetch();
  isConnected = state.isConnected && state.isInternetReachable !== false;
  return isConnected;
};

export { getNetworkState, addListener, checkConnection, isConnected };
export default { getNetworkState, addListener, checkConnection, isConnected };
