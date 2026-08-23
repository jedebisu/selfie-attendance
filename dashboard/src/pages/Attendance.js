import React, { useState, useEffect, useCallback } from 'react';
import { attendanceAPI, exportAPI, photoUrl } from '../services/api';
import { format } from 'date-fns';
import { Download, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';

const Attendance = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });
  const [filters, setFilters] = useState({
    start_date: format(new Date(), 'yyyy-MM-dd'),
    end_date: format(new Date(), 'yyyy-MM-dd'),
    status: '',
    user_id: ''
  });
  const [selectedRecord, setSelectedRecord] = useState(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...filters
      };
      
      // Remove empty filters
      Object.keys(params).forEach(key => {
        if (!params[key]) delete params[key];
      });

      const res = await attendanceAPI.getAll(params);
      const data = res.data || {};
      setRecords(data.records || []);
      setPagination(prev => ({ ...prev, total: data.pagination?.total || 0 }));
    } catch (error) {
      console.error('Error fetching records:', error);
      toast.error('Failed to load attendance records');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, filters]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const exportToCSV = async () => {
    try {
      const params = {};
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      if (filters.status) params.status = filters.status;
      if (filters.user_id) params.user_id = filters.user_id;
      const res = await exportAPI.attendance(params);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      const rangeLabel =
        filters.start_date && filters.end_date && filters.start_date !== filters.end_date
          ? `${filters.start_date}_to_${filters.end_date}`
          : filters.start_date || 'all';
      a.download = `attendance_${rangeLabel}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported successfully');
    } catch (error) {
      toast.error('Failed to export');
    }
  };

  const formatDateTime = (timestamp) => {
    return format(new Date(timestamp), 'MMM dd, yyyy hh:mm a');
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);

  return (
    <div className="attendance-page">
      <div className="page-header">
        <div>
          <h1>Attendance Records</h1>
          <p className="subtitle">View and manage attendance records</p>
        </div>
        <button onClick={exportToCSV} className="btn btn-primary">
          <Download size={18} />
          Export CSV
        </button>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <Filter size={18} />
          <label>From:</label>
          <input
            type="date"
            value={filters.start_date}
            onChange={(e) => handleFilterChange('start_date', e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label>To:</label>
          <input
            type="date"
            value={filters.end_date}
            onChange={(e) => handleFilterChange('end_date', e.target.value)}
          />
        </div>
        
        <div className="filter-group">
          <label>Status:</label>
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
          >
            <option value="">All</option>
            <option value="clock_in">Clock In</option>
            <option value="clock_out">Clock Out</option>
          </select>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">Loading records...</div>
        ) : records.length === 0 ? (
          <div className="no-data">No attendance records found</div>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Date & Time</th>
                  <th>Location</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <img 
                        src={photoUrl(record.photo_url)}
                        alt=""
                        className="table-photo"
                      />
                    </td>
                    <td>
                      <div className="employee-cell">
                        <span className="name">{record.user_name}</span>
                        <span className="id">{record.employee_id}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${record.status === 'clock_in' ? 'badge-green' : 'badge-orange'}`}>
                        {record.status === 'clock_in' ? 'Clock In' : 'Clock Out'}
                      </span>
                    </td>
                    <td>{formatDateTime(record.timestamp)}</td>
                    <td>
                      {record.latitude ? (
                        <span className="location-text">
                          📍 {parseFloat(record.latitude).toFixed(4)}, {parseFloat(record.longitude).toFixed(4)}
                        </span>
                      ) : (
                        <span className="no-location">No location</span>
                      )}
                    </td>
                    <td>
                      <button 
                        className="btn btn-small"
                        onClick={() => setSelectedRecord(record)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination">
              <span className="pagination-info">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </span>
              <div className="pagination-buttons">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1}
                  className="btn btn-small"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="page-number">{pagination.page} / {totalPages}</span>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page >= totalPages}
                  className="btn btn-small"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {selectedRecord && (
        <div className="modal-overlay" onClick={() => setSelectedRecord(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedRecord(null)}>×</button>
            <div className="modal-content">
              <img 
                src={photoUrl(selectedRecord.photo_url)}
                alt="Attendance"
                className="modal-photo"
              />
              <div className="modal-details">
                <h3>{selectedRecord.user_name}</h3>
                <p><strong>Employee ID:</strong> {selectedRecord.employee_id}</p>
                <p><strong>Status:</strong> {selectedRecord.status === 'clock_in' ? 'Clock In' : 'Clock Out'}</p>
                <p><strong>Time:</strong> {formatDateTime(selectedRecord.timestamp)}</p>
                {selectedRecord.latitude && (
                  <p><strong>Location:</strong> {selectedRecord.latitude}, {selectedRecord.longitude}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Attendance;
