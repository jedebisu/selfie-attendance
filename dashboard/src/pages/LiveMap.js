import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { locationAPI } from '../services/api';
import { MapBridge, FitAll, MAP_TILES, pinIcon } from '../components/GMapKit';
import { format, parse } from 'date-fns';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { X, Plus, Minus, Crosshair, Download, Play, Pause, SkipBack } from 'lucide-react';

const REFRESH_MS = 20000;

const freshnessColor = (pingedAt) => {
  if (!pingedAt) return 'grey';
  const mins = (Date.now() - new Date(pingedAt).getTime()) / 60000;
  if (mins < 6) return 'green';
  if (mins < 16) return 'orange';
  return 'red';
};

const FRESHNESS_HEX = {
  green: '#22c55e',
  orange: '#f59e0b',
  red: '#ef4444',
  grey: '#9ca3af',
};

const markerIcon = (color) => pinIcon(FRESHNESS_HEX[color] || FRESHNESS_HEX.grey);

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
    '<gpx version="1.1" creator="EWMS — EBISU Workforce Management System"',
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

const MapApiBridge = ({ mapRef }) => {
  const map = useMap();
  useEffect(() => {
    if (mapRef) mapRef.current = map;
  }, [map, mapRef]);
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
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [fitToken, setFitToken] = useState(0);
  const [focus, setFocus] = useState(null);
  const playbackRef = useRef(null);
  const mapRef = useRef(null);
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
  const selectedUser = users.find((u) => u.user_id === selectedUserId) || null;
  const livePoints = users.map(positionOf).filter(Boolean);

  const openUser = (user) => {
    setSelectedUserId(user.user_id);
    const pos = positionOf(user);
    if (pos) setFocus({ lat: pos[0], lng: pos[1] });
  };

  const closeSheet = () => {
    setSelectedUserId(null);
    setFocus(null);
  };

  return (
    <div className="gmap-shell">
      {loading ? (
        <div className="gmap-loading">Loading live map…</div>
      ) : (
        <>
          <MapContainer
            center={getCenter()}
            zoom={13}
            zoomControl={false}
            className="gmap-canvas"
          >
            <TileLayer url={MAP_TILES.url} attribution={MAP_TILES.attribution} />
            <MapApiBridge mapRef={mapRef} />
            <MapBridge focus={focus} />
            <MapRef center={playbackPosition || undefined} />
            <FitAll points={livePoints} trigger={fitToken} />

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
              <Marker position={playbackPosition} icon={playbackIcon} />
            )}

            {users.map((user) => {
              const position = positionOf(user);
              if (!position) return null;
              const lowBattery = user.latest?.battery_pct != null && user.latest.battery_pct <= 20;
              return (
                <Marker
                  key={user.user_id}
                  position={position}
                  icon={lowBattery
                    ? batteryIcon(user.latest.battery_pct)
                    : markerIcon(freshnessColor(user.latest?.pinged_at))}
                  eventHandlers={{ click: () => openUser(user) }}
                />
              );
            })}
          </MapContainer>

          {/* ---- Floating panel: status + trail controls ---- */}
          <div className="gmap-card gmap-top">
            <div className="gmap-card-title">Live Tracking</div>
            <div className="gmap-sub">
              {users.length} employee{users.length === 1 ? '' : 's'} clocked in
              {lastUpdated && ` · Updated ${format(lastUpdated, 'hh:mm:ss a')} · auto 20s`}
              {trail && trailStats.totalKm > 0 && ` · Trail ${formatDistance(trailStats.totalKm)}`}
            </div>

            {batteryWarnings.length > 0 && (
              <div className="gmap-warning">⚠️ Low battery: {batteryWarnings.map((u) => `${u.name} (${u.latest.battery_pct}%)`).join(', ')}</div>
            )}

            {trail && (
              <>
                <div className="gmap-card-actions">
                  <button className="gmap-pill" onClick={handleExportGpx} title="Export trail as GPX"><Download size={13} /> GPX</button>
                  <button className="gmap-pill" onClick={clearTrail}>Clear Trail</button>
                </div>
                <div className="gmap-trail-filters">
                  <label>From <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} /></label>
                  <label>To <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} /></label>
                  {(timeFrom || timeTo) && (
                    <button className="gmap-pill" onClick={() => { setTimeFrom(''); setTimeTo(''); }}>Reset</button>
                  )}
                  <label className="gmap-check">
                    <input type="checkbox" checked={showSpeed} onChange={(e) => setShowSpeed(e.target.checked)} />
                    Speed colors
                  </label>
                </div>
              </>
            )}

            {noSignalUsers.length > 0 && (
              <div className="gmap-muted gmap-nosignal" title={noSignalUsers.map((u) => `${u.name} (${u.employee_id})`).join(', ')}>
                No GPS signal yet ({noSignalUsers.length}): {noSignalUsers.map((u) => u.name).join(', ')}
              </div>
            )}
          </div>

          {/* ---- Zoom / fit fabs ---- */}
          <div className="gmap-fab-group">
            <button className="gmap-fab" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus size={18} /></button>
            <button className="gmap-fab" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus size={18} /></button>
            <button className="gmap-fab" title="Fit all employees" onClick={() => setFitToken(t => t + 1)}><Crosshair size={16} /></button>
          </div>

          {/* ---- Legend ---- */}
          <div className="gmap-legend">
            <span><span className="gmap-dot" style={{ background: FRESHNESS_HEX.green }} />&lt;6 min ago</span>
            <span><span className="gmap-dot" style={{ background: FRESHNESS_HEX.orange }} />&lt;16 min</span>
            <span><span className="gmap-dot" style={{ background: FRESHNESS_HEX.red }} />Stale</span>
            {showSpeed && trail && (
              <>
                <span><span className="gmap-dot" style={{ background: '#22c55e' }} />Walking</span>
                <span><span className="gmap-dot" style={{ background: '#f59e0b' }} />Vehicle</span>
                <span><span className="gmap-dot" style={{ background: '#ef4444' }} />Fast</span>
              </>
            )}
          </div>

          {/* ---- Selected employee bottom card ---- */}
          {selectedUser && (
            <div className="gmap-sheet">
              <button className="gmap-sheet-close" onClick={closeSheet} aria-label="Close"><X size={16} /></button>
              <div className="gmap-sheet-body">
                <h4>{selectedUser.name}</h4>
                <p className="gmap-muted">{selectedUser.employee_id}</p>
                <div className="gmap-sheet-row">
                  <span>Clocked in {format(new Date(selectedUser.clock_in_time), 'hh:mm a')}</span>
                </div>
                {selectedUser.latest ? (
                  <div className="gmap-sheet-row">
                    <span>Last seen {format(new Date(selectedUser.latest.pinged_at), 'hh:mm a')}</span>
                    {selectedUser.latest.battery_pct != null && (
                      <span style={{ fontWeight: 700, color: selectedUser.latest.battery_pct <= 20 ? '#ef4444' : undefined }}>
                        🔋 {selectedUser.latest.battery_pct}%
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="gmap-muted">No GPS signal yet</div>
                )}
                <button
                  className="gmap-sheet-btn"
                  onClick={() => showTrail(selectedUser.user_id)}
                  disabled={trailLoadingId === selectedUser.user_id}
                >
                  {trailLoadingId === selectedUser.user_id ? 'Loading…' : "Show Today's Trail"}
                </button>
              </div>
            </div>
          )}

          {/* ---- Playback bar ---- */}
          {trail && trailPings.length > 0 && (
            <div className="gmap-bottom-panel">
              <button
                className="gmap-fab"
                style={{ width: 36, height: 36, background: playbackPlaying ? '#dc2626' : '#7c3aed', color: '#fff', border: 'none', borderRadius: '50%' }}
                onClick={() => {
                  if (playbackPlaying) {
                    setPlaybackPlaying(false);
                  } else {
                    if (playbackIndex >= trailPings.length - 1) setPlaybackIndex(0);
                    setPlaybackPlaying(true);
                  }
                }}
                title={playbackPlaying ? 'Pause' : 'Play'}
              >
                {playbackPlaying ? <Pause size={15} /> : <Play size={15} />}
              </button>
              {playbackIndex >= 0 && (
                <button className="gmap-fab"
                  style={{ width: 36, height: 36, background: '#6b7280', color: '#fff', border: 'none', borderRadius: '50%' }}
                  onClick={() => { setPlaybackIndex(0); setPlaybackPlaying(false); }}
                  title="Reset"
                >
                  <SkipBack size={14} />
                </button>
              )}
              <input
                type="range" min="0.5" max="4" step="0.5" value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                style={{ width: 90 }}
              />
              <span className="gmap-muted" style={{ fontSize: 12 }}>{playbackSpeed}x</span>
              {playbackIndex >= 0 && (
                <span className="gmap-muted" style={{ fontSize: 12 }}>
                  {playbackIndex + 1}/{trailPings.length} · {format(new Date(trailPings[playbackIndex].time), 'hh:mm:ss a')}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default LiveMap;
