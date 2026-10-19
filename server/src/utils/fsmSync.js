// Globe FSM synchronization connector.
//
// The Globe FSM system (fsm.globe.com.ph) exposes no public work-order API;
// this module is a source-agnostic ingestion layer ready for whichever
// authorized delivery path Globe provides. Nothing here calls an invented
// endpoint — every mode is explicit and driven by env configuration.
//
//   folder  → poll a local directory (dev/test + manual "put a file here")
//   sftp    → pick export files up from an SFTP drop folder, then archive
//   http    → generic GET of a single CSV/text URL (use only if Globe gives
//             you a static export URL; must be configured, never guessed)
//
// Idempotency & safety:
//   · Imports reuse the work order import pipeline (auto column mapping,
//     NAP resolution, disposition classification, review queue). Repeated
//     pickups of the same file are harmless because work_order_number is the
//     business key and the latest-appointment rule never downgrades a record.
//   · A per-file fingerprint (name+size+mtime) is persisted in sync_files so
//     an unchanged file is skipped on every later run, even across restarts.
//   · During a download the file is only marked processed AFTER the import
//     commit succeeds; if we die in between, the next run re-processes it
//     (idempotent updates, never duplicates).
//   · A module-level lock prevents scheduler/manual runs from racing.
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { parseUpload, analyzeImport, executeImport } = require('./workOrderImport');
const { autoMapColumns } = require('./workOrderFields');

const DEFAULT_INTERVAL_MIN = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = false;

function fsmConfig() {
  return {
    enabled: String(process.env.FSM_SYNC_ENABLED || '').toLowerCase() === 'true',
    mode: String(process.env.FSM_SYNC_MODE || 'folder').toLowerCase(),
    folder: process.env.FSM_SYNC_FOLDER || null,
    archiveFolder: process.env.FSM_SYNC_ARCHIVE || null,
    intervalMin: parseInt(process.env.FSM_SYNC_INTERVAL_MIN, 10) || DEFAULT_INTERVAL_MIN,
    httpUrl: process.env.FSM_SYNC_HTTP_URL || null,
    sftp: {
      host: process.env.FSM_SFTP_HOST || null,
      port: parseInt(process.env.FSM_SFTP_PORT, 10) || 22,
      username: process.env.FSM_SFTP_USERNAME || process.env.FSM_SFTP_USER || null,
      password: process.env.FSM_SFTP_PASSWORD || process.env.FSM_SFTP_PASS || null,
      privateKeyPath: process.env.FSM_SFTP_PRIVATE_KEY || null,
      pickupPath: process.env.FSM_SFTP_PICKUP_PATH || null,
      archivePath: process.env.FSM_SFTP_ARCHIVE_PATH || '',
      retries: Math.max(1, parseInt(process.env.FSM_SFTP_RETRIES, 10) || 3),
    },
  };
}

function isConfigured(cfg) {
  if (!cfg.enabled) return false;
  if (cfg.mode === 'folder') return !!cfg.folder;
  if (cfg.mode === 'sftp')
    return !!(
      cfg.sftp.host &&
      cfg.sftp.username &&
      cfg.sftp.pickupPath &&
      (cfg.sftp.password || cfg.sftp.privateKeyPath)
    );
  if (cfg.mode === 'http') return !!cfg.httpUrl;
  return false;
}

function configReason(cfg) {
  if (!cfg.enabled) return 'FSM_SYNC_ENABLED is not true';
  if (cfg.mode === 'folder') return cfg.folder ? 'ready' : 'FSM_SYNC_FOLDER is not set';
  if (cfg.mode === 'sftp')
    return cfg.sftp.host && cfg.sftp.username && cfg.sftp.pickupPath
      ? cfg.sftp.password || cfg.sftp.privateKeyPath
        ? 'ready'
        : 'FSM_SFTP_PASSWORD or FSM_SFTP_PRIVATE_KEY is not set'
      : 'FSM_SFTP_HOST/USERNAME/PICKUP_PATH are not set';
  if (cfg.mode === 'http') return cfg.httpUrl ? 'ready' : 'FSM_SYNC_HTTP_URL is not set';
  return `unknown mode: ${cfg.mode}`;
}

function isSyncFile(name) {
  return /\.(csv|xlsx?)$/i.test(name) && !name.startsWith('.');
}

function fingerprintOf(name, size, mtime) {
  return `${name}::${size}::${mtime}`;
}

// --- persisted state -------------------------------------------------------

async function ensureSyncSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id SMALLINT PRIMARY KEY,
      source VARCHAR(30) NOT NULL DEFAULT 'none',
      enabled BOOLEAN NOT NULL DEFAULT false,
      interval_min INTEGER NOT NULL DEFAULT ${DEFAULT_INTERVAL_MIN},
      last_run_at TIMESTAMP,
      last_success_at TIMESTAMP,
      last_status VARCHAR(20),
      last_file VARCHAR(255),
      last_error TEXT,
      last_summary JSONB,
      consecutive_failures INTEGER NOT NULL DEFAULT 0
    )
  `);
  await pool.query(`INSERT INTO sync_state (id) VALUES (1) ON CONFLICT DO NOTHING`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_files (
      fingerprint VARCHAR(255) PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      source VARCHAR(30) NOT NULL DEFAULT 'sync',
      processed_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id SERIAL PRIMARY KEY,
      source VARCHAR(30),
      trigger VARCHAR(20),
      status VARCHAR(20),
      filename VARCHAR(255),
      total_rows INTEGER,
      added INTEGER DEFAULT 0,
      updated INTEGER DEFAULT 0,
      skipped INTEGER DEFAULT 0,
      duplicated INTEGER DEFAULT 0,
      rejected INTEGER DEFAULT 0,
      flagged INTEGER DEFAULT 0,
      errors JSONB,
      error TEXT,
      started_at TIMESTAMP DEFAULT NOW(),
      ended_at TIMESTAMP
    )
  `);
}

async function getState() {
  const { rows } = await pool.query('SELECT * FROM sync_state WHERE id = 1');
  return rows[0] || null;
}

async function patchState(patch) {
  const keys = Object.keys(patch);
  const cols = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await pool.query(`UPDATE sync_state SET ${cols} WHERE id = 1`, keys.map((k) => patch[k]));
}

async function fileProcessed(fingerprint, filename) {
  await pool.query(
    `INSERT INTO sync_files (fingerprint, filename) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [fingerprint, filename]
  );
}

// --- single-file processing ------------------------------------------------

async function processFsmBuffer({ buffer, filename, options = {} }) {
  const { headers, rawRows, fileType } = parseUpload(buffer, filename);
  if (!headers.length || !rawRows.length) {
    throw new Error('File appears to be empty or could not be parsed');
  }
  const mapping = autoMapColumns(headers);
  // A real FSM export must map to at least one recognized business column.
  // Anything else (a stray note file, logs, truncated garbage) is rejected up
  // front so a misconfigured pickup can never ingest junk rows.
  if (!Object.values(mapping || {}).length) {
    throw new Error('No recognizable FSM columns in this file — refusing to import');
  }
  const [s, c] = await Promise.all([
    pool.query('SELECT code, label FROM work_order_statuses WHERE is_active = true'),
    pool.query('SELECT code, label FROM work_order_channels WHERE is_active = true'),
  ]);
  // Sync push is a fire-and-forget ingest: it must never stomp dispatch-owned
  // fields (technician, team, contractor, resolved NAP/coordinates) on records
  // that already exist. Manual imports (preview/commit) are the only flow that
  // refreshes those. Appointment is handled by the latest-wins rule.
  const opts = {
    trustImportedCompletion: false,
    importWithoutNumber: true,
    preserveSyncedOverrides: true,
    ...options,
  };
  const { summary, errors } = await executeImport({
    headers,
    rawRows,
    mapping,
    statuses: s.rows,
    channels: c.rows,
    options: opts,
    actor: null,
    sourceFile: filename,
    batchId: null,
  });
  return { summary, errors, fileType, mapping, total_rows: rawRows.length };
}

// --- per-source pickup -----------------------------------------------------

async function sleepBackoff(attempt, base = [500, 2000, 8000]) {
  const ms = base[Math.min(attempt, base.length - 1)];
  await sleep(ms);
}

async function collectFolderFiles(cfg) {
  const dir = path.resolve(cfg.folder);
  await fs.promises.mkdir(dir, { recursive: true });
  const names = await fs.promises.readdir(dir);
  return names.filter(isSyncFile).map((name) => {
    const stat = fs.statSync(path.join(dir, name));
    return { name, size: stat.size, mtimeMs: stat.mtimeMs, abs: path.join(dir, name) };
  });
}

async function collectHttpFiles(cfg) {
  // Generic GET of a Globe-provided static export URL. Covers file-drop style
  // delivery without inventing an API contract.
  const res = await fetch(cfg.httpUrl, { method: 'GET' });
  if (!res.ok) throw new Error(`HTTP fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const name = cfg.httpUrl.split('/').filter(Boolean).pop() || 'fsm-http-export.csv';
  return [{
    name: `${name}::${new Date().toISOString().slice(0, 10)}::${res.headers.get('last-modified') || res.headers.get('etag') || 'url'}`,
    size: Buffer.byteLength(text),
    mtimeMs: Date.now(),
    buffer: Buffer.from(text, 'utf8'),
    fingerprintOverride: `${cfg.httpUrl}::${res.headers.get('last-modified') || res.headers.get('etag') || bufferFingerprint(text)}`,
  }];
}

function bufferFingerprint(text) {
  // Distinguish content without trusting headers.
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

async function syncSftpFiles(cfg) {
  const Sftp = require('ssh2-sftp-client');
  let client = null;
  let lastErr = null;
  for (let attempt = 0; attempt < cfg.sftp.retries; attempt++) {
    try {
      const c = new Sftp();
      const conn = {
        host: cfg.sftp.host,
        port: cfg.sftp.port,
        username: cfg.sftp.username,
      };
      if (cfg.sftp.privateKeyPath) conn.privateKey = fs.readFileSync(cfg.sftp.privateKeyPath, 'utf8');
      else conn.password = cfg.sftp.password || '';
      await c.connect(conn);
      client = c;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < cfg.sftp.retries - 1) await sleepBackoff(attempt);
    }
  }
  if (!client) throw lastErr || new Error('SFTP connect failed');

  try {
    const remoteFiles = await client.list(cfg.sftp.pickupPath);
    const files = remoteFiles
      .filter((f) => f.type === '-' && isSyncFile(f.name))
      .sort((a, b) => a.modifyTime - b.modifyTime)
      .map((f) => ({
        name: f.name,
        size: f.size,
        mtimeMs: f.modifyTime * 1000,
        sftpPath: path.posix.join(cfg.sftp.pickupPath, f.name),
        sftpArchive: cfg.sftp.archivePath ? path.posix.join(cfg.sftp.archivePath, f.name) : null,
      }));
    const out = [];
    for (const f of files) {
      const data = await client.get(f.sftpPath);
      out.push({ ...f, buffer: data });
    }
    return { client, files: out };
  } catch (err) {
    try { await client.end(); } catch (_) {}
    throw err;
  }
}

// --- the run ---------------------------------------------------------------

async function runFsmSync({ trigger = 'scheduler' } = {}) {
  if (running) {
    return { status: 'running', error: 'A sync run is already in progress' };
  }
  running = true;
  const startedAt = new Date();
  const result = {
    status: 'error',
    trigger,
    filenames: [],
    processed: [],
    skippedFiles: [],
    failures: [],
    summary: null,
    last_error: null,
  };

  try {
    await ensureSyncSchema();
    const cfg = fsmConfig();
    if (!isConfigured(cfg)) {
      await patchState({
        source: cfg.mode,
        enabled: false,
        interval_min: cfg.intervalMin,
        last_run_at: startedAt,
        last_status: 'disabled',
        last_error: configReason(cfg),
        consecutive_failures: 0,
      });
      result.status = 'disabled';
      result.last_error = configReason(cfg);
      return result;
    }

    await patchState({
      source: cfg.mode,
      enabled: true,
      interval_min: cfg.intervalMin,
      last_run_at: startedAt,
      last_status: 'running',
    });

    const collected = cfg.mode === 'sftp' ? await syncSftpFiles(cfg) : null;
    let candidates;
    let releaseSftp = async () => {};
    if (cfg.mode === 'folder') {
      candidates = await collectFolderFiles(cfg);
    } else if (cfg.mode === 'sftp') {
      candidates = collected.files;
      releaseSftp = async () => { try { await collected.client.end(); } catch (_) {} };
    } else {
      candidates = await collectHttpFiles(cfg);
    }

    for (const file of candidates) {
      const fp = file.fingerprintOverride || fingerprintOf(file.name, file.size, file.mtimeMs);
      const { rowCount } = await pool.query('SELECT 1 FROM sync_files WHERE fingerprint = $1', [fp]);
      if (rowCount) {
        result.skippedFiles.push(file.name);
        continue;
      }
      try {
        let buffer = file.buffer;
        if (buffer == null) buffer = await fs.promises.readFile(file.abs);
        const processed = await processFsmBuffer({ buffer, filename: file.name });
        await fileProcessed(fp, file.name);
        if (cfg.mode === 'sftp') {
          // Non-destructive by default: move to the archive folder when one is
          // configured, otherwise leave the file where it is. The fingerprint
          // prevents any re-processing, and a never-deleted original keeps the
          // drop safe for audits and manual repair.
          if (file.sftpArchive) {
            await collected.client.rename(file.sftpPath, file.sftpArchive);
          }
        } else if (cfg.mode === 'folder' && cfg.archiveFolder) {
          await fs.promises.mkdir(path.resolve(cfg.archiveFolder), { recursive: true });
          await fs.promises.rename(file.abs, path.join(path.resolve(cfg.archiveFolder), file.name)).catch(() => {});
        }
        result.processed.push({ file: file.name, summary: processed.summary });
        result.summary = result.summary || { added: 0, updated: 0, skipped: 0, duplicated: 0, rejected: 0, flagged: 0, total_rows: 0 };
        for (const k of ['added', 'updated', 'skipped', 'duplicated', 'rejected', 'flagged']) {
          result.summary[k] += processed.summary[k] || 0;
        }
        result.summary.total_rows += processed.total_rows || 0;
      } catch (err) {
        result.failures.push({ file: file.name, error: err.message });
      }
    }
    await releaseSftp();

    if (result.failures.length && result.processed.length === 0) {
      result.status = 'error';
      result.last_error = result.failures.map((f) => `${f.file}: ${f.error}`).join(' | ');
    } else if (result.failures.length) {
      result.status = 'partial';
      result.last_error = result.failures.map((f) => `${f.file}: ${f.error}`).join(' | ');
    } else {
      result.status = 'ok';
      result.last_error = null;
    }
  } catch (err) {
    result.status = 'error';
    result.last_error = err.message;
  } finally {
    const endedAt = new Date();
    result.filenames = result.processed.map((p) => p.file).concat(result.failures.map((f) => f.file));

    try {
      await pool.query(
        `INSERT INTO sync_log
           (source, trigger, status, filename, total_rows, added, updated, skipped,
            duplicated, rejected, flagged, errors, error, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          result.status === 'disabled' ? fsmConfig().mode : (fsmConfig().mode || 'sync'),
          result.trigger,
          result.status,
          result.filenames.join(', ') || null,
          result.summary ? result.summary.total_rows || 0 : 0,
          result.summary ? result.summary.added : 0,
          result.summary ? result.summary.updated : 0,
          result.summary ? result.summary.skipped : 0,
          result.summary ? result.summary.duplicated : 0,
          result.summary ? result.summary.rejected : 0,
          result.summary ? result.summary.flagged : 0,
          JSON.stringify(result.failures),
          result.last_error,
          startedAt,
          endedAt,
        ]
      );

      const prev = await getState();
      const consecutive =
        result.status === 'ok' || result.status === 'disabled'
          ? 0
          : (prev ? prev.consecutive_failures : 0) + 1;
      const patch = {
        last_status: result.status,
        last_error: result.last_error,
        last_file:
          (result.processed[result.processed.length - 1] || {}).file ||
          (result.failures[0] || {}).file ||
          null,
        last_summary: JSON.stringify(result.summary),
        consecutive_failures: consecutive,
      };
      // Only update last_success_at on a successful run; never clear it on a
      // later partial/error run so the UI still shows when it last succeeded.
      if (result.status === 'ok') patch.last_success_at = new Date();
      await patchState(patch);
    } catch (stateErr) {
      result.last_error = (result.last_error ? result.last_error + ' | ' : '') + `state write failed: ${stateErr.message}`;
    }

    running = false;
  }
  return result;
}

async function getSyncStatus() {
  await ensureSyncSchema();
  const cfg = fsmConfig();
  const state = await getState();
  const recent = await pool.query(
    `SELECT id, source, trigger, status, filename, total_rows, added, updated, skipped,
            duplicated, rejected, flagged, error, errors, started_at, ended_at
       FROM sync_log ORDER BY id DESC LIMIT 10`
  );
  const configured = isConfigured(cfg);
  const lastRunAt = state && state.last_run_at;
  const nextRunAt =
    configured && state && lastRunAt
      ? new Date(new Date(lastRunAt).getTime() + (cfg.intervalMin || DEFAULT_INTERVAL_MIN) * 60 * 1000)
      : null;
  return {
    enabled: cfg.enabled,
    configured,
    mode: cfg.mode,
    reason: configReason(cfg),
    interval_min: cfg.intervalMin,
    running,
    last_run_at: lastRunAt,
    last_success_at: state && state.last_success_at,
    last_status: state && state.last_status,
    last_error: state && state.last_error,
    last_file: state && state.last_file,
    consecutive_failures: state ? state.consecutive_failures : 0,
    next_run_at: nextRunAt,
    last_summary: state && state.last_summary,
    recent_logs: recent.rows,
  };
}

function scheduleFsmSync() {
  const cfg = fsmConfig();
  if (!cfg.enabled) {
    console.log('[fsm-sync] disabled (set FSM_SYNC_ENABLED=true).');
    return;
  }
  const delayMs = cfg.intervalMin * 60 * 1000;
  const startupMs = process.env.FSM_SYNC_STARTUP_DELAY_MIN
    ? parseInt(process.env.FSM_SYNC_STARTUP_DELAY_MIN, 10) * 60 * 1000
    : 30 * 1000;
  setTimeout(() => runFsmSync({ trigger: 'startup' }).catch(() => {}), startupMs);
  setInterval(() => runFsmSync({ trigger: 'scheduler' }).catch(() => {}), delayMs);
  console.log(`[fsm-sync] scheduled every ${cfg.intervalMin} min (mode=${cfg.mode}).`);
}

module.exports = {
  fsmConfig,
  isConfigured,
  configReason,
  runFsmSync,
  getSyncStatus,
  processFsmBuffer,
  scheduleFsmSync,
  ensureSyncSchema,
};