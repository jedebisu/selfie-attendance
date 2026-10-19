const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { authenticateToken, optionalAuth, requireAdmin } = require('../middleware/auth');
const { buildFilters, buildOrderBy, manilaToday } = require('../utils/workOrderQuery');
const { addHistory } = require('../utils/workOrderImport');

const EDITABLE_FIELDS = [
  'customer_name', 'customer_address', 'customer_contact', 'nap_id', 'area',
  'territory', 'barangay', 'facility', 'plan_type', 'service_type', 'priority',
  'assigned_technician', 'assigned_team', 'dispatch_notes', 'delay_reason',
  'completion_notes', 'contractor', 'appointment',
  'date_created', 'last_updated', 'completion_date',
];

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validCoord(lat, lng) {
  if (lat === null || lng === null) return true; // partial clearing allowed
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

async function loadStatuses() {
  const { rows } = await pool.query('SELECT * FROM work_order_statuses WHERE is_active = true ORDER BY sort_order');
  return rows;
}
async function loadChannels() {
  const { rows } = await pool.query('SELECT * FROM work_order_channels WHERE is_active = true ORDER BY sort_order');
  return rows;
}

// ---------------------------------------------------------------- static routes

// Distinct filter option values
router.get('/filter-options', async (req, res) => {
  try {
    const [areas, territories, barangays, techs] = await Promise.all([
      pool.query(`SELECT DISTINCT area FROM work_orders WHERE area IS NOT NULL AND deleted_at IS NULL ORDER BY area LIMIT 5000`),
      pool.query(`SELECT DISTINCT territory FROM work_orders WHERE territory IS NOT NULL AND deleted_at IS NULL ORDER BY territory LIMIT 5000`),
      pool.query(`SELECT DISTINCT barangay FROM work_orders WHERE barangay IS NOT NULL AND deleted_at IS NULL ORDER BY barangay LIMIT 5000`),
      pool.query(`SELECT DISTINCT assigned_technician FROM work_orders WHERE assigned_technician IS NOT NULL AND deleted_at IS NULL ORDER BY assigned_technician LIMIT 5000`),
    ]);
    const [statuses, channels] = await Promise.all([loadStatuses(), loadChannels()]);
    res.json({
      areas: areas.rows.map((r) => r.area),
      territories: territories.rows.map((r) => r.territory),
      barangays: barangays.rows.map((r) => r.barangay),
      technicians: techs.rows.map((r) => r.assigned_technician),
      statuses,
      channels,
    });
  } catch (error) {
    console.error('filter-options error:', error);
    res.status(500).json({ error: 'Failed to load filter options' });
  }
});

// Dashboard statistics (calculated from stored records, respects filters)
router.get('/stats', async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Today (Asia/Manila) — appended as an extra bind parameter for the
    // overdue aggregates in the area/territory breakdowns.
    const today = manilaToday();

    const totalsQ = pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(DISTINCT wo.nap_id)::int AS unique_naps,
         COUNT(*) FILTER (WHERE wo.latitude IS NULL OR wo.longitude IS NULL)::int AS unmapped,
         COUNT(*) FILTER (WHERE wo.latitude IS NOT NULL AND wo.longitude IS NOT NULL)::int AS mapped,
         COUNT(*) FILTER (WHERE wo.source_channel IS NULL)::int AS no_channel,
         COUNT(*) FILTER (WHERE wo.coord_conflict = true)::int AS coord_conflict,
         COUNT(*) FILTER (WHERE wo.nap_match_status = 'not_found')::int AS nap_not_found,
         COUNT(*) FILTER (WHERE wo.nap_id IS NULL)::int AS no_nap_id
       FROM work_orders wo ${w}`,
      params
    );

    const statusQ = pool.query(
      `SELECT wo.status, COUNT(*)::int AS count
         FROM work_orders wo ${w}
        GROUP BY wo.status`,
      params
    );

    const channelQ = pool.query(
      `SELECT COALESCE(wo.source_channel, 'UNASSIGNED') AS channel, COUNT(*)::int AS count
         FROM work_orders wo ${w}
        GROUP BY COALESCE(wo.source_channel, 'UNASSIGNED')`,
      params
    );

    const areaQ = pool.query(
      `SELECT COALESCE(wo.area, 'Unassigned') AS area,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE wo.status = 'COMPLETED')::int AS completed,
              COUNT(*) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED','FAILED') AND wo.status <> 'DELAYED' AND wo.status <> 'ON HOLD')::int AS pending,
              COUNT(*) FILTER (WHERE wo.status = 'DELAYED')::int AS delayed,
              COUNT(*) FILTER (WHERE wo.status = 'ON HOLD')::int AS on_hold,
              COUNT(*) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED','FAILED') AND wo.appointment IS NOT NULL AND wo.appointment < $${params.length + 1})::int AS overdue
         FROM work_orders wo ${w}
        GROUP BY COALESCE(wo.area, 'Unassigned')
        ORDER BY count DESC LIMIT 15`,
      [...params, today]
    );

    const terrQ = pool.query(
      `SELECT COALESCE(wo.territory, 'Unassigned') AS territory,
              COUNT(*)::int AS count,
              COUNT(*) FILTER (WHERE wo.status = 'COMPLETED')::int AS completed,
              COUNT(*) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED','FAILED') AND wo.status <> 'DELAYED' AND wo.status <> 'ON HOLD')::int AS pending,
              COUNT(*) FILTER (WHERE wo.status = 'DELAYED')::int AS delayed,
              COUNT(*) FILTER (WHERE wo.status = 'ON HOLD')::int AS on_hold,
              COUNT(*) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED','FAILED') AND wo.appointment IS NOT NULL AND wo.appointment < $${params.length + 1})::int AS overdue
         FROM work_orders wo ${w}
        GROUP BY COALESCE(wo.territory, 'Unassigned')
        ORDER BY count DESC LIMIT 15`,
      [...params, today]
    );

    const napQ = pool.query(
      `SELECT wo.nap_id, COUNT(*)::int AS count
         FROM work_orders wo ${w}
        ${where.length ? 'AND' : 'WHERE'} wo.nap_id IS NOT NULL
        GROUP BY wo.nap_id
        ORDER BY count DESC LIMIT 15`,
      params
    );

    const [totals, status, channel, area, terr, nap] = await Promise.all([
      totalsQ, statusQ, channelQ, areaQ, terrQ, napQ,
    ]);

    const statusCounts = {};
    for (const r of status.rows) statusCounts[r.status || 'NEW'] = r.count;

    const total = totals.rows[0].total || 0;
    const completed = statusCounts.COMPLETED || 0;

    res.json({
      totals: {
        ...totals.rows[0],
        completion_rate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
      },
      by_status: statusCounts,
      by_channel: channel.rows,
      by_area: area.rows,
      by_territory: terr.rows,
      top_naps: nap.rows,
    });
  } catch (error) {
    console.error('stats error:', error);
    res.status(500).json({ error: 'Failed to compute statistics' });
  }
});

// Trend over time (daily | weekly | monthly) based on created date
router.get('/trends', async (req, res) => {
  try {
    const granularity = ['day', 'week', 'month'].includes(req.query.granularity)
      ? req.query.granularity
      : 'day';
    const { where, params } = buildFilters(req.query);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const today = manilaToday();
    const { rows } = await pool.query(
      `SELECT
         date_trunc('${granularity}', COALESCE(wo.date_created, wo.created_at)) AS bucket,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE wo.status = 'COMPLETED')::int AS completed,
         COUNT(*) FILTER (WHERE wo.status = 'DELAYED')::int AS delayed,
         COUNT(*) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED','FAILED') AND wo.status <> 'DELAYED' AND wo.status <> 'ON HOLD')::int AS pending,
         COUNT(*) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED','FAILED') AND wo.appointment IS NOT NULL AND wo.appointment < $${params.length + 1})::int AS overdue
       FROM work_orders wo ${w}
       GROUP BY bucket
       ORDER BY bucket ASC
       LIMIT 400`,
      [...params, today]
    );
    res.json({ granularity, trends: rows });
  } catch (error) {
    console.error('trends error:', error);
    res.status(500).json({ error: 'Failed to compute trends' });
  }
});

// NAP ID groups
router.get('/nap-groups', async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortMap = {
      volume: 'total',
      pending: 'pending',
      delayed: 'delayed',
      completed: 'completed',
      nap_id: 'wo.nap_id',
    };
    const sortCol = sortMap[req.query.sort_by] || 'total';
    const dir = (req.query.sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 500);
    const offset = (page - 1) * limit;
    const np = params.length + 1;

    const countQ = pool.query(
      `SELECT COUNT(DISTINCT wo.nap_id)::int AS total
         FROM work_orders wo
         ${w} ${where.length ? 'AND' : 'WHERE'} wo.nap_id IS NOT NULL`,
      params
    );
    const dataQ = pool.query(
      `SELECT
         wo.nap_id,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE wo.status = 'COMPLETED')::int AS completed,
         COUNT(*) FILTER (WHERE wo.status NOT IN ('COMPLETED','CANCELLED','FAILED'))::int AS pending,
         COUNT(*) FILTER (WHERE wo.status = 'DELAYED')::int AS delayed,
         COUNT(*) FILTER (WHERE wo.latitude IS NULL OR wo.longitude IS NULL)::int AS unmapped,
         MAX(wo.latitude) AS lat,
         MAX(wo.longitude) AS lng,
         MIN(wo.latitude) AS min_lat,
         MIN(wo.longitude) AS min_lng,
         COUNT(DISTINCT (ROUND(wo.latitude::numeric, 5), ROUND(wo.longitude::numeric, 5)))::int AS coord_variants,
         COUNT(*) FILTER (WHERE wo.coord_conflict = true)::int AS conflicted,
         COUNT(*) FILTER (WHERE wo.nap_match_status = 'not_found')::int AS nap_missing,
         MAX(n.building_served) AS building_served,
         MAX(n.city_name) AS city_name,
         MAX(n.province_name) AS province_name,
         MAX(n.barangay_name) AS nap_barangay,
         MAX(n.dp_nap_lat) AS nap_lat,
         MAX(n.dp_nap_long) AS nap_lng,
         (MAX(n.nap_id) IS NOT NULL) AS nap_exists
       FROM work_orders wo
       LEFT JOIN naps n ON n.nap_id = wo.nap_id
       ${w} ${where.length ? 'AND' : 'WHERE'} wo.nap_id IS NOT NULL
       GROUP BY wo.nap_id
       ORDER BY ${sortCol} ${dir} NULLS LAST
       LIMIT $${np} OFFSET $${np + 1}`,
      [...params, limit, offset]
    );

    const [count, data] = await Promise.all([countQ, dataQ]);
    const total = count.rows[0].total;
    res.json({ count: data.rows.length, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), groups: data.rows });
  } catch (error) {
    console.error('nap-groups error:', error);
    res.status(500).json({ error: 'Failed to group by NAP ID' });
  }
});

// Single NAP group detail (work orders + NAP DB record)
router.get('/nap-groups/:napId', async (req, res) => {
  try {
    const napId = req.params.napId;
    const [napQ, woQ] = await Promise.all([
      pool.query(`SELECT * FROM naps WHERE nap_id = $1 OR UPPER(nap_id) = UPPER($1) LIMIT 1`, [napId]),
      pool.query(
        `SELECT wo.*, c.color AS channel_color, s.color AS status_color, s.label AS status_label
           FROM work_orders wo
           LEFT JOIN work_order_channels c ON c.code = wo.source_channel
           LEFT JOIN work_order_statuses s ON s.code = wo.status
          WHERE wo.nap_id = $1 AND wo.deleted_at IS NULL
          ORDER BY wo.updated_at DESC`,
        [napId]
      ),
    ]);
    res.json({
      nap_id: napId,
      nap: napQ.rows[0] || null,
      nap_exists: napQ.rows.length > 0,
      work_orders: woQ.rows,
    });
  } catch (error) {
    console.error('nap-group detail error:', error);
    res.status(500).json({ error: 'Failed to load NAP group' });
  }
});

// Generic grouping for the dispatch board
router.get('/group', async (req, res) => {
  try {
    const dims = {
      nap_id: 'wo.nap_id',
      area: 'wo.area',
      territory: 'wo.territory',
      barangay: 'wo.barangay',
      source_channel: 'wo.source_channel',
      status: 'wo.status',
      assigned_technician: 'wo.assigned_technician',
    };
    const col = dims[req.query.by];
    if (!col) return res.status(400).json({ error: 'Invalid group dimension' });

    const { where, params } = buildFilters(req.query);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT COALESCE(${col}, 'Unassigned') AS key, COUNT(*)::int AS count
         FROM work_orders wo ${w}
        GROUP BY COALESCE(${col}, 'Unassigned')
        ORDER BY count DESC LIMIT 200`,
      params
    );
    res.json({ by: req.query.by, groups: rows });
  } catch (error) {
    console.error('group error:', error);
    res.status(500).json({ error: 'Failed to group work orders' });
  }
});

// Unmapped work orders (no valid coordinates) - never fabricated on the map
router.get('/unmapped', async (req, res) => {
  try {
    const { where, params } = buildFilters({ ...req.query, unmapped: 'true' });
    const w = `WHERE ${where.join(' AND ')}`;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
    const { rows } = await pool.query(
      `SELECT wo.* FROM work_orders wo ${w} ORDER BY wo.updated_at DESC LIMIT ${limit}`,
      params
    );
    res.json({ count: rows.length, work_orders: rows });
  } catch (error) {
    console.error('unmapped error:', error);
    res.status(500).json({ error: 'Failed to load unmapped work orders' });
  }
});

// Review queue: data integrity exceptions needing manual attention
router.get('/review-queue', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const [notFound, conflicts, noNap, unmapped, noChannel, napNoCoords] = await Promise.all([
      pool.query(
        `SELECT wo.* FROM work_orders wo WHERE wo.deleted_at IS NULL AND wo.nap_match_status = 'not_found' ORDER BY wo.updated_at DESC LIMIT ${limit}`
      ),
      pool.query(
        `SELECT wo.* FROM work_orders wo WHERE wo.deleted_at IS NULL AND wo.coord_conflict = true ORDER BY wo.coord_diff_meters DESC NULLS LAST LIMIT ${limit}`
      ),
      pool.query(
        `SELECT wo.* FROM work_orders wo WHERE wo.deleted_at IS NULL AND wo.nap_id IS NULL ORDER BY wo.updated_at DESC LIMIT ${limit}`
      ),
      pool.query(
        `SELECT wo.* FROM work_orders wo WHERE wo.deleted_at IS NULL AND (wo.latitude IS NULL OR wo.longitude IS NULL) ORDER BY wo.updated_at DESC LIMIT ${limit}`
      ),
      pool.query(
        `SELECT wo.* FROM work_orders wo WHERE wo.deleted_at IS NULL AND wo.source_channel IS NULL ORDER BY wo.updated_at DESC LIMIT ${limit}`
      ),
      pool.query(
        `SELECT wo.* FROM work_orders wo WHERE wo.deleted_at IS NULL AND wo.nap_match_status = 'matched_no_coords' ORDER BY wo.updated_at DESC LIMIT ${limit}`
      ),
    ]);
    res.json({
      nap_not_found: notFound.rows,
      coordinate_conflicts: conflicts.rows,
      missing_nap_id: noNap.rows,
      unmapped: unmapped.rows,
      missing_channel: noChannel.rows,
      nap_without_coords: napNoCoords.rows,
    });
  } catch (error) {
    console.error('review-queue error:', error);
    res.status(500).json({ error: 'Failed to load review queue' });
  }
});

// Bulk actions
router.post('/bulk', optionalAuth, async (req, res) => {
  const { ids, action, value, note, delay_reason, completion_notes } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No work orders selected' });
  }
  const validIds = ids.map((i) => parseInt(i, 10)).filter(Number.isFinite);
  if (validIds.length === 0) return res.status(400).json({ error: 'Invalid selection' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (action === 'status') {
      const { rows: st } = await client.query('SELECT code FROM work_order_statuses WHERE code = $1', [value]);
      if (st.length === 0) throw Object.assign(new Error('Unknown status'), { statusCode: 400 });
      const { rows: affected } = await client.query(
        'SELECT id, status FROM work_orders WHERE id = ANY($1) AND deleted_at IS NULL',
        [validIds]
      );
      await client.query(
        `UPDATE work_orders SET
           status = $2::varchar(30), status_source = 'manual', updated_at = NOW(),
           completion_date = CASE WHEN $2::text = 'COMPLETED' THEN COALESCE(completion_date, NOW()) ELSE completion_date END,
           delay_reason = CASE WHEN $2::text = 'DELAYED' THEN COALESCE($3::text, delay_reason) ELSE delay_reason END,
           completion_notes = CASE WHEN $2::text = 'COMPLETED' THEN COALESCE($4::text, completion_notes) ELSE completion_notes END
         WHERE id = ANY($1) AND deleted_at IS NULL`,
        [validIds, value, delay_reason || null, completion_notes || null]
      );
      for (const row of affected) {
        if (row.status !== value) {
          await addHistory(client, row.id, {
            action: 'status_change', field: 'status', oldValue: row.status, newValue: value,
            note: note || 'Bulk status update', actor: req.user,
          });
        }
      }
    } else if (action === 'channel') {
      const { rows: ch } = await client.query('SELECT code FROM work_order_channels WHERE code = $1', [value]);
      if (ch.length === 0) throw Object.assign(new Error('Unknown channel'), { statusCode: 400 });
      const { rows: affected } = await client.query(
        'SELECT id, source_channel FROM work_orders WHERE id = ANY($1) AND deleted_at IS NULL',
        [validIds]
      );
      await client.query(
        `UPDATE work_orders SET source_channel = $2, channel_source = 'manual', updated_at = NOW()
          WHERE id = ANY($1) AND deleted_at IS NULL`,
        [validIds, value]
      );
      for (const row of affected) {
        await addHistory(client, row.id, {
          action: 'channel_change', field: 'source_channel', oldValue: row.source_channel,
          newValue: value, note: note || 'Bulk channel assignment', actor: req.user,
        });
      }
    } else if (action === 'technician') {
      const { rows: affected } = await client.query(
        'SELECT id, assigned_technician FROM work_orders WHERE id = ANY($1) AND deleted_at IS NULL',
        [validIds]
      );
      await client.query(
        `UPDATE work_orders SET assigned_technician = $2, updated_at = NOW()
          WHERE id = ANY($1) AND deleted_at IS NULL`,
        [validIds, value || null]
      );
      for (const row of affected) {
        await addHistory(client, row.id, {
          action: 'assignment', field: 'assigned_technician', oldValue: row.assigned_technician,
          newValue: value || null, note: note || 'Bulk assignment', actor: req.user,
        });
      }
    } else {
      throw Object.assign(new Error('Unsupported bulk action'), { statusCode: 400 });
    }

    await client.query('COMMIT');
    res.json({ success: true, affected: validIds.length });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(error.statusCode || 500).json({ error: error.message || 'Bulk update failed' });
  } finally {
    client.release();
  }
});

// List work orders
router.get('/', async (req, res) => {
  try {
    const { where, params } = buildFilters(req.query);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = buildOrderBy(req.query);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = (page - 1) * limit;

    const countQ = pool.query(`SELECT COUNT(*)::int AS total FROM work_orders wo ${w}`, params);
    const dataQ = pool.query(
      `SELECT wo.*, c.color AS channel_color, s.color AS status_color, s.label AS status_label
         FROM work_orders wo
         LEFT JOIN work_order_channels c ON c.code = wo.source_channel
         LEFT JOIN work_order_statuses s ON s.code = wo.status
         ${w}
         ORDER BY ${orderBy}
         LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [count, data] = await Promise.all([countQ, dataQ]);
    res.json({
      total: count.rows[0].total,
      page,
      limit,
      pages: Math.ceil(count.rows[0].total / limit),
      work_orders: data.rows,
    });
  } catch (error) {
    console.error('list work orders error:', error);
    res.status(500).json({ error: 'Failed to load work orders' });
  }
});

// ------------------------------------------------------------------ clear all

function clearAllEnabled() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_CLEAR_ALL !== '1') {
    return false;
  }
  return true;
}

router.get('/clear-all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM work_orders');
    res.json({
      enabled: clearAllEnabled(),
      total: rows[0].total,
      env: process.env.NODE_ENV || 'development',
      reason: clearAllEnabled()
        ? null
        : 'Clearing all work orders is disabled in this environment (production). Set ALLOW_CLEAR_ALL=1 to enable.',
    });
  } catch (error) {
    console.error('clear-all preview error:', error);
    res.status(500).json({ error: 'Failed to load work order count' });
  }
});

router.post('/clear-all', authenticateToken, requireAdmin, async (req, res) => {
  if (!clearAllEnabled()) {
    return res.status(403).json({ error: 'Clearing all work orders is disabled in this environment.' });
  }
  const { confirmation, count } = req.body || {};
  if (typeof confirmation !== 'string' || confirmation.trim().toUpperCase() !== 'CLEAR ALL WORK ORDERS') {
    return res.status(400).json({ error: 'Confirmation text does not match. Type CLEAR ALL WORK ORDERS exactly.' });
  }
  const expected = Number.parseInt(count, 10);
  if (!Number.isInteger(expected) || expected < 0) {
    return res.status(400).json({ error: 'Invalid "count" — pass the total from the preview endpoint.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT COUNT(*)::int AS total FROM work_orders');
    if (rows[0].total !== expected) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Work order count changed since preview (now ${rows[0].total}). Refresh and try again — nothing was cleared.`,
      });
    }
    const del = await client.query('DELETE FROM work_orders');
    await client.query('COMMIT');
    return res.json({ success: true, deleted: del.rowCount });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('clear-all error:', error);
    return res.status(500).json({ error: 'Failed to clear work orders. No records were removed.' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------- param routes

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wo.*, c.color AS channel_color, s.color AS status_color, s.label AS status_label
         FROM work_orders wo
         LEFT JOIN work_order_channels c ON c.code = wo.source_channel
         LEFT JOIN work_order_statuses s ON s.code = wo.status
        WHERE wo.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });

    const nap = rows[0].nap_id
      ? (await pool.query('SELECT * FROM naps WHERE nap_id = $1 OR UPPER(nap_id)=UPPER($1) LIMIT 1', [rows[0].nap_id])).rows[0] || null
      : null;

    const history = (
      await pool.query('SELECT * FROM work_order_history WHERE work_order_id = $1 ORDER BY created_at DESC LIMIT 200', [req.params.id])
    ).rows;

    res.json({ work_order: rows[0], nap, history });
  } catch (error) {
    console.error('get work order error:', error);
    res.status(500).json({ error: 'Failed to load work order' });
  }
});

// Update editable fields
router.patch('/:id', optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body || {};
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM work_orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });
    const existing = rows[0];

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (body[field] !== undefined) updates[field] = body[field] === '' ? null : body[field];
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No editable fields provided' });

    // Coordinate validation if present
    if (updates.latitude !== undefined || updates.longitude !== undefined) {
      const lat = num(updates.latitude);
      const lng = num(updates.longitude);
      if (!validCoord(lat, lng)) {
        return res.status(400).json({ error: 'Invalid latitude/longitude range' });
      }
      updates.latitude = lat;
      updates.longitude = lng;
      updates.coordinate_source = 'manual';
      updates.coord_conflict = false;
      updates.coord_diff_meters = null;
    }

    const setCols = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
    const values = [id, ...Object.values(updates)];

    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE work_orders SET ${setCols.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    for (const [field, val] of Object.entries(updates)) {
      if (String(existing[field] ?? '') !== String(val ?? '')) {
        await addHistory(client, id, {
          action: 'edit', field, oldValue: existing[field], newValue: val,
          note: 'Manual edit', actor: req.user,
        });
      }
    }
    await client.query('COMMIT');

    res.json({ success: true, work_order: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('update work order error:', error);
    res.status(500).json({ error: 'Failed to update work order' });
  } finally {
    client.release();
  }
});

// Change status
router.patch('/:id/status', optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, note, delay_reason, completion_notes } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Status is required' });

  const client = await pool.connect();
  try {
    const { rows: st } = await client.query('SELECT * FROM work_order_statuses WHERE code = $1', [status]);
    if (st.length === 0) return res.status(400).json({ error: 'Unknown status' });
    if (status === 'DELAYED' && !delay_reason) {
      return res.status(400).json({ error: 'A delay reason is required when marking a work order DELAYED' });
    }

    const { rows } = await client.query('SELECT * FROM work_orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });
    const existing = rows[0];

    await client.query('BEGIN');
    await client.query(
      `UPDATE work_orders SET
         status = $2::varchar(30), status_source = 'manual', updated_at = NOW(),
         completion_date = CASE WHEN $2::text = 'COMPLETED' THEN COALESCE($4::timestamp, NOW()) ELSE completion_date END,
         delay_reason = CASE WHEN $2::text = 'DELAYED' THEN $3::text ELSE delay_reason END,
         completion_notes = CASE WHEN $2::text = 'COMPLETED' THEN COALESCE($5::text, completion_notes) ELSE completion_notes END
       WHERE id = $1`,
      [id, status, delay_reason || null, null, completion_notes || null]
    );
    if (existing.status !== status) {
      await addHistory(client, id, {
        action: 'status_change', field: 'status', oldValue: existing.status, newValue: status,
        note: note || (delay_reason ? `Delay reason: ${delay_reason}` : completion_notes ? `Completion: ${completion_notes}` : null),
        actor: req.user,
      });
    }
    await client.query('COMMIT');

    const updated = (await pool.query('SELECT * FROM work_orders WHERE id = $1', [id])).rows[0];
    res.json({ success: true, work_order: updated });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('status update error:', error);
    res.status(500).json({ error: 'Failed to update status' });
  } finally {
    client.release();
  }
});

// Change channel
router.patch('/:id/channel', optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { channel } = req.body || {};
  if (!channel) return res.status(400).json({ error: 'Channel is required' });

  const client = await pool.connect();
  try {
    const { rows: ch } = await client.query('SELECT code FROM work_order_channels WHERE code = $1', [channel]);
    if (ch.length === 0) return res.status(400).json({ error: 'Unknown channel' });
    const { rows } = await client.query('SELECT * FROM work_orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });

    await client.query('BEGIN');
    await client.query(
      `UPDATE work_orders SET source_channel = $2, channel_source = 'manual', updated_at = NOW() WHERE id = $1`,
      [id, channel]
    );
    await addHistory(client, id, {
      action: 'channel_change', field: 'source_channel', oldValue: rows[0].source_channel,
      newValue: channel, note: 'Manual channel assignment', actor: req.user,
    });
    await client.query('COMMIT');
    const updated = (await pool.query('SELECT * FROM work_orders WHERE id = $1', [id])).rows[0];
    res.json({ success: true, work_order: updated });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('channel update error:', error);
    res.status(500).json({ error: 'Failed to update channel' });
  } finally {
    client.release();
  }
});

// Assignment
router.patch('/:id/assignment', optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { assigned_technician, assigned_team } = req.body || {};
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM work_orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });
    await client.query('BEGIN');
    await client.query(
      `UPDATE work_orders SET
         assigned_technician = $2, assigned_team = $3,
         status = CASE WHEN status = 'NEW' OR status = 'FOR DISPATCH' THEN 'ASSIGNED' ELSE status END,
         status_source = CASE WHEN status IN ('NEW','FOR DISPATCH') THEN 'manual' ELSE status_source END,
         updated_at = NOW()
       WHERE id = $1`,
      [id, assigned_technician || null, assigned_team || null]
    );
    await addHistory(client, id, {
      action: 'assignment', field: 'assigned_technician', oldValue: rows[0].assigned_technician,
      newValue: assigned_technician || null, note: 'Manual assignment', actor: req.user,
    });
    await client.query('COMMIT');
    const updated = (await pool.query('SELECT * FROM work_orders WHERE id = $1', [id])).rows[0];
    res.json({ success: true, work_order: updated });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('assignment error:', error);
    res.status(500).json({ error: 'Failed to update assignment' });
  } finally {
    client.release();
  }
});

// Manual coordinate correction
router.patch('/:id/coordinates', optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const lat = num(req.body?.latitude);
  const lng = num(req.body?.longitude);
  if (!validCoord(lat, lng) || lat === null || lng === null) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM work_orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });
    await client.query('BEGIN');
    await client.query(
      `UPDATE work_orders SET latitude = $2, longitude = $3, coordinate_source = 'manual',
         coord_conflict = false, coord_diff_meters = NULL, updated_at = NOW()
       WHERE id = $1`,
      [id, lat, lng]
    );
    await addHistory(client, id, {
      action: 'coordinate_correction', field: 'coordinates',
      oldValue: `${rows[0].latitude},${rows[0].longitude}`, newValue: `${lat},${lng}`,
      note: 'Manual coordinate correction', actor: req.user,
    });
    await client.query('COMMIT');
    const updated = (await pool.query('SELECT * FROM work_orders WHERE id = $1', [id])).rows[0];
    res.json({ success: true, work_order: updated });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Failed to correct coordinates' });
  } finally {
    client.release();
  }
});

// Add a note
router.post('/:id/notes', optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { note, type } = req.body || {};
  if (!note || !String(note).trim()) return res.status(400).json({ error: 'Note text is required' });
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM work_orders WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });

    const field = type === 'delay' ? 'delay_reason' : type === 'completion' ? 'completion_notes' : 'dispatch_notes';
    const existing = rows[0][field] ? `${rows[0][field]}\n` : '';
    await client.query(`UPDATE work_orders SET ${field} = $2, updated_at = NOW() WHERE id = $1`, [id, existing + note]);
    await addHistory(client, id, { action: 'note', field, newValue: note, note: 'Note added', actor: req.user });
    const updated = (await pool.query('SELECT * FROM work_orders WHERE id = $1', [id])).rows[0];
    res.json({ success: true, work_order: updated });
  } catch (error) {
    console.error('note error:', error);
    res.status(500).json({ error: 'Failed to add note' });
  } finally {
    client.release();
  }
});

router.get('/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM work_order_history WHERE work_order_id = $1 ORDER BY created_at DESC LIMIT 500',
      [req.params.id]
    );
    res.json({ history: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// Soft delete (requires admin) with restore support
router.delete('/:id', optionalAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const permanent = req.query.permanent === 'true';
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM work_orders WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Work order not found' });

    if (permanent) {
      await client.query('DELETE FROM work_orders WHERE id = $1', [id]);
      return res.json({ success: true, deleted: 'permanent' });
    }
    await client.query('BEGIN');
    await client.query('UPDATE work_orders SET deleted_at = NOW() WHERE id = $1', [id]);
    await addHistory(client, id, { action: 'deleted', note: 'Work order soft-deleted', actor: req.user });
    await client.query('COMMIT');
    res.json({ success: true, deleted: 'soft' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Failed to delete work order' });
  } finally {
    client.release();
  }
});

router.post('/:id/restore', optionalAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE work_orders SET deleted_at = NULL WHERE id = $1', [id]);
    await addHistory(client, id, { action: 'restored', note: 'Work order restored', actor: req.user });
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Failed to restore work order' });
  } finally {
    client.release();
  }
});

module.exports = router;
