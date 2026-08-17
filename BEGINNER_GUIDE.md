# Complete Beginner's Guide - Selfie Attendance System

This guide assumes you have ZERO coding experience. Follow each step exactly.

---

## Step 1: Install Required Software

### A. Install Node.js (Required for the app to run)

1. Go to: https://nodejs.org
2. Click the **LTS** version (green button)
3. Download and run the installer
4. Click "Next" through all screens, accept defaults
5. Click "Install" and wait for it to finish

**Verify it worked:**
- Open **Terminal** (Mac) or **Command Prompt** (Windows)
- Type: `node --version`
- You should see a version number like `v18.17.0`

### B. Install Git (Required for deployment)

1. Go to: https://git-scm.com
2. Click "Downloads"
3. Download for your operating system
4. Run installer, click through all defaults

### C. Install VS Code (Code Editor - optional but helpful)

1. Go to: https://code.visualstudio.com
2. Download and install
3. This lets you view/edit the code files

---

## Step 2: Create Free Accounts

Create accounts on these websites (you'll need them for deployment):

| Service | Purpose | URL | Cost |
|---------|---------|-----|------|
| **GitHub** | Stores your code | https://github.com | Free |
| **Render** | Hosts your backend | https://render.com | Free |
| **Vercel** | Hosts your dashboard | https://vercel.com | Free |
| **Expo** | Builds your mobile app | https://expo.dev | Free |
| **Apple Developer** | iOS app store (if needed) | https://developer.apple.com | $99/year |
| **Google Play** | Android app store (if needed) | https://play.google.com/console | $25 one-time |

**Start with GitHub, Render, Vercel, and Expo for now.**

---

## Step 3: Download Your Project

I've already created all the code for you. Here's how to get it:

### Option A: If you have the files on your computer

The project is in: `/Users/yanggee/selfie-attendance/`

### Option B: If you need to download from somewhere

1. Open Terminal
2. Run these commands one by one:

```bash
# Go to your home folder
cd ~

# The project should already be there
ls selfie-attendance
```

---

## Step 4: Set Up the Backend (API Server)

### 4.1 Open Terminal

- **Mac:** Press `Cmd + Space`, type "Terminal", press Enter
- **Windows:** Press `Win + R`, type "cmd", press Enter

### 4.2 Navigate to the server folder

```bash
cd ~/selfie-attendance/server
```

### 4.3 Install dependencies

```bash
npm install
```

Wait for it to finish (may take 2-3 minutes).

### 4.4 Set up the database locally (for testing)

**First, install PostgreSQL:**

1. Go to: https://www.postgresql.org/download/
2. Download for your OS
3. Run installer
4. **Remember the password you set!** (Write it down)
5. Keep default port (5432)

**Then create the database:**

Open Terminal and run:

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE selfie_attendance;"
```

Enter your PostgreSQL password when asked.

### 4.5 Configure the server

```bash
# Copy the example config file
cp .env.example .env
```

Now edit the `.env` file:

**Mac:**
```bash
open -e .env
```

**Windows:**
```bash
notepad .env
```

Change these lines:
```
DB_USER=postgres
DB_PASSWORD=your_password_here
DB_NAME=selfie_attendance
```

Save the file (Cmd+S on Mac, Ctrl+S on Windows).

### 4.6 Set up the database tables

```bash
npm run db:migrate
```

You should see: "Database tables created successfully!"

### 4.7 Add test users

```bash
npm run db:seed
```

### 4.8 Start the server

```bash
npm run dev
```

You should see: "Server running on port 3001"

**Keep this Terminal window open!** The server needs to stay running.

---

## Step 5: Set Up the Dashboard

### 5.1 Open a NEW Terminal window

Keep the server running in the first window.

### 5.2 Navigate to dashboard folder

```bash
cd ~/selfie-attendance/dashboard
```

### 5.3 Install dependencies

```bash
npm install
```

Wait for it to finish.

### 5.4 Configure the dashboard

```bash
cp .env.example .env
```

Edit the `.env` file:

**Mac:**
```bash
open -e .env
```

**Windows:**
```bash
notepad .env
```

Make sure it says:
```
REACT_APP_API_URL=http://localhost:3001/api
```

Save the file.

### 5.5 Start the dashboard

```bash
npm start
```

A browser window should open at: `http://localhost:3000`

**You should see the login page!**

---

## Step 6: Test Everything Locally

### 6.1 Login to Dashboard

- Employee ID: `EMP001`
- PIN: `1234`

### 6.2 Test the mobile app (on your phone)

1. Install **Expo Go** app on your phone:
   - iPhone: App Store
   - Android: Google Play Store

2. Open Terminal, navigate to mobile folder:
```bash
cd ~/selfie-attendance/mobile
npm install
npm start
```

3. Scan the QR code with your phone camera (iPhone) or Expo Go (Android)

4. Login with same credentials

---

## Step 7: Deploy to the Internet

### 7.1 Create a GitHub Repository

1. Go to: https://github.com
2. Click the **+** icon (top right)
3. Click "New repository"
4. Name it: `selfie-attendance`
5. Click "Create repository"

### 7.2 Upload your code to GitHub

Open Terminal and run:

```bash
cd ~/selfie-attendance

# Initialize git
git init
git add .
git commit -m "Initial commit"

# Connect to GitHub (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/selfie-attendance.git

# Upload
git push -u origin main
```

Enter your GitHub username and password when asked.

### 7.3 Deploy Backend to Render

1. Go to: https://render.com
2. Sign up/Login with GitHub
3. Click **New +** → **Blueprint**
4. Connect your GitHub account
5. Select `selfie-attendance` repository
6. Click **Apply**
7. Wait 5-10 minutes for deployment

**Your API will be at:** `https://your-app-name.onrender.com/api/health`

### 7.4 Deploy Dashboard to Vercel

1. Go to: https://vercel.com
2. Sign up/Login with GitHub
3. Click **Add New...** → **Project**
4. Select `selfie-attendance` repository
5. Configure:
   - Framework: **Create React App**
   - Root Directory: **dashboard**
6. Add Environment Variable:
   - Name: `REACT_APP_API_URL`
   - Value: `https://your-app-name.onrender.com/api`
7. Click **Deploy**
8. Wait 2-3 minutes

**Your dashboard will be at:** `https://your-project-name.vercel.app`

### 7.5 Deploy Mobile App

**For Android:**

1. Install EAS CLI:
```bash
npm install -g eas-cli
```

2. Login to Expo:
```bash
eas login
```

3. Update API URL in `mobile/src/services/api.js`

4. Build:
```bash
cd ~/selfie-attendance/mobile
eas build --platform android --profile production
```

5. Submit to Play Store:
```bash
eas submit --platform android --latest
```

**For iOS:**

1. Same as above but with `--platform ios`

2. Submit to App Store:
```bash
eas submit --platform ios --latest
```

---

## Step 8: Configure Your Domain (Optional)

### Add custom domain to Vercel:

1. Go to Vercel dashboard
2. Click your project
3. Go to **Settings** → **Domains**
4. Add your domain
5. Update DNS records as instructed

---

## Quick Reference Commands

### Start Server
```bash
cd ~/selfie-attendance/server
npm run dev
```

### Start Dashboard
```bash
cd ~/selfie-attendance/dashboard
npm start
```

### Start Mobile App
```bash
cd ~/selfie-attendance/mobile
npm start
```

### Deploy Updates
```bash
cd ~/selfie-attendance
git add .
git commit -m "Update description"
git push
```

---

## Common Issues & Fixes

### "Command not found: node"
→ Restart Terminal after installing Node.js

### "Cannot find module"
→ Run `npm install` in that folder

### "Database connection refused"
→ Make sure PostgreSQL is running

### "Port already in use"
→ Kill the process using that port:
```bash
lsof -ti:3001 | xargs kill -9
```

### Dashboard shows "Failed to fetch"
→ Check if server is running
→ Check API URL in `.env`

---

## Need Help?

If you get stuck on any step, tell me:
1. Which step you're on
2. What error message you see
3. What operating system you're using (Mac/Windows)

I'll help you fix it!
