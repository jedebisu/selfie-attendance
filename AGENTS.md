# AGENTS.md — Selfie Attendance System

## Repo Structure

Monorepo, 3 independent apps — **no root `package.json`**. Each app has its own deps and scripts, run from its subdirectory.

```
server/    → Node.js + Express API (port 3001), PostgreSQL, sharp for image processing
dashboard/ → React (Create React App), deployed to Vercel
mobile/    → Expo SDK 54 React Native, deployed via EAS
```

## Commands

### Server (`server/`)
```bash
cd server && npm install
npm run dev              # nodemon, port 3001
npm run db:migrate       # create tables (idempotent)
npm run db:seed          # seed test users (EMP001/1234, EMP002/5678, EMP003/9012)
npm start                # production start
```

### Dashboard (`dashboard/`)
```bash
cd dashboard && npm install
npm start                # dev server, port 3000
npm run build            # production build (CI=false — see gotchas)
```

### Mobile (`mobile/`)
```bash
cd mobile && npm install
npx expo start           # dev server (Expo Go)
eas build --platform android --profile preview   # APK build
```

## Deployment

| App       | Platform | URL                                            |
|-----------|----------|------------------------------------------------|
| Server    | Render   | `https://selfie-api-sqgh.onrender.com`          |
| Dashboard | Vercel   | `https://selfie-attendance-delta.vercel.app`    |
| Mobile    | EAS      | APK from `expo.dev/accounts/jedebisu`           |

- **Server**: Auto-deploys on push. `render.yaml` defines build pipeline (`npm install && npm run db:migrate && npm run db:seed`).
- **Dashboard**: Auto-deploys on push. Vercel rewrites SPA routes via `vercel.json`.
- **Mobile**: Manual EAS builds. Use `--profile preview` for internal APK distribution.

## Gotchas

- **Dashboard build requires `CI=false`** — CRA treats lint warnings as errors. The `build` script in `dashboard/package.json` is `CI=false react-scripts build`. Vercel also has `CI=false` env var set. Never remove this.
- **Database config differs by env** — Local dev uses `DB_USER`/`DB_HOST`/etc. vars. Production (Render) uses `DATABASE_URL` connection string. `server/src/config/database.js` handles both. Don't hardcode either.
- **`uploads/` directory is ephemeral on Render free tier** — Attendance photos are uploaded to **Cloudinary** (folder `selfie-attendance`) at clock-in when configured, so they persist across redeploys. Requires env vars `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (set on Render + in `server/.env`). Without them, the server falls back to the local `uploads/` disk (ephemeral — photos lost on redeploy). Temp files are deleted from disk after upload. `photo_url` may be NULL for old records whose files were lost.
- **Dashboard photo URLs** — `dashboard/src/services/api.js` exports `photoUrl()` which handles both absolute Cloudinary URLs and legacy relative `/uploads/` paths. Use it for any `<img src>` referencing attendance photos; never hardcode `SERVER_URL + url`.
- **Mobile API URL is hardcoded** — `mobile/src/services/api.js` points to production URL (`https://selfie-api-sqgh.onrender.com/api`). For local dev, change it to `http://localhost:3001/api`.
- **Expo Go SDK 54** — The user's phone runs Expo Go SDK 54. Don't upgrade the Expo SDK without checking compatibility.
- **EAS builds use `preview` profile** — This produces an internal-distribution APK, not a store build.
- **APK distribution via GitHub Releases, not EAS** — EAS free-tier quota is limited; local Gradle builds (`mobile/android`, JDK17 + Android SDK installed) are the default. Publish with `cd mobile && bash publish-apk.sh` — it creates an immutable release tagged `app-v<versionCode>` per build (rollback history) and refreshes the fixed-name asset so employees always install from `https://github.com/jedebisu/selfie-attendance/releases/latest/download/EBISU-TA.apk`. Never overwrite a single release asset with new builds — that destroys rollback points (user requirement).
- **Bump `versionCode` in `mobile/app.json` (+ regenerate `android/app/build.gradle` via prebuild or matching sed) before every release build** — Android requires an increasing versionCode for update-over-install.
- **Server CORS is wide open** — `origin: true` allows all origins. Fine for this project but not for production with sensitive data.

## Architecture Notes

- **Auth**: JWT-based. Server middleware (`server/src/middleware/auth.js`) protects `/api/users` and `/api/attendance`. Login returns token; dashboard stores in `localStorage`.
- **Photo processing**: `server/src/utils/imageProcessor.js` uses `sharp` to overlay timestamp + GPS + OSM map tile onto selfies at lower-left corner.
- **Dashboard API client**: `dashboard/src/services/api.js` — Axios instance with base URL from `REACT_APP_API_URL` env var (defaults to production). Exports `SERVER_URL` and `photoUrl()` for photo URLs.
- **Mobile screens**: `LoginScreen` → `HomeScreen` → `CameraScreen` (clock in/out) → `HistoryScreen`. Auth context in `src/context/AuthContext.js`.
- **Database schema**: `users`, `attendance`, `sessions` tables. Migrations in `server/src/config/migrate.js`.

## User Context

- GitHub account: `jedebisu`, repo: `jedebisu/selfie-attendance`
- Zero coding experience — avoid assuming familiarity with tooling
- Working machine: macOS (`yanggee@Jeds-Macbook-Air`)
