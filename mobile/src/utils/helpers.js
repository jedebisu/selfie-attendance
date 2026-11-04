export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

export const distanceMeters = (a, b) => {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
};

export const parseCoordinate = (lat, lng) => {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
};

export const parseCoordinateInput = (input) => {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  // Try decimal degrees: "10.3157, 123.8854" or "10.3157 123.8854"
  const decimalMatch = trimmed.match(/^(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)$/);
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1]);
    const lng = parseFloat(decimalMatch[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng, format: 'decimal' };
    }
  }

  // Try DMS: "10°18'56.5"N 123°53'07.4"E"
  const dmsLatMatch = trimmed.match(/(-?\d+)(?:°|\s*deg)?\s*(\d{1,2})['′]\s*(\d+(?:\.\d+)?)["″]?\s*([NnSs])/);
  const dmsLngMatch = trimmed.match(/(-?\d+)(?:°|\s*deg)?\s*(\d{1,2})['′]\s*(\d+(?:\.\d+)?)["″]?\s*([EeWw])/);
  if (dmsLatMatch && dmsLngMatch) {
    const lat = dmsToDecimal(dmsLatMatch[1], dmsLatMatch[2], dmsLatMatch[3], dmsLatMatch[4]);
    const lng = dmsToDecimal(dmsLngMatch[1], dmsLngMatch[2], dmsLngMatch[3], dmsLngMatch[4]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng, format: 'dms' };
    }
  }

  // Try DDMMSS compact: "101856N 1235307E"
  const compactMatch = trimmed.match(/(-?\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)\s*([NnSs])\s*(-?\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)\s*([EeWw])/);
  if (compactMatch) {
    const lat = compactToDecimal(compactMatch[1], compactMatch[2], compactMatch[3], compactMatch[4]);
    const lng = compactToDecimal(compactMatch[5], compactMatch[6], compactMatch[7], compactMatch[8]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { latitude: lat, longitude: lng, format: 'dms-compact' };
    }
  }

  return null;
};

const dmsToDecimal = (deg, min, sec, dir) => {
  const decimal = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec || 0) / 3600;
  return dir.toUpperCase() === 'S' || dir.toUpperCase() === 'W' ? -decimal : decimal;
};

const compactToDecimal = (deg, min, sec, dir) => {
  const decimal = parseFloat(deg) + parseFloat(min) / 60 + parseFloat(sec) / 3600;
  return dir.toUpperCase() === 'S' || dir.toUpperCase() === 'W' ? -decimal : decimal;
};

export const formatCoords = (lat, lng, dp = 6) => {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return 'N/A';
  return `${latNum.toFixed(dp)}, ${lngNum.toFixed(dp)}`;
};

export const NAP_STATUS_COLORS = {
  'In Service': '#22c55e',
  'Planned': '#3b82f6',
  'Defective': '#ef4444',
  'Installed': '#a855f7',
};

export const getNapStatusColor = (status) => NAP_STATUS_COLORS[status] || '#6b7280';

export const formatDateTime = (iso) => {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};
