const decodePolyline = (str, precision = 1e6) => {
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

    coords.push({ latitude: lat / precision, longitude: lng / precision });
  }

  return coords;
};

const VALHALLA_ENDPOINTS = [
  'https://valhalla1.openstreetmap.de/route',
  'https://valhalla2.openstreetmap.de/route',
];

const fetchRoute = async (origin, destination) => {
  const body = {
    locations: [
      { lon: origin.longitude, lat: origin.latitude },
      { lon: destination.longitude, lat: destination.latitude },
    ],
    costing: 'pedestrian',
    units: 'kilometers',
  };

  for (const url of VALHALLA_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const data = await response.json();
      if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) continue;
      const leg = data.trip.legs[0];
      return {
        points: decodePolyline(leg.shape, 1e6),
        distanceKm: data.trip.summary.length,
        durationSec: data.trip.summary.time,
      };
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('No route found');
};

export { fetchRoute, decodePolyline };