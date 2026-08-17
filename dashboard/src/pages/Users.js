import React, { useState, useEffect } from 'react';
import { userAPI } from '../services/api';
import { Plus, Edit2, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';

const Users = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    employee_id: '',
    name: '',
    email: '',
    pin: ''
  });

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
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      if (editingUser) {
        await userAPI.update(editingUser.id, formData);
        toast.success('User updated successfully');
      } else {
        await userAPI.create(formData);
        toast.success('User created successfully');
      }
      
      setShowModal(false);
      setEditingUser(null);
      setFormData({ employee_id: '', name: '', email: '', pin: '' });
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
      pin: ''
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
      toast.error('Failed to deactivate user');
    }
  };

  const openAddModal = () => {
    setEditingUser(null);
    setFormData({ employee_id: '', name: '', email: '', pin: '' });
    setShowModal(true);
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
        <button onClick={openAddModal} className="btn btn-primary">
          <Plus size={18} />
          Add User
        </button>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>ID</th>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
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
                  <span className={`badge ${user.is_active ? 'badge-green' : 'badge-gray'}`}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>{new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="action-buttons">
                    <button onClick={() => handleEdit(user)} className="btn btn-icon">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => handleDelete(user.id)} className="btn btn-icon btn-danger">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
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
                <label>{editingUser ? 'New PIN (leave blank to keep)' : 'PIN *'}</label>
                <input
                  type="password"
                  name="pin"
                  value={formData.pin}
                  onChange={handleInputChange}
                  required={!editingUser}
                  maxLength={6}
                />
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
    </div>
  );
};

export default Users;
