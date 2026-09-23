const decodePolyline = (str) => {
  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = str.length;

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLat = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dLng = (result & 1) !== 0 ? ~(result >> 1) : (result >> 1);
    lng += dLng;

    coords.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return coords;
};

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/foot';

const fetchRoute = async (origin, destination) => {
  const url =
    `${OSRM_BASE}/${origin.longitude},${origin.latitude};` +
    `${destination.longitude},${destination.latitude}` +
    '?overview=full&geometries=polyline';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }
    const route = data.routes[0];
    return {
      points: decodePolyline(route.geometry),
      distanceKm: route.distance / 1000,
    };
  } finally {
    clearTimeout(timer);
  }
};

export { fetchRoute, decodePolyline };