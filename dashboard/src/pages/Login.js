import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';

const Login = () => {
  const [employeeId, setEmployeeId] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!employeeId || !pin) {
      toast.error('Please enter both Employee ID and Password');
      return;
    }

    setLoading(true);
    try {
      await login(employeeId, pin);
      toast.success('Welcome back');
      navigate('/');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/logo.png" alt="EBISU" className="login-logo" />
          <h1>EBISU T&A</h1>
          <p>Time & Attendance Dashboard</p>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Employee ID</label>
            <input
              type="text"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              placeholder="Enter your Employee ID"
              disabled={loading}
            />
          </div>
          
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
              maxLength={20}
            />
          </div>
          
          <div style={{ padding: '0 24px' }}>
            <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ width: '100%', padding: '14px', borderRadius: '12px', fontSize: '15px' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Login;
