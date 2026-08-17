# Selfie Attendance System - Deployment Guide

Complete deployment guide for production use.

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────┐
│  Mobile App     │────▶│   Backend API   │────▶│ PostgreSQL  │
│  (iOS/Android)  │     │   (Render)      │     │  (Render)   │
└─────────────────┘     └─────────────────┘     └─────────────┘
                              │
                              ▼
                        ┌─────────────────┐
                        │  Dashboard      │
                        │  (Vercel)       │
                        └─────────────────┘
```

---

## 1. Backend Deployment (Render)

### Option A: Using Render Blueprint (Recommended)

1. **Push code to GitHub**

2. **Create Render account** at https://render.com

3. **New > Blueprint** and connect your GitHub repo

4. Render will auto-detect `render.yaml` and create:
   - Web service (Node.js API)
   - PostgreSQL database

5. **Database will be auto-created** with connection string

6. **Migrations run automatically** on deploy

### Option B: Manual Setup

1. **Create PostgreSQL database:**
   - Render > New > PostgreSQL
   - Note the connection string

2. **Create Web Service:**
   - Render > New > Web Service
   - Connect GitHub repo
   - Select `server` directory
   - Build Command: `npm install && npm run db:migrate`
   - Start Command: `npm start`

3. **Add Environment Variables:**
   ```
   NODE_ENV=production
   DATABASE_URL=<your-postgres-url>
   JWT_SECRET=<generate-random-secret>
   DB_SSL=true
   ```

### Post-Deployment

Your API will be at: `https://your-app-name.onrender.com`

Test with:
```bash
curl https://your-app-name.onrender.com/api/health
```

---

## 2. Dashboard Deployment (Vercel)

### Option A: Vercel CLI

```bash
cd dashboard
npm install

# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Deploy to production
vercel --prod
```

### Option B: GitHub Integration

1. **Push code to GitHub**

2. **Go to** https://vercel.com

3. **Import** your GitHub repo

4. **Configure:**
   - Framework: Create React App
   - Root Directory: `dashboard`
   - Build Command: `npm run build`
   - Output Directory: `build`

5. **Add Environment Variables:**
   ```
   REACT_APP_API_URL=https://your-app-name.onrender.com/api
   ```

6. **Deploy**

### Custom Domain

```bash
vercel domains add yourdomain.com
```

---

## 3. Mobile App Deployment

### Prerequisites

- Apple Developer Account ($99/year) for iOS
- Google Play Developer Account ($25 one-time) for Android
- Expo account (free)

### Setup EAS Build

```bash
cd mobile

# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Initialize EAS
eas build:configure
```

### Update API URL

Edit `src/services/api.js` to use production URL:

```javascript
const BASE_URL = 'https://your-app-name.onrender.com/api';
```

### Build for iOS

```bash
# First time setup (handles certificates)
eas credentials --platform ios

# Build for App Store
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios --latest
```

### Build for Android

```bash
# Build for Play Store
eas build --platform android --profile production

# Submit to Play Store
eas submit --platform android --latest
```

### App Store Setup

**iOS (App Store Connect):**
1. Create app at https://appstoreconnect.apple.com
2. Fill in App Information, Privacy Policy URL
3. Add screenshots (iPhone 6.5", iPhone 5.5", iPad)
4. Submit for review (24-48 hours)

**Android (Google Play Console):**
1. Create app at https://play.google.com/console
2. Complete Data Safety form
3. Add screenshots and descriptions
4. Submit for review (hours to 3 days)

---

## 4. Environment Variables Reference

### Backend (Render)
| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `DATABASE_URL` | PostgreSQL URL | `postgresql://...` |
| `JWT_SECRET` | Secret for tokens | `<random-string>` |
| `DB_SSL` | Enable SSL | `true` |

### Dashboard (Vercel)
| Variable | Description | Example |
|----------|-------------|---------|
| `REACT_APP_API_URL` | Backend API URL | `https://api.onrender.com/api` |

---

## 5. Post-Deployment Checklist

### Backend
- [ ] API health endpoint responds
- [ ] Database migrations completed
- [ ] Test user can login
- [ ] Photo upload works

### Dashboard
- [ ] Login page loads
- [ ] Can login with test credentials
- [ ] Attendance records display
- [ ] Map view shows locations
- [ ] Export to CSV works

### Mobile App
- [ ] App builds successfully
- [ ] Camera permission works
- [ ] GPS location captured
- [ ] Photo uploads to server
- [ ] Attendance records sync

---

## 6. Troubleshooting

### Backend Issues

**Database connection failed:**
```
Error: connection refused
```
- Ensure `DATABASE_URL` is set correctly
- Check that `DB_SSL=true` is set
- Verify database is running

**CORS errors:**
Add your dashboard URL to CORS config in `server.js`:
```javascript
app.use(cors({
  origin: ['https://your-dashboard.vercel.app'],
  credentials: true
}));
```

### Dashboard Issues

**API not reachable:**
- Verify `REACT_APP_API_URL` is set
- Check backend is running
- Ensure CORS is configured

### Mobile App Issues

**Build fails:**
- Run `eas diagnostics` to check config
- Ensure all permissions are declared in `app.json`

**Photos not uploading:**
- Check API URL in `api.js`
- Ensure backend has storage space
- Verify image upload endpoint works

---

## 7. Cost Estimate

| Service | Plan | Monthly Cost |
|---------|------|--------------|
| Render (Backend + DB) | Free | $0 |
| Vercel (Dashboard) | Free | $0 |
| EAS Build (Mobile) | Free tier | $0 |
| **Total** | | **$0** |

**Free tier limits:**
- Render: 750 hours/month, spins down after inactivity
- Vercel: 100GB bandwidth, unlimited deploys
- EAS: 30 builds/month

For production with high traffic, upgrade to paid plans (~$20-50/month total).

---

## 8. Quick Deploy Commands

```bash
# Backend
cd server
git init && git add . && git commit -m "initial"
# Push to GitHub, then deploy via Render dashboard

# Dashboard
cd dashboard
vercel --prod

# Mobile
cd mobile
eas build --platform all --profile production
eas submit --platform all --latest
```

---

## Support

For issues, check:
- Backend logs: Render Dashboard > Logs
- Dashboard: Vercel Dashboard > Functions
- Mobile: `eas build:list` to see build status
