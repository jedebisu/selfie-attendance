# Selfie Attendance System - Backend

Backend API for the Selfie Attendance System. Records employee attendance via selfie photos with timestamp and GPS overlay.

## Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- npm or yarn

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Create database:**
   ```sql
   CREATE DATABASE selfie_attendance;
   ```

4. **Run migrations:**
   ```bash
   npm run db:migrate
   ```

5. **Seed test data (optional):**
   ```bash
   npm run db:seed
   ```

6. **Start server:**
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Login with employee ID and PIN |
| GET | /api/auth/verify | Verify JWT token |
| POST | /api/auth/logout | Logout and invalidate session |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users | Get all users |
| GET | /api/users/:id | Get single user |
| POST | /api/users | Create new user |
| PUT | /api/users/:id | Update user |
| DELETE | /api/users/:id | Deactivate user |

### Attendance
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/attendance | Submit selfie attendance |
| GET | /api/attendance | Get attendance records (with filters) |
| GET | /api/attendance/:id | Get single attendance record |
| GET | /api/attendance/summary/today | Get today's attendance summary |

## Photo Processing

The system automatically adds:
- **Timestamp overlay** - Date and time of capture
- **GPS coordinates** - Latitude/longitude overlay
- **Location name** - If provided

Photos are stored in `/uploads` directory.

## Test Credentials

After running seed:
- **EMP001** / 1234
- **EMP002** / 5678
- **EMP003** / 9012

## Example Request

```bash
# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"employee_id": "EMP001", "pin": "1234"}'

# Submit attendance
curl -X POST http://localhost:3001/api/attendance \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "photo=@selfie.jpg" \
  -F "user_id=1" \
  -F "latitude=14.5995" \
  -F "longitude=120.9842" \
  -F "status=clock_in"
```
