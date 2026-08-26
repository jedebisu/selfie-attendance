import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { locationAPI } from '../services/api';
import { format, parse } from 'date-fns';
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

const batteryIcon = (pct) => {
  const color = pct <= 15 ? '#ef4444' : pct <= 30 ? '#f59e0b' : '#22c55e';
  return new L.DivIcon({
    className: '',
    html: `<div style="position:absolute;top:-6px;right:-6px;background:${color};color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);">⚡</div>`,
    iconSize: [0, 0],
  });
};

const playbackIcon = new L.DivIcon({
  className: '',
  html: `<div style="width:16px;height:16px;background:#7c3aed;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
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

const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const speedColor = (speedKmh) => {
  if (speedKmh < 5) return '#22c55e';
  if (speedKmh < 20) return '#f59e0b';
  return '#ef4444';
};

const speedLabel = (speedKmh) => {
  if (speedKmh < 5) return 'Walking';
  if (speedKmh < 20) return 'Vehicle';
  return 'Fast';
};

const formatDistance = (km) => {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(2)} km`;
};

const toGpx = (pings, events, userName) => {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Selfie Attendance"',
    '  xmlns="http://www.topografix.com/GPX/1/1"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
    `  <metadata><name>${userName} - Trail</name></metadata>`,
    '  <trk>',
    `    <name>${userName}</name>`,
    '    <trkseg>',
  ];
  for (const p of pings) {
    lines.push(`      <trkpt lat="${p.latitude}" lon="${p.longitude}"><time>${p.pinged_at}</time></trkpt>`);
  }
  lines.push('    </trkseg>');
  lines.push('  </trk>');
  for (const e of events) {
    const sym = e.status === 'clock_in' ? 'Flag, Green' : 'Flag, Red';
    lines.push(
      `  <wpt lat="${e.latitude}" lon="${e.longitude}"><time>${e.timestamp}</time><name>${e.status}</name><sym>${sym}</sym></wpt>`
    );
  }
  lines.push('</gpx>');
  return lines.join('\n');
};

const MapRef = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, map.getZoom());
  }, [center, map]);
  return null;
};

const LiveMap = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [trail, setTrail] = useState(null);
  const [trailLoadingId, setTrailLoadingId] = useState(null);
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [showSpeed, setShowSpeed] = useState(true);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [playbackPlaying, setPlaybackPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const playbackRef = useRef(null);
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
    setPlaybackIndex(-1);
    setPlaybackPlaying(false);
    setTimeFrom('');
    setTimeTo('');
    try {
      const res = await locationAPI.getTrail(userId, today);
      setTrail(res.data);
    } catch (error) {
      console.error('Error fetching trail:', error);
    } finally {
      setTrailLoadingId(null);
    }
  };

  const clearTrail = () => {
    setTrail(null);
    setPlaybackIndex(-1);
    setPlaybackPlaying(false);
    setTimeFrom('');
    setTimeTo('');
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

  const allPings = useMemo(() => {
    return (trail?.pings || []).filter((p) => {
      const lat = parseFloat(p.latitude);
      const lng = parseFloat(p.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng);
    });
  }, [trail]);

  const trailPings = useMemo(() => {
    return allPings.filter((p) => {
      if (!timeFrom && !timeTo) return true;
      const t = new Date(p.pinged_at);
      if (timeFrom) {
        const from = parse(timeFrom, 'HH:mm', new Date());
        if (t.getHours() < from.getHours() || (t.getHours() === from.getHours() && t.getMinutes() < from.getMinutes())) return false;
      }
      if (timeTo) {
        const to = parse(timeTo, 'HH:mm', new Date());
        if (t.getHours() > to.getHours() || (t.getHours() === to.getHours() && t.getMinutes() > to.getMinutes())) return false;
      }
      return true;
    }).map((p) => ({
      position: [parseFloat(p.latitude), parseFloat(p.longitude)],
      time: p.pinged_at,
      accuracy: p.accuracy_m,
      battery: p.battery_pct,
    }));
  }, [allPings, timeFrom, timeTo]);

  const trailEvents = useMemo(() => {
    return (trail?.events || [])
      .filter((e) => {
        const lat = parseFloat(e.latitude);
        const lng = parseFloat(e.longitude);
        return Number.isFinite(lat) && Number.isFinite(lng);
      })
      .map((e) => ({
        position: [parseFloat(e.latitude), parseFloat(e.longitude)],
        time: e.timestamp,
        status: e.status,
        hasPhoto: !!e.photo_url,
      }));
  }, [trail]);

  const trailPoints = trailPings.map((p) => p.position);

  const trailStats = useMemo(() => {
    if (trailPings.length < 2) return { totalKm: 0, segments: [] };
    let totalKm = 0;
    const segments = [];
    for (let i = 1; i < trailPings.length; i++) {
      const prev = trailPings[i - 1];
      const curr = trailPings[i];
      const dist = haversine(prev.position[0], prev.position[1], curr.position[0], curr.position[1]);
      totalKm += dist;
      const timeDiff = (new Date(curr.time) - new Date(prev.time)) / 3600000;
      const speedKmh = timeDiff > 0 ? dist / timeDiff : 0;
      segments.push({ from: prev.position, to: curr.position, dist, speedKmh });
    }
    return { totalKm, segments };
  }, [trailPings]);

  const trailEmployees = useMemo(() => {
    if (!trail) return null;
    return users.find((u) => u.user_id === trail.user_id);
  }, [trail, users]);

  const noSignalUsers = users.filter((u) => !positionOf(u));

  const playbackPosition = playbackIndex >= 0 && playbackIndex < trailPings.length
    ? trailPings[playbackIndex].position
    : null;

  useEffect(() => {
    if (playbackPlaying && trailPings.length > 0) {
      playbackRef.current = setInterval(() => {
        setPlaybackIndex((prev) => {
          if (prev >= trailPings.length - 1) {
            setPlaybackPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1000 / playbackSpeed);
      return () => clearInterval(playbackRef.current);
    }
    return () => clearInterval(playbackRef.current);
  }, [playbackPlaying, playbackSpeed, trailPings.length]);

  const handleExportGpx = () => {
    if (!trail || trailPings.length === 0) return;
    const name = trailEmployees?.name || 'Employee';
    const gpx = toGpx(allPings, trailEvents, name);
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trail-${name.replace(/\s+/g, '-')}-${today}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const batteryWarnings = users.filter((u) => u.latest?.battery_pct != null && u.latest.battery_pct <= 20);

  return (
    <div className="map-page">
      <div className="page-header">
        <div>
          <h1>Live Tracking</h1>
          <p className="subtitle">Real-time GPS of clocked-in employees</p>
        </div>
        {trail && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleExportGpx} style={headerBtnStyle} title="Export trail as GPX">
              📥 GPX
            </button>
            <button onClick={clearTrail} style={headerBtnStyle}>
              Clear Trail
            </button>
          </div>
        )}
      </div>

      {batteryWarnings.length > 0 && (
        <div style={{
          padding: '8px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca',
          fontSize: 13, color: '#dc2626', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          ⚠️ Low battery: {batteryWarnings.map((u) => `${u.name} (${u.latest.battery_pct}%)`).join(', ')}
        </div>
      )}

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
              {trail && trailStats.totalKm > 0 && (
                <span> | Trail: {formatDistance(trailStats.totalKm)}</span>
              )}
            </div>

            {trail && (
              <div style={{
                padding: '8px 20px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb',
                display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', fontSize: 13,
              }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  From:
                  <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)}
                    style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12 }} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  To:
                  <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)}
                    style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 12 }} />
                </label>
                {(timeFrom || timeTo) && (
                  <button onClick={() => { setTimeFrom(''); setTimeTo(''); }}
                    style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }}>
                    Reset
                  </button>
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                  <input type="checkbox" checked={showSpeed} onChange={(e) => setShowSpeed(e.target.checked)} />
                  Speed colors
                </label>
              </div>
            )}

            <MapContainer
              center={getCenter()}
              zoom={13}
              style={{ height: 'calc(100vh - 320px)', width: '100%' }}
            >
              <MapRef center={playbackPosition || undefined} />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {trailPoints.length >= 2 && showSpeed && trailStats.segments.map((seg, i) => (
                <Polyline
                  key={`speed-seg-${i}`}
                  positions={[seg.from, seg.to]}
                  pathOptions={{ color: speedColor(seg.speedKmh), weight: 4 }}
                >
                  <Tooltip direction="top" offset={[0, -4]}>
                    <span style={{ fontSize: 11 }}>
                      {formatDistance(seg.dist)} - {speedLabel(seg.speedKmh)} ({seg.speedKmh.toFixed(1)} km/h)
                    </span>
                  </Tooltip>
                </Polyline>
              ))}

              {trailPoints.length >= 2 && !showSpeed && (
                <Polyline positions={trailPoints} pathOptions={{ color: '#3b82f6', weight: 4 }} />
              )}

              {trailPings.map((ping, i) => (
                <CircleMarker
                  key={`trail-ping-${i}`}
                  center={ping.position}
                  radius={4}
                  pathOptions={{
                    color: playbackIndex === i ? '#7c3aed' : '#3b82f6',
                    fillColor: playbackIndex === i ? '#a78bfa' : '#93c5fd',
                    fillOpacity: 0.8,
                    weight: playbackIndex === i ? 3 : 1,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -6]} permanent={false}>
                    <span style={{ fontWeight: 600, fontSize: 11 }}>
                      {format(new Date(ping.time), 'hh:mm a')}
                      {ping.battery != null && ` · ${ping.battery}%`}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}

              {trailEvents.map((evt, i) => (
                <CircleMarker
                  key={`trail-event-${i}`}
                  center={evt.position}
                  radius={7}
                  pathOptions={{
                    color: evt.status === 'clock_in' ? '#16a34a' : '#ea580c',
                    fillColor: evt.status === 'clock_in' ? '#22c55e' : '#f97316',
                    fillOpacity: 0.9,
                    weight: 2,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -8]} permanent>
                    <span style={{ fontWeight: 700, fontSize: 11 }}>
                      {evt.status === 'clock_in' ? '🟢' : '🟠'} {format(new Date(evt.time), 'hh:mm a')}
                    </span>
                  </Tooltip>
                </CircleMarker>
              ))}

              {playbackPosition && (
                <Marker position={playbackPosition} icon={playbackIcon}>
                  <Popup>
                    <div style={{ fontSize: 12 }}>
                      <strong>Playback</strong><br />
                      {playbackIndex + 1} / {trailPings.length}<br />
                      {format(new Date(trailPings[playbackIndex].time), 'hh:mm:ss a')}
                    </div>
                  </Popup>
                </Marker>
              )}

              {users.map((user) => {
                const position = positionOf(user);
                if (!position) return null;
                const lowBattery = user.latest?.battery_pct != null && user.latest.battery_pct <= 20;
                return (
                  <Marker
                    key={user.user_id}
                    position={position}
                    icon={lowBattery ? batteryIcon(user.latest.battery_pct) : markerIcon(freshnessColor(user.latest?.pinged_at))}
                  >
                    <Popup>
                      <div className="map-popup">
                        <h4>{user.name}</h4>
                        <p><strong>{user.employee_id}</strong></p>
                        <p>Clocked in: {format(new Date(user.clock_in_time), 'hh:mm a')}</p>
                        {user.latest ? (
                          <>
                            <p>Last seen: {format(new Date(user.latest.pinged_at), 'hh:mm a')}</p>
                            {user.latest.battery_pct != null && (
                              <p style={{ color: user.latest.battery_pct <= 20 ? '#ef4444' : undefined, fontWeight: user.latest.battery_pct <= 20 ? 700 : 400 }}>
                                Battery: {user.latest.battery_pct}% {user.latest.battery_pct <= 20 ? '⚠️' : ''}
                              </p>
                            )}
                          </>
                        ) : (
                          <p>No GPS signal yet</p>
                        )}
                        <button
                          onClick={() => showTrail(user.user_id)}
                          disabled={trailLoadingId === user.user_id}
                          style={trailBtnStyle}
                        >
                          {trailLoadingId === user.user_id ? 'Loading...' : "Show Today's Trail"}
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>

            {trail && trailPings.length > 0 && (
              <div style={{
                padding: '8px 20px', background: '#f5f3ff', borderBottom: '1px solid #e5e7eb',
                display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
              }}>
                <button
                  onClick={() => {
                    if (playbackPlaying) {
                      setPlaybackPlaying(false);
                    } else {
                      if (playbackIndex >= trailPings.length - 1) setPlaybackIndex(0);
                      setPlaybackPlaying(true);
                    }
                  }}
                  style={{ ...trailBtnStyle, background: playbackPlaying ? '#dc2626' : '#7c3aed' }}
                >
                  {playbackPlaying ? '⏸ Pause' : playbackIndex >= 0 ? '▶ Resume' : '▶ Play'}
                </button>
                {playbackIndex >= 0 && (
                  <button onClick={() => { setPlaybackIndex(0); setPlaybackPlaying(false); }}
                    style={{ ...trailBtnStyle, background: '#6b7280' }}>
                    ⏮ Reset
                  </button>
                )}
                <input
                  type="range" min="0.5" max="4" step="0.5" value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  style={{ width: 80 }}
                />
                <span style={{ fontSize: 12, color: '#6b7280' }}>{playbackSpeed}x</span>
                {playbackIndex >= 0 && (
                  <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>
                    {playbackIndex + 1}/{trailPings.length} · {format(new Date(trailPings[playbackIndex].time), 'hh:mm:ss a')}
                  </span>
                )}
              </div>
            )}

            <div className="map-stats" style={{ paddingTop: 8 }}>
              <span>Marker colors: green = seen &lt; 6 min ago, orange = &lt; 16 min, red = stale, grey = no GPS yet</span>
              {showSpeed && trail && (
                <span> | Trail colors: <span style={{ color: '#22c55e' }}>green = walking</span>, <span style={{ color: '#f59e0b' }}>orange = vehicle</span>, <span style={{ color: '#ef4444' }}>red = fast</span></span>
              )}
            </div>

            {noSignalUsers.length > 0 && (
              <div style={{
                padding: '10px 16px', borderTop: '1px solid #e5e7eb', fontSize: 13, color: '#6b7280',
              }}>
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

const headerBtnStyle = {
  padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb',
  background: '#fff', cursor: 'pointer', fontSize: 13,
};

const trailBtnStyle = {
  marginTop: 8, padding: '6px 12px', borderRadius: 6, border: 'none',
  background: '#c8956c', color: '#fff', cursor: 'pointer', fontSize: 13,
};

export default LiveMap;
