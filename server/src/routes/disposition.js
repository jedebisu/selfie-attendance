const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { optionalAuth, requireAdmin } = require('../middleware/auth');
const { loadActiveRules, classifyStatus, classifyDisposition } = require('../utils/disposition');

function actorLeaf(actor) {
  return actor && actor.id ? { actor_id: actor.id, actor_name: actor.name || actor.employee_id } : {};
}

// ---------------------------------------------------------------------------
// Disposition dictionary
// ---------------------------------------------------------------------------

router.get('/rules', async (req, res) => {
  try {
    const [cats, rules, statuses] = await Promise.all([
      pool.query('SELECT * FROM disposition_categories ORDER BY sort_order ASC'),
      pool.query('SELECT * FROM disposition_rules ORDER BY kind ASC, priority ASC, id ASC'),
      pool.query('SELECT code, label FROM work_order_statuses WHERE is_active = true ORDER BY sort_order'),
    ]);
    res.json({ categories: cats.rows, rules: rules.rows, statuses: statuses.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load disposition dictionary', detail: error.message });
  }
});

router.post('/rules', optionalAuth, requireAdmin, async (req, res) => {
  try {
    const { kind, source_value, normalized, category, operational_status, priority, explanation, approval_status, is_active } = req.body || {};
    if (kind !== 'status' && kind !== 'disposition') {
      return res.status(400).json({ error: 'kind must be "status" or "disposition"' });
    }
    if (!source_value || !String(source_value).trim()) {
      return res.status(400).json({ error: 'source_value is required' });
    }
    if (kind === 'disposition' && (!normalized || !String(normalized).trim())) {
      return res.status(400).json({ error: 'normalized disposition is required for disposition rules' });
    }
    const appr = approval_status === 'draft' ? 'draft' : 'approved';

    const { rows } = await pool.query(
      `INSERT INTO disposition_rules
         (kind, source_value, normalized, category, operational_status, priority, explanation, approval_status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        kind,
        String(source_value).trim(),
        kind === 'disposition' ? String(normalized).trim() : null,
        kind === 'disposition' ? (category || null) : 'OPERATIONAL_STATUS',
        operational_status || null,
        typeof priority === 'number' ? priority : 100,
        explanation || null,
        appr,
        is_active === false ? false : true,
      ]
    );
    res.status(201).json({ rule: rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A rule with this source value already exists for this kind' });
    }
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Invalid category or operational status' });
    }
    res.status(500).json({ error: 'Failed to create disposition rule', detail: error.message });
  }
});

router.patch('/rules/:id', optionalAuth, requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { normalized, category, operational_status, priority, explanation, approval_status, is_active } = req.body || {};
    const patch = [];
    const params = [id];
    const push = (col, val) => {
      patch.push(`${col} = $${params.length + 1}`);
      params.push(val);
    };
    if (normalized !== undefined) push('normalized', String(normalized).trim() || null);
    if (category !== undefined) push('category', category || null);
    if (operational_status !== undefined) push('operational_status', operational_status || null);
    if (priority !== undefined) push('priority', typeof priority === 'number' ? priority : 100);
    if (explanation !== undefined) push('explanation', explanation || null);
    if (approval_status !== undefined) push('approval_status', approval_status === 'draft' ? 'draft' : 'approved');
    if (is_active !== undefined) push('is_active', is_active === false ? false : true);
    if (patch.length === 0) return res.status(400).json({ error: 'No changes provided' });

    const { rows } = await pool.query(
      `UPDATE disposition_rules SET ${patch.join(', ')}, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
    res.json({ rule: rows[0] });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(400).json({ error: 'Invalid category or operational status' });
    }
    res.status(500).json({ error: 'Failed to update disposition rule', detail: error.message });
  }
});

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

router.get('/review-queue', async (req, res) => {
  try {
    const { status = 'open', channel, territory, facility, q } = req.query;
    const where = [];
    const params = [];
    if (status !== 'all') {
      params.push(status);
      where.push(`dr.status = $${params.length}`);
    }
    if (channel) {
      params.push(channel);
      where.push(`wo.source_channel = $${params.length}`);
    }
    if (territory) {
      params.push(territory);
      where.push(`wo.territory = $${params.length}`);
    }
    if (facility) {
      params.push(facility);
      where.push(`wo.facility = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(wo.work_order_number ILIKE $${params.length} OR wo.customer_name ILIKE $${params.length})`);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT dr.id AS review_id, dr.work_order_id, dr.original_disposition,
              dr.original_fsm_status, dr.suggested_disposition, dr.suggested_category,
              dr.suggested_status, dr.rule_id, dr.reason, dr.status AS review_status,
              dr.outcome, dr.note AS review_note, dr.prev_state, dr.new_state,
              dr.created_at, dr.resolved_at,
              wo.id AS id, wo.work_order_number, wo.customer_name, wo.nap_id,
              wo.area, wo.territory, wo.facility, wo.source_channel,
              wo.assigned_technician, wo.status, wo.original_status,
              wo.fsm_disposition, wo.disposition, wo.disposition_category,
              wo.disposition_review_status, wo.disposition_confidence
         FROM disposition_reviews dr
         JOIN work_orders wo ON wo.id = dr.work_order_id
         ${w}
         ORDER BY dr.created_at ASC
         LIMIT 500`,
      params
    );
    res.json({ reviews: rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load disposition review queue', detail: error.message });
  }
});

router.get('/review-queue/stats', async (req, res) => {
  try {
    const [open, byType, byChannel, byTerritory, byFacility, coverage] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS open FROM disposition_reviews WHERE status = 'open'`),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE reason LIKE 'Unknown disposition%' OR reason LIKE 'No approved rule%')::int AS unknown,
           COUNT(*) FILTER (WHERE reason LIKE 'Conflicting%')::int AS conflicting,
           COUNT(*) FILTER (WHERE reason LIKE 'Empty%')::int AS empty
           , COUNT(*)::int AS open
         FROM disposition_reviews WHERE status = 'open'`
      ),
      pool.query(
        `SELECT wo.source_channel AS channel, COUNT(*)::int AS cnt
           FROM disposition_reviews dr JOIN work_orders wo ON wo.id = dr.work_order_id
          WHERE dr.status = 'open' GROUP BY wo.source_channel ORDER BY cnt DESC`
      ),
      pool.query(
        `SELECT wo.territory, COUNT(*)::int AS cnt
           FROM disposition_reviews dr JOIN work_orders wo ON wo.id = dr.work_order_id
          WHERE dr.status = 'open' GROUP BY wo.territory ORDER BY cnt DESC`
      ),
      pool.query(
        `SELECT wo.facility, COUNT(*)::int AS cnt
           FROM disposition_reviews dr JOIN work_orders wo ON wo.id = dr.work_order_id
          WHERE dr.status = 'open' GROUP BY wo.facility ORDER BY cnt DESC NULLS LAST LIMIT 10`
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE disposition_confidence = 'approved')::int AS classified,
           COUNT(*) FILTER (WHERE disposition_review_status = 'review_required')::int AS open_reviews,
           ROUND(100.0 * COUNT(*) FILTER (WHERE disposition_confidence = 'approved')
                 / NULLIF(COUNT(*)::int, 0))::int AS coverage_pct
         FROM work_orders WHERE deleted_at IS NULL`
      ),
    ]);
    const dict = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE kind = 'disposition' AND approval_status = 'approved' AND is_active)::int AS dispositions,
         COUNT(*) FILTER (WHERE kind = 'status' AND approval_status = 'approved' AND is_active)::int AS status_aliases,
         COUNT(*) FILTER (WHERE approval_status = 'draft')::int AS drafts
       FROM disposition_rules`
    );
    res.json({
      open: open.rows[0].open,
      types: byType.rows[0],
      by_channel: byChannel.rows,
      by_territory: byTerritory.rows,
      by_facility: byFacility.rows,
      dictionary: dict.rows[0],
      classified: coverage.rows[0].classified,
      coverage_pct: coverage.rows[0].coverage_pct,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load review queue stats', detail: error.message });
  }
});

// Apply a reviewed decision to a work order. Records before/after state for
// rollback with the chosen provenance (rule-backed -> approved, else manual).
async function applyDecision(workOrder, { disposition, category, status, note, actor, ruleId }) {
  const prevState = {
    disposition: workOrder.disposition,
    disposition_category: workOrder.disposition_category,
    disposition_rule_id: workOrder.disposition_rule_id,
    disposition_confidence: workOrder.disposition_confidence,
    disposition_review_status: workOrder.disposition_review_status,
    status: workOrder.status,
    status_source: workOrder.status_source,
  };
  const nextFields = {
    disposition: disposition || workOrder.disposition || null,
    disposition_category: category || workOrder.disposition_category || null,
    disposition_rule_id: ruleId || workOrder.disposition_rule_id || null,
    disposition_confidence: 'approved',
    disposition_review_status: 'cleared',
    disposition_review_note: note || 'Resolved via review',
  };
  const nextState = { ...prevState, ...nextFields, status: status || workOrder.status };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE work_orders SET
         disposition = $2, disposition_category = $3, disposition_rule_id = $4,
         disposition_confidence = $5, disposition_review_status = $6,
         disposition_review_note = $7, status = $8, status_source = $9, updated_at = NOW()
       WHERE id = $1`,
      [
        workOrder.id,
        nextState.disposition,
        nextState.disposition_category,
        nextState.disposition_rule_id,
        nextState.disposition_confidence,
        nextState.disposition_review_status,
        nextState.disposition_review_note,
        nextState.status,
        status ? 'manual' : nextState.status_source,
      ]
    );
    await client.query(
      `INSERT INTO work_order_history
         (work_order_id, action, field, old_value, new_value, note, actor_id, actor_name)
       VALUES ($1, 'disposition_change', 'disposition', $2, $3, $4, $5, $6)`,
      [
        workOrder.id,
        prevState.disposition || '',
        nextState.disposition || '',
        note || 'Disposition resolved via review',
        actor && actor.id ? actor.id : null,
        actor && (actor.name || actor.employee_id) ? actor.name || actor.employee_id : null,
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { prev: prevState, next: nextState };
}

// Explicitly aliased join so pg never overwrites review fields with work-order
// fields (id/status collide between the two tables).
const REVIEW_LINK_SELECT = `
  SELECT dr.id AS review_id, dr.work_order_id, dr.original_disposition,
         dr.original_fsm_status, dr.suggested_disposition, dr.suggested_category,
         dr.suggested_status, dr.rule_id, dr.reason, dr.status AS review_status,
         dr.outcome, dr.note AS review_note, dr.prev_state, dr.new_state,
         dr.created_at, dr.resolved_at,
         wo.id AS wo_id, wo.status AS wo_status, wo.status_source AS wo_status_source,
         wo.fsm_disposition, wo.disposition, wo.disposition_category,
         wo.disposition_rule_id, wo.disposition_confidence,
         wo.disposition_review_status, wo.disposition_review_note
  FROM disposition_reviews dr JOIN work_orders wo ON wo.id = dr.work_order_id
`;

function reviewToWorkOrder(row) {
  return {
    id: row.wo_id,
    status: row.wo_status,
    status_source: row.wo_status_source,
    disposition: row.disposition,
    disposition_category: row.disposition_category,
    disposition_rule_id: row.disposition_rule_id,
    disposition_confidence: row.disposition_confidence,
    disposition_review_status: row.disposition_review_status,
    disposition_review_note: row.disposition_review_note,
  };
}

// Approve / adjust an open review item.
router.post('/review/:workOrderId/approve', optionalAuth, async (req, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId, 10);
    const reviewId = req.body.review_id ? parseInt(req.body.review_id, 10) : null;
    const { disposition, category, status, note } = req.body || {};

    const { rows } = await pool.query(
      `${REVIEW_LINK_SELECT}
        WHERE dr.work_order_id = $1 AND dr.status = 'open'
        ${reviewId ? 'AND dr.id = $2' : ''}
        ORDER BY dr.created_at ASC LIMIT 1`,
      reviewId ? [workOrderId, reviewId] : [workOrderId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No open review for this work order' });
    const review = rows[0];

    const { prev, next } = await applyDecision(reviewToWorkOrder(review), {
      disposition,
      category,
      status,
      note: note || `Approved: ${review.suggested_disposition || 'no change'}`,
      actor: req.user,
      ruleId: review.rule_id || null,
    });

    await pool.query(
      `UPDATE disposition_reviews SET
         status = 'approved', suggested_disposition = $2,
         suggested_category = $3, suggested_status = $4, prev_state = $5::jsonb,
         new_state = $6::jsonb, note = $7, resolved_at = NOW()
       WHERE id = $1`,
      [
        review.review_id,
        disposition || review.suggested_disposition,
        category || review.suggested_category,
        status || review.suggested_status,
        JSON.stringify(prev),
        JSON.stringify(next),
        note || null,
      ]
    );

    res.json({ success: true, review_id: review.review_id, work_order_id: workOrderId, prev, next });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve disposition review', detail: error.message });
  }
});

// Clear an open review without changing the work order.
router.post('/review/:workOrderId/clear', optionalAuth, async (req, res) => {
  try {
    const workOrderId = parseInt(req.params.workOrderId, 10);
    const { note } = req.body || {};
    const { rows } = await pool.query(
      `${REVIEW_LINK_SELECT}
        WHERE dr.work_order_id = $1 AND dr.status = 'open'
        ORDER BY dr.created_at ASC LIMIT 1`,
      [workOrderId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No open review for this work order' });
    const review = rows[0];
    const wo = reviewToWorkOrder(review);

    const prevState = {
      disposition: wo.disposition,
      disposition_review_status: wo.disposition_review_status,
      status: wo.status,
    };
    await pool.query(
      `UPDATE work_orders SET disposition_review_status = 'cleared', disposition_review_note = $2, updated_at = NOW()
       WHERE id = $1`,
      [workOrderId, note || 'Cleared without change (no correction needed)']
    );
    await pool.query(
      `UPDATE disposition_reviews SET
         status = 'cleared', prev_state = $2::jsonb, new_state = $3::jsonb, note = $4, resolved_at = NOW()
       WHERE id = $1`,
      [review.review_id, JSON.stringify(prevState), JSON.stringify({ ...prevState, disposition_review_status: 'cleared' }), note || null]
    );

    res.json({ success: true, review_id: review.review_id, work_order_id: workOrderId, cleared: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear disposition review', detail: error.message });
  }
});

// Bulk-approve open reviews that share the same verified target.
router.post('/review/bulk', optionalAuth, async (req, res) => {
  try {
    const { ids, disposition, category, status, note } = req.body || {};
    const list = (Array.isArray(ids) ? ids : []).map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
    if (list.length === 0) return res.status(400).json({ error: 'ids is required' });

    const { rows } = await pool.query(
      `${REVIEW_LINK_SELECT}
        WHERE dr.id = ANY($1::int[]) AND dr.status = 'open'`,
      [list]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No open reviews matched' });

    // Safe bulk: the chosen target must be backed by an approved rule.
    const rules = await loadActiveRules();
    const approvedDispositions = new Set(
      rules.filter((r) => r.kind === 'disposition').map((r) => r.normalized)
    );
    if (disposition && !approvedDispositions.has(disposition)) {
      return res.status(400).json({
        error: `Bulk apply refused: "${disposition}" is not an approved disposition value. Add a rule first.`,
      });
    }

    const applied = [];
    for (const review of rows) {
      const { prev, next } = await applyDecision(reviewToWorkOrder(review), {
        disposition: disposition || review.suggested_disposition,
        category: category || review.suggested_category,
        status: status || review.suggested_status,
        note: note || `Bulk resolved (${rows.length} records)`,
        actor: req.user,
        ruleId: review.rule_id || null,
      });
      await pool.query(
        `UPDATE disposition_reviews SET
           status = 'approved', suggested_disposition = $2, suggested_category = $3,
           suggested_status = $4, prev_state = $5::jsonb, new_state = $6::jsonb,
           note = $7, resolved_at = NOW()
         WHERE id = $1`,
        [
          review.review_id,
          disposition || review.suggested_disposition,
          category || review.suggested_category,
          status || review.suggested_status,
          JSON.stringify(prev),
          JSON.stringify(next),
          note || null,
        ]
      );
      applied.push(review.work_order_id);
    }
    res.json({ success: true, applied: applied.length, work_order_ids: applied });
  } catch (error) {
    res.status(500).json({ error: 'Failed to bulk apply disposition', detail: error.message });
  }
});

// ---------------------------------------------------------------------------
// Controlled corrections (re-classify existing records via a rule)
// ---------------------------------------------------------------------------

router.post('/correct', optionalAuth, async (req, res) => {
  try {
    const { rule_id, status, note, confirm, work_order_ids } = req.body || {};
    const ruleId = parseInt(rule_id, 10);
    if (!Number.isFinite(ruleId)) return res.status(400).json({ error: 'rule_id is required' });

    const { rows: ruleRows } = await pool.query(
      `SELECT * FROM disposition_rules WHERE id = $1 AND is_active AND approval_status = 'approved'`,
      [ruleId]
    );
    if (ruleRows.length === 0) return res.status(404).json({ error: 'Approved rule not found' });
    const rule = ruleRows[0];

    const where = ['deleted_at IS NULL'];
    const params = [];
    if (work_order_ids && work_order_ids.length) {
      params.push(work_order_ids);
      where.push(`id = ANY($${params.length}::int[])`);
    }
    if (rule.kind === 'disposition' && rule.normalized) {
      params.push(rule.normalized);
      where.push(`(disposition IS DISTINCT FROM $${params.length})`);
    }

    const { rows: targets } = await pool.query(
      `SELECT * FROM work_orders WHERE ${where.join(' AND ')} ORDER BY id ASC`,
      params
    );

    const proposal = {
      rule_id: rule.id,
      source_value: rule.source_value,
      disposition: rule.normalized || null,
      category: rule.category || null,
      status: status || rule.operational_status || null,
      affected_count: targets.length,
      samples: targets.slice(0, 10).map((t) => ({
        id: t.id,
        work_order_number: t.work_order_number,
        customer_name: t.customer_name,
        current_disposition: t.disposition,
        current_status: t.status,
        fsm_disposition: t.fsm_disposition,
        original_status: t.original_status,
      })),
    };

    if (!confirm || String(confirm).toLowerCase() !== 'yes') {
      return res.json({ ...proposal, confirm_required: true });
    }

    const applyStatus = status || rule.operational_status || null;
    const client = await pool.connect();
    const applied = [];
    try {
      await client.query('BEGIN');
      for (const wo of targets) {
        const prev = {
          disposition: wo.disposition,
          disposition_category: wo.disposition_category,
          disposition_rule_id: wo.disposition_rule_id,
          disposition_confidence: wo.disposition_confidence,
          disposition_review_status: wo.disposition_review_status,
          status: wo.status,
          status_source: wo.status_source,
        };
        await client.query(
          `UPDATE work_orders SET
             disposition = $2, disposition_category = $3, disposition_rule_id = $4,
             disposition_confidence = 'approved', disposition_review_status = 'cleared',
             disposition_review_note = $5,
             status = $6::text,
             status_source = CASE WHEN $6 IS NOT NULL THEN 'manual' ELSE status_source END,
             updated_at = NOW()
           WHERE id = $1`,
          [
            wo.id,
            rule.normalized || wo.disposition,
            rule.category || wo.disposition_category,
            rule.id,
            `Corrected via approved rule #${rule.id} (${rule.source_value})`,
            applyStatus,
          ]
        );
        await client.query(
          `INSERT INTO work_order_history
             (work_order_id, action, field, old_value, new_value, note, actor_id, actor_name)
           VALUES ($1, 'disposition_correct', 'disposition', $2, $3, $4, $5::int, $6::text)`,
          [
            wo.id,
            prev.disposition || '',
            rule.normalized || '',
            `Apply approved rule #${rule.id} (${rule.source_value})`,
            req.user && req.user.id ? req.user.id : null,
            req.user && (req.user.name || req.user.employee_id) ? req.user.name || req.user.employee_id : null,
          ]
        );
        // Record a resolved review row so the correction is revertible.
        await client.query(
          `INSERT INTO disposition_reviews
             (work_order_id, original_disposition, original_fsm_status, suggested_disposition,
              suggested_category, suggested_status, rule_id, reason, status, outcome,
              prev_state, new_state, note, actor_id, actor_name, resolved_at)
           VALUES ($1, $2::text, $3::text, $4::text, $5::text, $6::text, $7, $8, 'approved', 'corrected', $9::jsonb, $10::jsonb, $11::text, $12::int, $13::text, NOW())
           ON CONFLICT (work_order_id) WHERE status = 'open' DO NOTHING`,
          [
            wo.id,
            wo.fsm_disposition || wo.original_status,
            wo.original_status,
            rule.normalized || null,
            rule.category || null,
            applyStatus,
            rule.id,
            `Rule-based correction (#${rule.id})`,
            JSON.stringify(prev),
            JSON.stringify({
              ...prev,
              disposition: rule.normalized || wo.disposition,
              disposition_category: rule.category || wo.disposition_category,
              disposition_rule_id: rule.id,
              disposition_confidence: 'approved',
              disposition_review_status: 'cleared',
              status: applyStatus || wo.status,
            }),
            note || null,
            req.user && req.user.id ? req.user.id : null,
            req.user && (req.user.name || req.user.employee_id) ? req.user.name || req.user.employee_id : null,
          ]
        );
        applied.push(wo.id);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ success: true, applied: applied.length, proposal });
  } catch (error) {
    res.status(500).json({ error: 'Failed to apply disposition correction', detail: error.message });
  }
});

// Rollback a resolved review item (approved/corrected/cleared). Restores the
// work order to its pre-decision state from the recorded snapshot.
router.post('/corrections/rollback', optionalAuth, async (req, res) => {
  try {
    const { review_id } = req.body || {};
    const reviewId = parseInt(review_id, 10);
    if (!Number.isFinite(reviewId)) return res.status(400).json({ error: 'review_id is required' });

    const { rows } = await pool.query(
      `SELECT * FROM disposition_reviews WHERE id = $1 AND status != 'open' AND status != 'rolled_back'`,
      [reviewId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Decided review not found or already rolled back' });
    }
    const review = rows[0];
    const prev = review.prev_state || {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE work_orders SET
           disposition = $2,
           disposition_category = $3,
           disposition_rule_id = $4,
           disposition_confidence = $5,
           disposition_review_status = $6,
           status = $7,
           status_source = $8,
           updated_at = NOW()
         WHERE id = $1`,
        [
          review.work_order_id,
          prev.disposition || null,
          prev.disposition_category || null,
          prev.disposition_rule_id || null,
          prev.disposition_confidence || 'none',
          prev.disposition_review_status || 'none',
          prev.status || 'NEW',
          prev.status_source || 'default',
        ]
      );
      await client.query(
        `UPDATE disposition_reviews SET status = 'rolled_back', outcome = 'restored previous state', resolved_at = NOW() WHERE id = $1`,
        [reviewId]
      );
      await client.query(
        `INSERT INTO work_order_history
           (work_order_id, action, field, old_value, new_value, note, actor_id, actor_name)
         VALUES ($1, 'disposition_rollback', 'disposition', $2, $3, $4, $5, $6)`,
        [
          review.work_order_id,
          (review.new_state || {}).disposition || '',
          prev.disposition || '',
          'Rolled back disposition change',
          req.user && req.user.id ? req.user.id : null,
          req.user && (req.user.name || req.user.employee_id) ? req.user.name || req.user.employee_id : null,
        ]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ success: true, review_id: reviewId, work_order_id: review.work_order_id, restored: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rollback disposition change', detail: error.message });
  }
});

// ---------------------------------------------------------------------------
// Audit + metrics
// ---------------------------------------------------------------------------

router.get('/audit', async (req, res) => {
  try {
    const total = await pool.query(`SELECT COUNT(*)::int AS total FROM work_orders WHERE deleted_at IS NULL`);
    const dict = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE is_active AND approval_status = 'approved')::int AS active,
         COUNT(*) FILTER (WHERE kind = 'disposition' AND is_active AND approval_status = 'approved')::int AS dispositions,
         COUNT(*) FILTER (WHERE kind = 'status' AND is_active AND approval_status = 'approved')::int AS status_aliases,
         COUNT(*) FILTER (WHERE approval_status = 'draft')::int AS drafts,
         COUNT(*) FILTER (WHERE NOT is_active)::int AS inactive
       FROM disposition_rules`
    );
    const categories = await pool.query(
      `SELECT code, label, count(r.id) AS rules FROM disposition_categories c
         LEFT JOIN disposition_rules r ON r.category = c.code AND r.is_active
        GROUP BY c.code, c.label, c.sort_order ORDER BY c.sort_order`
    );

    // Distinct source values present in the data, with their classification.
    const values = await pool.query(
      `SELECT fsm_disposition AS disposition_value, original_status AS status_value,
              wo.disposition AS stored_disposition, wo.disposition_review_status,
              COUNT(*)::int AS occurrences
         FROM work_orders wo
        WHERE deleted_at IS NULL
        GROUP BY fsm_disposition, original_status, stored_disposition, disposition_review_status
        ORDER BY occurrences DESC
        LIMIT 500`
    );

    const rules = await loadActiveRules();
    const auditing = values.rows.map((v) => {
      const raw = v.disposition_value || v.status_value;
      let decision = { matched: false, reason: 'No value' };
      if (raw) {
        const asDisposition = classifyDisposition(raw, rules);
        const asStatus = classifyStatus(raw, rules);
        if (asDisposition.matched) decision = { matched: true, path: 'disposition', ...asDisposition };
        else if (asStatus.matched) decision = { matched: true, path: 'status', ...asStatus };
        else decision = { matched: false, reason: `Unknown — no approved rule`, path: null };
      }
      return {
        disposition_value: v.disposition_value,
        status_value: v.status_value,
        stored_disposition: v.stored_disposition,
        review_status: v.disposition_review_status,
        occurrences: v.occurrences,
        classification: {
          matched: decision.matched,
          path: decision.path || null,
          target:
            decision.disposition || decision.operational_status || null,
          category: decision.category || null,
          rule_id: decision.rule_id || null,
          reason: decision.reason || null,
        },
      };
    });

    res.json({
      generated_at: new Date(),
      source: 'work_orders table (live data)',
      total_work_orders: total.rows[0].total,
      dictionary: dict.rows[0],
      categories: categories.rows,
      values: auditing,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate disposition audit', detail: error.message });
  }
});

router.get('/metrics', async (req, res) => {
  try {
    const [{ rows: coverage }, openByChannel, unknownValues] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE disposition_confidence = 'approved')::int AS classified,
           COUNT(*) FILTER (WHERE disposition_review_status = 'review_required')::int AS open_reviews,
           COUNT(*) FILTER (WHERE disposition_review_status = 'cleared')::int AS cleared
         FROM work_orders WHERE deleted_at IS NULL`
      ),
      pool.query(
        `SELECT wo.source_channel AS channel, COUNT(*)::int AS cnt
           FROM work_orders wo WHERE wo.disposition_review_status = 'review_required'
          GROUP BY wo.source_channel ORDER BY cnt DESC`
      ),
      pool.query(
        `SELECT fsm_disposition AS value, COUNT(*)::int AS cnt
           FROM work_orders WHERE deleted_at IS NULL AND disposition_review_status = 'review_required'
          GROUP BY fsm_disposition ORDER BY cnt DESC NULLS LAST LIMIT 20`
      ),
    ]);
    const c = coverage[0];
    const denom = c.classified + c.open_reviews;
    res.json({
      total: c.total,
      classified: c.classified,
      open_reviews: c.open_reviews,
      cleared: c.cleared,
      coverage_pct: denom > 0 ? Math.round((c.classified / denom) * 1000) / 10 : null,
      by_channel: openByChannel.rows,
      unknown_values: unknownValues.rows,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load disposition metrics', detail: error.message });
  }
});

module.exports = router;