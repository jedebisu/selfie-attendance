import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(employeeId.trim(), pin);
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-body">
      <div className="login-card">
        <img src="/logo.png" alt="EBISU" className="login-logo" />
        <h1>Work Order Dispatch</h1>
        <div className="login-sub">EBISU Dispatch Console</div>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Employee ID</label>
            <input className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP001" autoFocus />
          </div>
          <div className="form-group">
            <label>PIN</label>
            <input className="input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="••••••" />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className="hint">
          Test accounts (same as Selfie-Attendance): <strong>EMP001/123456</strong> (Admin), <strong>EMP002/5678</strong>, <strong>EMP003/9012</strong>.
        </div>
      </div>
    </div>
  );
}