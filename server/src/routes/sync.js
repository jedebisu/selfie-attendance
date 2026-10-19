const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const {
  fsmConfig,
  isConfigured,
  configReason,
  runFsmSync,
  getSyncStatus,
  processFsmBuffer,
} = require('../utils/fsmSync');

const upload = multer({
  storage: multer.memoryStorage(),
  // FSM extraction exports run ~20MB; default to 60MB so they aren't rejected.
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 60 * 1024 * 1024 },
});

// Current sync state (enabled/configured, last run, next run, recent log).
// Auth required: status includes error text that can name infrastructure
// (SFTP host / folder paths), which should not be visible to anonymous callers.
router.get('/', authenticateToken, async (req, res) => {
  try {
    res.json({ success: true, ...(await getSyncStatus()) });
  } catch (error) {
    console.error('sync status error:', error);
    res.status(500).json({ error: 'Failed to load sync status', detail: error.message });
  }
});

// Manual retry: run the pickup now, regardless of schedule.
router.post('/run', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const cfg = fsmConfig();
    if (!isConfigured(cfg)) {
      // Return a plain reason string, never the raw config (it contains the
      // SFTP password / private key / credentials).
      return res.status(409).json({ error: 'FSM sync is not configured', reason: configReason(cfg) });
    }
    const result = await runFsmSync({ trigger: 'manual' });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('sync run error:', error);
    res.status(500).json({ error: 'Failed to run sync', detail: error.message });
  }
});

// Manual file drop: process an FSM export immediately (commit on upload).
router.post('/upload', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const startedAt = new Date();
    const processed = await processFsmBuffer({
      buffer: req.file.buffer,
      filename: req.file.originalname,
    });

    await pool.query(
      `INSERT INTO sync_log
         (source, trigger, status, filename, total_rows, added, updated, skipped,
          duplicated, rejected, flagged, errors, error, started_at, ended_at)
       VALUES ($1, 'upload', 'ok', $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, NOW())`,
      [
        'upload',
        req.file.originalname,
        processed.total_rows,
        processed.summary.added,
        processed.summary.updated,
        processed.summary.skipped,
        processed.summary.duplicated,
        processed.summary.rejected,
        processed.summary.flagged,
        JSON.stringify(processed.errors),
        startedAt,
      ]
    );
    await pool.query(
      `UPDATE sync_state SET last_run_at = $1, last_status = 'ok', last_error = NULL,
         last_file = $2, last_summary = $3, consecutive_failures = 0, last_success_at = $1
       WHERE id = 1`,
      [startedAt, req.file.originalname, JSON.stringify(processed.summary)]
    );

    res.json({ success: true, summary: processed.summary, errors: processed.errors });
  } catch (error) {
    console.error('sync upload error:', error);
    res.status(500).json({ error: 'Failed to upload file for sync', detail: error.message });
  }
});

// Recent sync run log.
router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
    const { rows } = await pool.query(
      `SELECT id, source, trigger, status, filename, total_rows, added, updated,
              skipped, duplicated, rejected, flagged, error, errors, started_at, ended_at
         FROM sync_log ORDER BY id DESC LIMIT $1`,
      [limit]
    );
    res.json({ success: true, logs: rows });
  } catch (error) {
    console.error('sync logs error:', error);
    res.status(500).json({ error: 'Failed to load sync logs', detail: error.message });
  }
});

// Clear processed-file fingerprints so the next run re-pulls everything.
router.post('/rewind', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await pool.query('TRUNCATE sync_files');
    res.json({ success: true, message: 'Processed-file fingerprints cleared; next run will re-pull.' });
  } catch (error) {
    console.error('sync rewind error:', error);
    res.status(500).json({ error: 'Failed to rewind sync', detail: error.message });
  }
});

module.exports = router;