const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../config/database');
const { optionalAuth } = require('../middleware/auth');
const { buildFilters, buildOrderBy } = require('../utils/workOrderQuery');
const { parseUpload, analyzeImport, executeImport } = require('../utils/workOrderImport');
const { autoMapColumns } = require('../utils/workOrderFields');

const upload = multer({
  storage: multer.memoryStorage(),
  // FSM extraction exports run ~20MB; default to 60MB so they aren't rejected.
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 60 * 1024 * 1024 },
});

async function loadConfig() {
  const [s, c] = await Promise.all([
    pool.query('SELECT code, label FROM work_order_statuses WHERE is_active = true'),
    pool.query('SELECT code, label FROM work_order_channels WHERE is_active = true'),
  ]);
  return { statuses: s.rows, channels: c.rows };
}

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function stripRowForPreview(row) {
  return {
    rowNumber: row.rowNumber,
    action: row.action,
    disposition_action: row.disposition_action,
    data: row.data,
    nap: row.nap,
    extras: row.extras,
    errors: row.errors,
    warnings: row.warnings,
    existing_id: row.existing_id,
    disposition_review: row.disposition_review,
  };
}

// Preview an uploaded file without writing any work orders.
router.post('/import/preview', optionalAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { headers, rawRows, fileType } = parseUpload(req.file.buffer, req.file.originalname);
    if (headers.length === 0 || rawRows.length === 0) {
      return res.status(400).json({ error: 'The file appears to be empty or could not be parsed' });
    }

    const suggested = autoMapColumns(headers);
    const userMapping = parseJsonField(req.body.mapping, null);
    const mapping = userMapping || suggested;
    const options = parseJsonField(req.body.options, {});
    const { statuses, channels } = await loadConfig();

    const { rows, summary } = await analyzeImport({
      headers, rawRows, mapping, statuses, channels, options,
    });

    // Persist the parsed file so commit does not require re-uploading.
    const batch = await pool.query(
      `INSERT INTO import_batches
        (filename, file_type, status, total_rows, column_mapping, raw_data, options, uploaded_by)
       VALUES ($1, $2, 'preview', $3, $4, $5, $6, $7) RETURNING id`,
      [
        req.file.originalname, fileType, rawRows.length,
        JSON.stringify({ mapping, suggested }),
        JSON.stringify({ headers, rawRows }),
        JSON.stringify({ ...options, disposition_summary: summary.disposition }),
        req.user ? req.user.id : null,
      ]
    );

    res.json({
      batch_id: batch.rows[0].id,
      filename: req.file.originalname,
      file_type: fileType,
      headers,
      mapping,
      suggested_mapping: suggested,
      summary,
      sample: rows.slice(0, 200).map(stripRowForPreview),
      total_rows: rawRows.length,
    });
  } catch (error) {
    console.error('import preview error:', error);
    res.status(500).json({ error: 'Failed to analyze the uploaded file', detail: error.message });
  }
});

// Commit a previously previewed batch.
router.post('/import/:batchId/commit', optionalAuth, async (req, res) => {
  const batchId = parseInt(req.params.batchId, 10);
  try {
    const { rows: batches } = await pool.query('SELECT * FROM import_batches WHERE id = $1', [batchId]);
    if (batches.length === 0) return res.status(404).json({ error: 'Import batch not found' });
    const batch = batches[0];
    if (batch.status === 'committed') {
      return res.status(409).json({ error: 'This import has already been committed' });
    }

    const stored = batch.raw_data || {};
    const headers = stored.headers || [];
    const rawRows = stored.rawRows || [];

    const userMapping = parseJsonField(req.body.mapping, null);
    const mapping = userMapping || (batch.column_mapping && batch.column_mapping.mapping) || {};
    const options = parseJsonField(req.body.options, batch.options || {});
    const { statuses, channels } = await loadConfig();

    const { summary, errors } = await executeImport({
      headers, rawRows, mapping, statuses, channels, options,
      actor: req.user, sourceFile: batch.filename, batchId,
    });

    await pool.query(
      `UPDATE import_batches SET
         status = 'committed',
         added = $2, updated = $3, skipped = $4, duplicated = $5, rejected = $6, flagged = $7,
         column_mapping = $8, errors = $9, options = $10, finished_at = NOW(),
         raw_data = NULL
       WHERE id = $1`,
      [
        batchId, summary.added, summary.updated, summary.skipped, summary.duplicated,
        summary.rejected, summary.flagged,
        JSON.stringify({ ...(batch.column_mapping || {}), mapping }),
        JSON.stringify(errors),
        JSON.stringify({ ...options, disposition_summary: summary.disposition }),
      ]
    );

    res.json({ success: true, batch_id: batchId, summary, errors });
  } catch (error) {
    console.error('import commit error:', error);
    res.status(500).json({ error: 'Failed to import the file', detail: error.message });
  }
});

// List import history
router.get('/import/batches', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, file_type, status, total_rows, added, updated, skipped,
              duplicated, rejected, flagged, created_at, finished_at
         FROM import_batches ORDER BY created_at DESC LIMIT 100`
    );
    res.json({ batches: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load import history' });
  }
});

// Export filtered work orders (csv or xlsx)
router.get('/export', async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    const { where, params } = buildFilters(req.query);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = buildOrderBy(req.query);
    const limit = Math.min(parseInt(req.query.limit, 10) || 20000, 50000);

    const { rows } = await pool.query(
      `SELECT work_order_number, customer_name, customer_address, customer_contact,
              nap_id, latitude, longitude, coordinate_source, nap_match_status,
              coord_conflict, area, territory, barangay, facility, plan_type,
              service_type, priority, status, original_status, source_channel,
              assigned_technician, assigned_team, contractor, appointment,
              dispatch_notes, delay_reason,
              completion_notes, date_created, last_updated, completion_date,
              source_file, created_at, updated_at
         FROM work_orders wo ${w}
         ORDER BY ${orderBy}
         LIMIT ${limit}`,
      params
    );

    const data = rows.map((r) => ({
      ...r,
      latitude: r.latitude != null ? Number(r.latitude) : '',
      longitude: r.longitude != null ? Number(r.longitude) : '',
    }));

    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Work Orders');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="work_orders_${stamp}.xlsx"`);
      return res.send(buf);
    }

    const ws = XLSX.utils.json_to_sheet(data);
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="work_orders_${stamp}.csv"`);
    return res.send('\uFEFF' + csv);
  } catch (error) {
    console.error('export error:', error);
    res.status(500).json({ error: 'Failed to export work orders' });
  }
});

module.exports = router;
