const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { buildFilters } = require('../utils/workOrderQuery');
const { computeProductivity } = require('../utils/productivity');

// Today (Asia/Manila) as an ISO date string. Kept identical to the drill-down
// overdue filter in workOrderQuery.js so counts always match the list.
function manilaToday() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) || null;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// Technician Productivity summary.
// The cohort is scoped by the shared work-order filters. Completion metrics are
// scoped by completed_from/completed_to and credited via work-order history.
router.get('/', async (req, res) => {
  try {
    const cohortQuery = { ...req.query };
    // These keys drive completion-metric slicing, not the cohort itself.
    delete cohortQuery.completed_from;
    delete cohortQuery.completed_to;
    delete cohortQuery.overdue;
    delete cohortQuery.ids;

    const { where, params } = buildFilters(cohortQuery);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rowsQ = pool.query(
      `SELECT wo.id,
              wo.status,
              wo.assigned_technician,
              wo.appointment,
              to_char(wo.date_created, 'YYYY-MM-DD') AS created_day,
              to_char(wo.completion_date, 'YYYY-MM-DD') AS completed_day,
              (SELECT h.new_value
                 FROM work_order_history h
                WHERE h.work_order_id = wo.id
                  AND h.action = 'assignment'
                  AND h.field = 'assigned_technician'
                  AND (wo.completion_date IS NULL OR h.created_at <= wo.completion_date)
                ORDER BY h.created_at DESC
                LIMIT 1) AS attributed_tech
         FROM work_orders wo ${w}
         ORDER BY wo.date_created`,
      params
    );
    const rosterQ = pool.query('SELECT name, team, phone, is_active FROM technicians WHERE is_active = true');
    const [rowsRes, rosterRes] = await Promise.all([rowsQ, rosterQ]);

    const result = computeProductivity(rowsRes.rows, {
      today: manilaToday(),
      completedFrom: req.query.completed_from || null,
      completedTo: req.query.completed_to || null,
      roster: rosterRes.rows,
    });

    res.json({
      generated_at: new Date().toISOString(),
      filters: req.query,
      ...result,
    });
  } catch (error) {
    console.error('productivity error:', error);
    res.status(500).json({ error: 'Failed to compute productivity metrics' });
  }
});

module.exports = router;