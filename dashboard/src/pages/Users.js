import React, { useState, useEffect } from 'react';
import { userAPI } from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { Plus, Edit2, Trash2, X, Shield, Key } from 'lucide-react';
import toast from 'react-hot-toast';

const Users = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    employee_id: '',
    name: '',
    email: '',
    pin: '',
    role: 'employee'
  });

  const ROLES = [
    { value: 'employee', label: 'Employee' },
    { value: 'admin', label: 'Admin' },
    { value: 'hr', label: 'HR' },
    { value: 'ceo', label: 'CEO' }
  ];

  const ROLE_BADGES = {
    admin: { className: 'badge badge-gold', label: 'Admin', icon: true },
    hr: { className: 'badge badge-purple', label: 'HR', icon: false },
    ceo: { className: 'badge badge-blue', label: 'CEO', icon: false },
    employee: { className: 'badge badge-gray', label: 'Employee', icon: false }
  };

  const [showResetModal, setShowResetModal] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [newPin, setNewPin] = useState('');

  const isAdmin = currentUser?.is_admin;

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await userAPI.getAll();
      setUsers(res.data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const payload = { ...formData };
      if (editingUser && !payload.pin) {
        delete payload.pin;
      }

      if (editingUser) {
        await userAPI.update(editingUser.id, payload);
        toast.success('User updated successfully');
      } else {
        await userAPI.create(payload);
        toast.success('User created successfully');
      }
      
      setShowModal(false);
      setEditingUser(null);
      setFormData({ employee_id: '', name: '', email: '', pin: '', role: 'employee' });
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Operation failed');
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setFormData({
      employee_id: user.employee_id,
      name: user.name,
      email: user.email || '',
      pin: '',
      role: user.role || (user.is_admin ? 'admin' : 'employee')
    });
    setShowModal(true);
  };

  const handleDelete = async (userId) => {
    if (!window.confirm('Are you sure you want to deactivate this user?')) {
      return;
    }
    
    try {
      await userAPI.delete(userId);
      toast.success('User deactivated');
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to deactivate user');
    }
  };

  const openAddModal = () => {
    setEditingUser(null);
    setFormData({ employee_id: '', name: '', email: '', pin: '', role: 'employee' });
    setShowModal(true);
  };

  const openResetPin = (user) => {
    setResetUser(user);
    setNewPin('');
    setShowResetModal(true);
  };

  const handleResetPin = async (e) => {
    e.preventDefault();
    try {
      await userAPI.resetPin(resetUser.id, newPin);
      toast.success(`PIN reset for ${resetUser.name}`);
      setShowResetModal(false);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to reset PIN');
    }
  };

  if (loading) {
    return <div className="loading">Loading users...</div>;
  }

  return (
    <div className="users-page">
      <div className="page-header">
        <div>
          <h1>User Management</h1>
          <p className="subtitle">Manage employee accounts</p>
        </div>
        {isAdmin && (
          <button onClick={openAddModal} className="btn btn-primary">
            <Plus size={18} />
            Add User
          </button>
        )}
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>ID</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              {isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={!user.is_active ? 'inactive' : ''}>
                <td>
                  <div className="employee-cell">
                    <div className="avatar">{user.name.charAt(0)}</div>
                    <span className="name">{user.name}</span>
                  </div>
                </td>
                <td>{user.employee_id}</td>
                <td>{user.email || '-'}</td>
                <td>
                  {(() => {
                    const r = ROLE_BADGES[user.role || (user.is_admin ? 'admin' : 'employee')];
                    return (
                      <span className={r.className}>
                        {r.icon && <Shield size={12} />} {r.label}
                      </span>
                    );
                  })()}
                </td>
                <td>
                  <span className={`badge ${user.is_active ? 'badge-green' : 'badge-gray'}`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                {isAdmin && (
                  <td>
                    <div className="action-buttons">
                      <button onClick={() => handleEdit(user)} className="btn btn-icon">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => openResetPin(user)} className="btn btn-icon" title="Reset PIN">
                        <Key size={16} />
                      </button>
                      <button onClick={() => handleDelete(user.id)} className="btn btn-icon btn-danger">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingUser ? 'Edit User' : 'Add User'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Employee ID *</label>
                <input
                  type="text"
                  name="employee_id"
                  value={formData.employee_id}
                  onChange={handleInputChange}
                  required
                  disabled={!!editingUser}
                />
              </div>
              <div className="form-group">
                <label>Name *</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                />
              </div>
              <div className="form-group">
                <label>{editingUser ? 'New Password (leave blank to keep)' : 'Password *'}</label>
                <input
                  type="password"
                  name="pin"
                  value={formData.pin}
                  onChange={handleInputChange}
                  required={!editingUser}
                  maxLength={20}
                />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select
                  name="role"
                  value={formData.role}
                  onChange={handleInputChange}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingUser ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Reset PIN — {resetUser?.name}</h2>
              <button className="modal-close" onClick={() => setShowResetModal(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleResetPin}>
              <div className="form-group">
                <label>New PIN * (min 4 characters)</label>
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  required
                  minLength={4}
                  maxLength={20}
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowResetModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Reset PIN
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
