# Selfie Attendance - Monitoring Dashboard

React-based monitoring dashboard for viewing and managing employee attendance.

## Features

- 📊 Real-time attendance dashboard
- 📋 Attendance records with filtering
- 🗺️ Map view with attendance locations
- 👥 User management (CRUD)
- 📸 Photo preview of attendance selfies
- 📥 Export to CSV
- 🔄 Auto-refresh every 30 seconds

## Prerequisites

- Node.js 18+
- Backend server running (see `/server` directory)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure API URL:**
   Create `.env` file:
   ```
   REACT_APP_API_URL=http://localhost:3001/api
   ```

3. **Start the dashboard:**
   ```bash
   npm start
   ```

   Dashboard will run on `http://localhost:3000`

## Pages

### Dashboard
- Today's attendance overview
- Employee status table
- Recent activity feed
- Auto-refreshing stats

### Attendance Records
- Filter by date and status
- View attendance photos
- Pagination support
- Export to CSV

### Map View
- Interactive Leaflet map
- Color-coded markers (green=clock in, orange=clock out)
- Popup with employee photo and details

### User Management
- Add new employees
- Edit user details
- Deactivate users

## Login

Use test credentials:
- Employee ID: `EMP001`
- PIN: `1234`

## Project Structure

```
dashboard/
├── public/
├── src/
│   ├── components/
│   │   └── Layout.js         # Sidebar layout
│   ├── hooks/
│   │   └── useAuth.js        # Authentication hook
│   ├── pages/
│   │   ├── Dashboard.js      # Main dashboard
│   │   ├── Attendance.js     # Attendance records
│   │   ├── Users.js          # User management
│   │   ├── MapView.js        # Map visualization
│   │   └── Login.js          # Login page
│   ├── services/
│   │   └── api.js            # API client
│   └── styles/
│       └── App.css           # Styles
├── .env
└── package.json
```

## API Integration

The dashboard communicates with the backend server for:
- Fetching attendance records
- User management
- Authentication

Ensure the backend server is running before using the dashboard.
