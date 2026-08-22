import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Attendance from './pages/Attendance';
import Users from './pages/Users';
import MapView from './pages/MapView';
import LiveMap from './pages/LiveMap';
import Calendar from './pages/Calendar';
import Leave from './pages/Leave';
import Analytics from './pages/Analytics';
import Login from './pages/Login';
import { AuthProvider, useAuth } from './hooks/useAuth';
import './styles/App.css';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return <div className="loading">Loading...</div>;
  }
  
  return user ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }>
            <Route index element={<Dashboard />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="leave" element={<Leave />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="users" element={<Users />} />
            <Route path="map" element={<MapView />} />
            <Route path="live" element={<LiveMap />} />
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
