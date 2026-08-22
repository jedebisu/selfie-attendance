import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import { locationAPI } from '../services/api';
import { format } from 'date-fns';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const markerIcon = (color) =>
  new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
  });

const REFRESH_MS = 20000;

const freshnessColor = (pingedAt) => {
  if (!pingedAt) return 'grey';
  const mins = (Date.now() - new Date(pingedAt).getTime()) / 60000;
  if (mins < 6) return 'green';
  if (mins < 16) return 'orange';
  return 'red';
};

const positionOf = (user) => {
  if (user.latest) {
    return [parseFloat(user.latest.latitude), parseFloat(user.latest.longitude)];
  }
  if (user.clock_in_location) {
    return [parseFloat(user.clock_in_location.latitude), parseFloat(user.clock_in_location.longitude)];
  }
  return null;
};

const LiveMap = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [trail, setTrail] = useState(null);
  const [trailLoadingId, setTrailLoadingId] = useState(null);
  const today = format(new Date(), 'yyyy-MM-dd');

  const fetchLive = useCallback(async () => {
    try {
      const res = await locationAPI.getLive();
      setUsers(res.data.users || []);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching live locations:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLive();
    const interval = setInterval(fetchLive, REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchLive]);

  const showTrail = async (userId) => {
    setTrailLoadingId(userId);
    try {
      const res = await locationAPI.getTrail(userId, today);
      setTrail(res.data);
    } catch (error) {
      console.error('Error fetching trail:', error);
    } finally {
      setTrailLoadingId(null);
    }
  };

  const getCenter = () => {
    const positions = users.map(positionOf).filter(Boolean);
    if (positions.length === 0) return [14.5995, 120.9842];
    const lats = positions.map((p) => p[0]);
    const lngs = positions.map((p) => p[1]);
    return [
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lngs) + Math.max(...lngs)) / 2,
    ];
  };

  const trailPoints = (trail?.pings || [])
    .map((p) => [parseFloat(p.latitude), parseFloat(p.longitude)])
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

  const noSignalUsers = users.filter((u) => !positionOf(u));

  return (
    <div className="map-page">
      <div className="page-header">
        <div>
          <h1>Live Tracking</h1>
          <p className="subtitle">Real-time GPS of clocked-in employees</p>
        </div>
        {trail && (
          <button
            onClick={() => setTrail(null)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #e5e7eb',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Clear Trail
          </button>
        )}
      </div>

      <div className="card map-card">
        {loading ? (
          <div className="loading">Loading live map...</div>
        ) : (
          <>
            <div className="map-stats">
              <span>
                {users.length} employee{users.length === 1 ? '' : 's'} currently clocked in
              </span>
              {lastUpdated && (
                <span> | Updated {format(lastUpdated, 'hh:mm:ss a')} (auto-refreshes every 20s)</span>
              )}
            </div>
            <MapContainer
              center={getCenter()}
              zoom={13}
              style={{ height: 'calc(100vh - 280px)', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {trailPoints.length >= 2 && (
                <Polyline positions={trailPoints} pathOptions={{ color: '#3b82f6', weight: 4 }} />
              )}
              {users.map((user) => {
                const position = positionOf(user);
                if (!position) return null;
                return (
                  <Marker
                    key={user.user_id}
                    position={position}
                    icon={markerIcon(freshnessColor(user.latest?.pinged_at))}
                  >
                    <Popup>
                      <div className="map-popup">
                        <h4>{user.name}</h4>
                        <p>
                          <strong>{user.employee_id}</strong>
                        </p>
                        <p>Clocked in: {format(new Date(user.clock_in_time), 'hh:mm a')}</p>
                        {user.latest ? (
                          <>
                            <p>Last seen: {format(new Date(user.latest.pinged_at), 'hh:mm a')}</p>
                            {user.latest.battery_pct != null && (
                              <p>Battery: {user.latest.battery_pct}%</p>
                            )}
                          </>
                        ) : (
                          <p>No GPS signal yet</p>
                        )}
                        <button
                          onClick={() => showTrail(user.user_id)}
                          disabled={trailLoadingId === user.user_id}
                          style={{
                            marginTop: 8,
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: 'none',
                            background: '#c8956c',
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          {trailLoadingId === user.user_id ? 'Loading...' : "Show Today's Trail"}
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
            <div className="map-stats" style={{ paddingTop: 8 }}>
              <span>Marker colors: green = seen &lt; 6 min ago, orange = &lt; 16 min, red = stale, grey = no GPS yet</span>
            </div>
            {noSignalUsers.length > 0 && (
              <div
                style={{
                  padding: '10px 16px',
                  borderTop: '1px solid #e5e7eb',
                  fontSize: 13,
                  color: '#6b7280',
                }}
              >
                <strong>No GPS signal yet ({noSignalUsers.length}):</strong>{' '}
                {noSignalUsers.map((u) => `${u.name} (${u.employee_id})`).join(', ')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default LiveMap;
