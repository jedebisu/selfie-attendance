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

export const parseCoordinate = (lat, lng) => {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
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
