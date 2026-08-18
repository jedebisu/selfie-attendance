import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { attendanceAPI, SERVER_URL } from '../services/api';
import { format } from 'date-fns';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom marker icons
const clockInIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const clockOutIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const MapView = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const res = await attendanceAPI.getAll({ date, limit: 100 });
      const data = res.data || {};
      const recordsWithLocation = (data.records || []).filter(r => r.latitude && r.longitude);
      setRecords(recordsWithLocation);
    } catch (error) {
      console.error('Error fetching records:', error);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Calculate center of map
  const getCenter = () => {
    if (records.length === 0) {
      return [14.5995, 120.9842]; // Default: Manila
    }
    
    const lats = records.map(r => parseFloat(r.latitude));
    const lngs = records.map(r => parseFloat(r.longitude));
    
    return [
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lngs) + Math.max(...lngs)) / 2
    ];
  };

  return (
    <div className="map-page">
      <div className="page-header">
        <div>
          <h1>Map View</h1>
          <p className="subtitle">Attendance locations</p>
        </div>
        <div className="filter-group">
          <label>Date:</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
      </div>

      <div className="card map-card">
        {loading ? (
          <div className="loading">Loading map...</div>
        ) : (
          <>
            <div className="map-stats">
              <span>{records.length} attendance records with location</span>
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
              {records.map((record) => (
                <Marker
                  key={record.id}
                  position={[parseFloat(record.latitude), parseFloat(record.longitude)]}
                  icon={record.status === 'clock_in' ? clockInIcon : clockOutIcon}
                >
                  <Popup>
                    <div className="map-popup">
                      <img 
                        src={`${SERVER_URL}${record.photo_url}`} 
                        alt=""
                        className="popup-photo"
                      />
                      <h4>{record.user_name}</h4>
                      <p><strong>{record.employee_id}</strong></p>
                      <p className={`popup-status ${record.status}`}>
                        {record.status === 'clock_in' ? 'Clock In' : 'Clock Out'}
                      </p>
                      <p>{format(new Date(record.timestamp), 'hh:mm a')}</p>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </>
        )}
      </div>
    </div>
  );
};

export default MapView;
