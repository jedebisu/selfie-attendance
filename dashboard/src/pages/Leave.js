import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { leaveAPI, userAPI, exportAPI } from '../services/api';
import { Plus, Check, X, Trash2, Download, CalendarDays } from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const Leave = () => {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.is_admin;
  const [leaves, setLeaves] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ status: '', user_id: '' });
  const [formData, setFormData] = useState({ leave_date: '', reason: '' });

  useEffect(() => {
    fetchLeaves();
    if (isAdmin) fetchUsers();
  }, [filters]);

  const fetchLeaves = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.user_id) params.user_id = filters.user_id;
      const res = await leaveAPI.getAll(params);
      setLeaves(res.data || []);
    } catch (error) {
      toast.error('Failed to load leave requests');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await userAPI.getAll();
      setUsers(res.data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await leaveAPI.create(formData);
      toast.success('Leave request submitted');
      setShowModal(false);
      setFormData({ leave_date: '', reason: '' });
      fetchLeaves();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to submit');
    }
  };

  const handleApproveReject = async (id, status) => {
    try {
      await leaveAPI.update(id, status);
      toast.success(`Leave ${status}`);
      fetchLeaves();
    } catch (error) {
      toast.error('Failed to update leave');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this leave request?')) return;
    try {
      await leaveAPI.delete(id);
      toast.success('Leave request deleted');
      fetchLeaves();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to delete');
    }
  };

  const handleExport = async () => {
    try {
      const params = {};
      if (filters.user_id) params.user_id = filters.user_id;
      if (filters.status) params.status = filters.status;
      const res = await exportAPI.leaves(params);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `leaves_export_${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Exported successfully');
    } catch (error) {
      toast.error('Failed to export');
    }
  };

  const statusBadge = (status) => {
    const map = { pending: 'badge-orange', approved: 'badge-green', rejected: 'badge-gray' };
    return <span className={`badge ${map[status] || 'badge-gray'}`}>{status}</span>;
  };

  return (
    <div className="leave-page">
      <div className="page-header">
        <div>
          <h1><CalendarDays size={28} style={{ marginRight: 8, verticalAlign: 'middle' }} />Leave Management</h1>
          <p className="subtitle">Request and manage time off</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleExport} className="btn btn-secondary">
            <Download size={18} /> Export
          </button>
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            <Plus size={18} /> Request Leave
          </button>
        </div>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <label>Status:</label>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        {isAdmin && (
          <div className="filter-group">
            <label>Employee:</label>
            <select value={filters.user_id} onChange={(e) => setFilters({ ...filters, user_id: e.target.value })}>
              <option value="">All</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.employee_id})</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">Loading leaves...</div>
        ) : leaves.length === 0 ? (
          <div className="no-data">No leave requests found</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Date</th>
                <th>Reason</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {leaves.map((leave) => (
                <tr key={leave.id}>
                  <td>
                    <div className="employee-cell">
                      <div className="avatar">{leave.user_name?.charAt(0)}</div>
                      <div>
                        <span className="name">{leave.user_name}</span>
                        <span className="id">{leave.employee_id}</span>
                      </div>
                    </div>
                  </td>
                  <td>{format(new Date(leave.leave_date), 'MMM dd, yyyy')}</td>
                  <td>{leave.reason}</td>
                  <td>{statusBadge(leave.status)}</td>
                  {isAdmin && (
                    <td>
                      <div className="action-buttons">
                        {leave.status === 'pending' && (
                          <>
                            <button onClick={() => handleApproveReject(leave.id, 'approved')} className="btn btn-icon" title="Approve">
                              <Check size={16} style={{ color: '#22c55e' }} />
                            </button>
                            <button onClick={() => handleApproveReject(leave.id, 'rejected')} className="btn btn-icon" title="Reject">
                              <X size={16} style={{ color: '#ef4444' }} />
                            </button>
                          </>
                        )}
                        <button onClick={() => handleDelete(leave.id)} className="btn btn-icon btn-danger">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Request Leave</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={formData.leave_date}
                  onChange={(e) => setFormData({ ...formData, leave_date: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Reason *</label>
                <input
                  type="text"
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  placeholder="e.g., Sick leave, personal day"
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Submit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Leave;
