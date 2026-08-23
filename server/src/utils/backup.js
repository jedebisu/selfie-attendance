const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { cloudinary, isConfigured } = require('../config/cloudinary');

const BACKUP_FOLDER = 'selfie-attendance-backups';
const RETENTION_COUNT = 14;

const TABLES = [
  'users',
  'attendance',
  'leave_requests',
  'location_pings'
];

async function generateBackup() {
  const dump = {
    app: 'selfie-attendance',
    version: 1,
    created_at: new Date().toISOString(),
    tables: {}
  };

  for (const table of TABLES) {
    try {
      const res = await pool.query(
        `SELECT * FROM ${table} ORDER BY id`
      );
      dump.tables[table] = {
        columns: res.fields.map(f => f.name),
        rows: res.rows
      };
    } catch (err) {
      console.error(`[backup] skipping table ${table}: ${err.message}`);
    }
  }

  return JSON.stringify(dump);
}

async function uploadBackup(jsonString) {
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup-${date}.json`;

  if (!isConfigured) {
    const dir = path.join(__dirname, '..', '..', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, jsonString);
    console.log(`[backup] Cloudinary not configured - wrote local file: ${filePath}`);
    return { url: filePath, filename };
  }

  const result = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      { folder: BACKUP_FOLDER, resource_type: 'raw', public_id: filename },
      (error, res) => (error ? reject(error) : resolve(res))
    ).end(Buffer.from(jsonString, 'utf8'));
  });

  console.log(`[backup] uploaded to Cloudinary: ${result.secure_url}`);
  await pruneOldBackups();
  return { url: result.secure_url, filename };
}

async function pruneOldBackups() {
  try {
    const resources = [];
    let nextCursor = null;
    do {
      const page = await cloudinary.api.resources({
        type: 'upload',
        resource_type: 'raw',
        prefix: `${BACKUP_FOLDER}/`,
        max_results: 100,
        next_cursor: nextCursor || undefined
      });
      resources.push(...page.resources);
      nextCursor = page.next_cursor;
    } while (nextCursor);

    if (resources.length <= RETENTION_COUNT) return;

    resources.sort((a, b) => (a.public_id < b.public_id ? 1 : -1));
    const stale = resources.slice(RETENTION_COUNT).map(r => r.public_id);

    for (let i = 0; i < stale.length; i += 50) {
      const batch = stale.slice(i, i + 50).join(',');
      await cloudinary.api.delete_resources(batch, {
        resource_type: 'raw',
        all: true
      });
    }
    console.log(`[backup] pruned ${stale.length} old backup(s)`);
  } catch (err) {
    console.error('[backup] prune failed:', err.message);
  }
}

async function getLastBackupInfo() {
  if (!isConfigured) return null;
  try {
    const res = await cloudinary.api.resources({
      type: 'upload',
      resource_type: 'raw',
      prefix: `${BACKUP_FOLDER}/`,
      max_results: 1,
      direction: 'desc',
      sort_by: [['public_id', 'desc']]
    });
    if (!res.resources.length) return null;
    return res.resources[0].public_id.replace(`${BACKUP_FOLDER}/`, '');
  } catch {
    return null;
  }
}

async function runBackupIfStale(maxAgeHours = 20) {
  try {
    const last = await getLastBackupInfo();
    if (last) {
      const m = last.match(/backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
      if (m) {
        const [, y, mo, d, h, mi, s] = m.map(Number);
        const lastDate = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
        const ageH = (Date.now() - lastDate.getTime()) / 3600000;
        if (ageH < maxAgeHours) {
          console.log(`[backup] recent backup exists (${last}), skipping`);
          return false;
        }
      }
    }
    const json = await generateBackup();
    const { filename } = await uploadBackup(json);
    console.log(`[backup] complete: ${filename}`);
    return true;
  } catch (err) {
    console.error('[backup] FAILED:', err.message);
    return false;
  }
}

function scheduleBackups() {
  setTimeout(() => {
    runBackupIfStale();
    setInterval(() => runBackupIfStale(), 6 * 60 * 60 * 1000);
  }, 2 * 60 * 1000);
}

module.exports = { generateBackup, uploadBackup, runBackupIfStale, scheduleBackups };
