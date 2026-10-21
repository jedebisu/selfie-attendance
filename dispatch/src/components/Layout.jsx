import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ListOrdered, Map, Network, ClipboardList, Upload,
  BarChart3, Settings as SettingsIcon, LogOut, Tag, TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SyncStatusBar from './SyncStatusBar';

const NAV = [
  { section: 'Operations' },
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/workorders', icon: ListOrdered, label: 'Work Orders' },
  { to: '/map', icon: Map, label: 'Map View' },
  { to: '/naps', icon: Network, label: 'NAP Groups' },
  { to: '/board', icon: ClipboardList, label: 'Dispatch Board' },
  { section: 'Manage' },
  { to: '/import', icon: Upload, label: 'Import Work Orders' },
  { to: '/disposition', icon: Tag, label: 'Disposition Center' },
  { to: '/reports', icon: BarChart3, label: 'Reports & Audit' },
  { to: '/productivity', icon: TrendingUp, label: 'Technician Productivity' },
  { to: '/settings', icon: SettingsIcon, label: 'Settings' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <img src="/logo.png" alt="EBISU" className="sidebar-logo" />
          <div className="sidebar-brand">
            <h2>EBISU Dispatch</h2>
            <span>Work Order Console</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map((item) =>
            item.section ? (
              <div key={item.section} className="nav-section-label">{item.section}</div>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <item.icon size={18} strokeWidth={2} />
                <span>{item.label}</span>
              </NavLink>
            )
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-avatar">{user?.name?.charAt(0)}</div>
          <div className="user-details">
            <span className="user-name">{user?.name}</span>
            <span className="user-id">{user?.employee_id}{user?.is_admin ? ' · Admin' : ''}</span>
          </div>
          <button onClick={handleLogout} className="logout-btn" title="Log out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <SyncStatusBar />
        <Outlet />
      </main>
    </div>
  );
}