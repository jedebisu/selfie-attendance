// Shared WHERE / ORDER BY builder for work order list, stats, and export.
const SORTABLE = new Set([
  'work_order_number', 'customer_name', 'customer_address', 'status',
  'source_channel', 'area', 'territory', 'barangay', 'nap_id', 'facility', 'date_created',
  'created_at',
  'updated_at', 'completion_date', 'appointment', 'priority', 'assigned_technician',
]);

function asList(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// Today (Asia/Manila) as an ISO 'YYYY-MM-DD' string. Shared so the list filter,
// dashboard aggregates, and productivity metrics all agree on "today".
function manilaToday() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) || new Date().toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function buildFilters(query = {}) {
  const where = [];
  const params = [];
  const add = (sql, val) => {
    params.push(val);
    where.push(sql.replace('?', `$${params.length}`));
  };

  // "Today" in Asia/Manila, used by the overdue and priority filters.
  const overdueToday = manilaToday();

  if (query.include_deleted !== 'true') where.push('wo.deleted_at IS NULL');

  const q = (query.q || '').trim();
  if (q) {
    params.push(`%${q}%`);
    const p = `$${params.length}`;
    where.push(`(
      wo.work_order_number ILIKE ${p} OR wo.customer_name ILIKE ${p} OR
      wo.customer_address ILIKE ${p} OR wo.customer_contact ILIKE ${p} OR
      wo.nap_id ILIKE ${p} OR wo.barangay ILIKE ${p} OR wo.facility ILIKE ${p} OR
      wo.extra->>'serviceidnumber' ILIKE ${p} OR wo.extra->>'serviceIdNumber' ILIKE ${p} OR
      wo.extra->>'serviceId' ILIKE ${p} OR
      wo.extra->>'accountnumber' ILIKE ${p} OR wo.extra->>'accountNumber' ILIKE ${p}
    )`);
  }

  const statuses = asList(query.status);
  if (statuses.length) add(`wo.status = ANY(?)`, statuses);

  const channels = asList(query.channel);
  if (channels.length) add(`wo.source_channel = ANY(?)`, channels);

  if (query.area) add(`wo.area = ?`, query.area);
  if (query.territory) add(`wo.territory = ?`, query.territory);
  if (query.barangay) add(`wo.barangay = ?`, query.barangay);
  if (query.nap_id) add(`wo.nap_id = ?`, query.nap_id);
  if (query.assigned_technician) add(`wo.assigned_technician = ?`, query.assigned_technician);
  if (query.batch_id) add(`wo.import_batch_id = ?`, parseInt(query.batch_id, 10));

  if (query.unmapped === 'true') where.push('(wo.latitude IS NULL OR wo.longitude IS NULL)');
  if (query.mapped === 'true') where.push('(wo.latitude IS NOT NULL AND wo.longitude IS NOT NULL)');
  if (query.no_channel === 'true') where.push('wo.source_channel IS NULL');
  if (query.coord_conflict === 'true') where.push('wo.coord_conflict = true');
  if (query.nap_match_status) add(`wo.nap_match_status = ?`, query.nap_match_status);

  if (query.date_from) add(`wo.date_created >= ?`, query.date_from);
  if (query.date_to) add(`wo.date_created <= ?`, `${query.date_to} 23:59:59`);
  if (query.created_from) add(`wo.created_at >= ?`, query.created_from);
  if (query.created_to) add(`wo.created_at <= ?`, `${query.created_to} 23:59:59`);
  if (query.appointment_from) add(`wo.appointment >= ?`, query.appointment_from);
  if (query.appointment_to) add(`wo.appointment <= ?`, query.appointment_to);
  if (query.completed_from) add(`wo.completion_date >= ?`, query.completed_from);
  if (query.completed_to) add(`wo.completion_date <= ?`, `${query.completed_to} 23:59:59`);
  // Overdue is "appointment (date string) earlier than today (Asia/Manila)".
  // Computing today here keeps the list drill-down identical to the dashboard.
  if (query.overdue === 'true') add(`wo.appointment < ?`, overdueToday);
  if (query.overdue === 'false') add(`wo.appointment >= ?`, overdueToday);

  // Management "priority queue": delayed OR non-terminal & overdue. Both use the
  // established business rules (DELAYED status; appointment < today) — no SLA.
  if (query.priority === 'true') {
    params.push(overdueToday);
    where.push(
      `(wo.status = 'DELAYED' OR (wo.status NOT IN ('COMPLETED','CANCELLED','FAILED') AND wo.appointment IS NOT NULL AND wo.appointment < $${params.length}))`
    );
  }

  const ids = asList(query.ids);
  if (ids.length) {
    const nums = ids.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n));
    if (nums.length) add(`wo.id = ANY(?)`, nums);
  }

  return { where, params };
}

function buildOrderBy(query = {}) {
  const sortBy = SORTABLE.has(query.sort_by) ? query.sort_by : 'updated_at';
  const dir = (query.sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `wo.${sortBy} ${dir} NULLS LAST, wo.id DESC`;
}

module.exports = { buildFilters, buildOrderBy, asList, SORTABLE, manilaToday };
