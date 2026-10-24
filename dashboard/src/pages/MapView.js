import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import { attendanceAPI } from '../services/api';
import AttendancePhoto from '../components/AttendancePhoto';
import { MapBridge, FitAll, MAP_TILES, pinIcon } from '../components/GMapKit';
import { format } from 'date-fns';
import 'leaflet/dist/leaflet.css';
import { X, Plus, Minus, Crosshair } from 'lucide-react';

const clockInPin = pinIcon('#22c55e');
const clockOutPin = pinIcon('#f97316');

const MapView = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selected, setSelected] = useState(null);
  const [focus, setFocus] = useState(null);
  const [fitToken, setFitToken] = useState(0);
  const mapRef = useRef(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await attendanceAPI.getAll({ date, limit: 100 });
      const data = res.data || {};
      const recordsWithLocation = (data.records || []).filter(r => r.latitude && r.longitude);
      setRecords(recordsWithLocation);
      setSelected(prev => (prev && recordsWithLocation.some(r => r.id === prev.id) ? prev : null));
    } catch (error) {
      console.error('Error fetching records:', error);
    } finally {
      setLoading(false);
      setFitToken(t => t + 1);
    }
  }, [date]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const points = useMemo(
    () => records.map(r => [parseFloat(r.latitude), parseFloat(r.longitude)]),
    [records]
  );

  const getCenter = () => {
    if (points.length === 0) return [14.5995, 120.9842]; // Default: Manila
    const lats = points.map(p => p[0]);
    const lngs = points.map(p => p[1]);
    return [
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lngs) + Math.max(...lngs)) / 2,
    ];
  };

  const openRecord = (record) => {
    setSelected(record);
    setFocus({ lat: parseFloat(record.latitude), lng: parseFloat(record.longitude) });
  };

  const closeSheet = () => {
    setSelected(null);
    setFocus(null);
  };

  return (
    <div className="gmap-shell">
      {loading ? (
        <div className="gmap-loading">Loading map…</div>
      ) : (
        <>
          <MapContainer
            center={getCenter()}
            zoom={13}
            zoomControl={false}
            className="gmap-canvas"
          >
            <TileLayer url={MAP_TILES.url} attribution={MAP_TILES.attribution} />
            <MapBridge mapRef={mapRef} focus={focus} />
            <FitAll points={points} trigger={fitToken} />

            {records.map((record) => (
              <Marker
                key={record.id}
                position={[parseFloat(record.latitude), parseFloat(record.longitude)]}
                icon={record.status === 'clock_in' ? clockInPin : clockOutPin}
                eventHandlers={{ click: () => openRecord(record) }}
              />
            ))}
          </MapContainer>

          <div className="gmap-card gmap-top">
            <div className="gmap-card-title">Map View</div>
            <div className="gmap-sub">{records.length} attendance record{records.length === 1 ? '' : 's'} with location</div>
            <input
              type="date"
              className="gmap-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="gmap-fab-group">
            <button className="gmap-fab" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus size={18} /></button>
            <button className="gmap-fab" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus size={18} /></button>
            <button className="gmap-fab" title="Fit all pins" onClick={() => setFitToken(t => t + 1)}><Crosshair size={16} /></button>
          </div>

          <div className="gmap-legend">
            <span><span className="gmap-dot" style={{ background: '#22c55e' }} />Clock In</span>
            <span><span className="gmap-dot" style={{ background: '#f97316' }} />Clock Out</span>
          </div>

          {selected && (
            <div className="gmap-sheet">
              <button className="gmap-sheet-close" onClick={closeSheet} aria-label="Close"><X size={16} /></button>
              <AttendancePhoto url={selected.photo_url} className="gmap-sheet-photo" alt={`${selected.user_name} attendance`} />
              <div className="gmap-sheet-body">
                <h4>{selected.user_name}</h4>
                <p className="gmap-muted">{selected.employee_id}</p>
                <div className="gmap-sheet-row">
                  <span className={`badge ${selected.status === 'clock_in' ? 'badge-green' : 'badge-orange'}`}>
                    {selected.status === 'clock_in' ? 'Clock In' : 'Clock Out'}
                  </span>
                  <span>{format(new Date(selected.timestamp), 'hh:mm a')}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default MapView;
