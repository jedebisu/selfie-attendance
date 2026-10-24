import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * Shared Google-Maps-style kit for the dashboard Leaflet maps.
 * - MAP_TILES: CARTO Voyager basemap (free, no API key) — light style that
 *   reads like Google Maps instead of noisy default OSM.
 * - MapBridge: hands the map instance to a ref (for floating zoom buttons)
 *   and flies the camera to a focused point (e.g. clicked marker).
 * - FitAll: fits the whole dataset into view; re-fits when `trigger` changes.
 */

export const MAP_TILES = {
  // Standard OSM raster tiles — genuinely free, no API key needed.
  // (CARTO's hosted styles began requiring API keys, served a watermarked
  // "API KEY REQUIRED" placeholder when called without one.)
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

export function MapBridge({ mapRef, focus = null, focusZoom = 16 }) {
  const map = useMap();

  useEffect(() => {
    if (mapRef) mapRef.current = map;
  }, [map, mapRef]);

  useEffect(() => {
    if (!focus || focus.lat == null || focus.lng == null) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), focusZoom), { duration: 0.8 });
  }, [focus, map, focusZoom]);

  return null;
}

export function FitAll({ points, trigger = 0 }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 15 });
    }
    // points intentionally not a dep: refits only when triggered
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return null;
}

/** Google-pin style marker (teardrop dot, white ring). */
export const pinIcon = (color, size = 26) =>
  new L.DivIcon({
    className: '',
    html:
      `<div style="width:${size}px;height:${size + 6}px;position:relative;">` +
      `<div style="position:absolute;inset:0 auto auto 0;width:${size}px;height:${size}px;` +
      'border-radius:50% 50% 50% 0;transform:rotate(-45deg);' +
      `background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);"></div>` +
      '</div>',
    iconSize: [size, size + 6],
    iconAnchor: [size / 2, size + 6],
    popupAnchor: [0, -(size + 6)],
  });
