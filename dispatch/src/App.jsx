import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import WorkOrders from './pages/WorkOrders';
import MapPage from './pages/MapPage';
import NapGroups from './pages/NapGroups';
import DispatchBoard from './pages/DispatchBoard';
import ImportPage from './pages/ImportPage';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import DispositionCenter from './pages/DispositionCenter';
import TechnicianProductivity from './pages/TechnicianProductivity';

const Private = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading"><div className="spinner" />Checking session...</div>;
  return user ? children : <Navigate to="/login" replace />;
};

export default function App() {
  return (
    <>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Private><Layout /></Private>}>
          <Route index element={<Dashboard />} />
          <Route path="workorders" element={<WorkOrders />} />
          <Route path="map" element={<MapPage />} />
          <Route path="naps" element={<NapGroups />} />
          <Route path="board" element={<DispatchBoard />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="disposition" element={<DispositionCenter />} />
          <Route path="reports" element={<Reports />} />
          <Route path="productivity" element={<TechnicianProductivity />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}