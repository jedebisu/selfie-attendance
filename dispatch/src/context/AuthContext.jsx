import React, { createContext, useContext, useEffect, useState } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('dispatch_user') || 'null');
    } catch (_) {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('dispatch_token');
    if (!token) {
      setLoading(false);
      return;
    }
    authAPI
      .verify()
      .then((res) => setUser(res.user))
      .catch(() => {
        localStorage.removeItem('dispatch_token');
        localStorage.removeItem('dispatch_user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (employee_id, pin) => {
    const res = await authAPI.login(employee_id, pin);
    localStorage.setItem('dispatch_token', res.token);
    localStorage.setItem('dispatch_user', JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  };

  const logout = () => {
    localStorage.removeItem('dispatch_token');
    localStorage.removeItem('dispatch_user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
