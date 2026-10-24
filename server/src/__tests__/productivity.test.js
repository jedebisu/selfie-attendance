const { computeProductivity, dayOf, rate } = require('../utils/productivity');
const { buildFilters, manilaToday } = require('../utils/workOrderQuery');

const baseRow = (id, over = {}) => ({
  id,
  status: 'NEW',
  assigned_technician: 'TECH A',
  appointment: '2026-10-11',
  created_day: '2026-10-09',
  completed_day: null,
  attributed_tech: null,
  ...over,
});

describe('computeProductivity (Technician Productivity metrics)', () => {
  it('returns zero / N/A values for an empty cohort', () => {
    const r = computeProductivity([], { today: '2026-10-11' });
    expect(r.summary.total).toBe(0);
    expect(r.summary.assigned).toBe(0);
    expect(r.summary.pending).toBe(0);
    expect(r.summary.completed).toBe(0);
    expect(r.summary.completion_rate).toBeNull();
    expect(r.summary.on_time_rate).toBeNull();
    expect(r.by_technician).toEqual([]);
    expect(r.workload_trend).toEqual([]);
    expect(r.completion_trend).toEqual([]);
  });

  it('counts an all-NEW cohort as pending and computes rates', () => {
    const rows = [
      baseRow(1),
      baseRow(2, { assigned_technician: 'TECH B' }),
      baseRow(3, { assigned_technician: 'TECH A' }),
    ];
    const r = computeProductivity(rows, { today: '2026-10-11' });
    expect(r.summary.total).toBe(3);
    expect(r.summary.assigned).toBe(3);
    expect(r.summary.pending).toBe(3);
    expect(r.summary.completed).toBe(0);
    expect(r.summary.completion_eligible).toBe(3);
    expect(r.summary.completion_rate).toBe(0);
    expect(r.summary.on_time_rate).toBeNull();
    expect(r.by_technician.map((t) => [t.technician, t.assigned, t.pending])).toEqual([
      ['TECH A', 2, 2],
      ['TECH B', 1, 1],
    ]);
    expect(r.by_technician[0].ids.assigned).toEqual([1, 3]);
  });

  it('splits workload into pending / delayed / on hold', () => {
    const rows = [
      baseRow(1),
      baseRow(2, { status: 'DELAYED' }),
      baseRow(3, { status: 'ON HOLD' }),
      baseRow(4, { status: 'IN PROGRESS' }),
    ];
    const r = computeProductivity(rows, { today: '2026-10-11' });
    expect(r.summary.pending).toBe(2);
    expect(r.summary.delayed).toBe(1);
    expect(r.summary.on_hold).toBe(1);
    expect(r.summary.ids.pending).toEqual([1, 4]);
    expect(r.summary.ids.delayed).toEqual([2]);
    expect(r.summary.ids.on_hold).toEqual([3]);
  });

  it('flips overdue based on appointment vs today (Asia/Manila)', () => {
    const rows = [
      baseRow(1, { appointment: '2026-10-10' }),
      baseRow(2, { appointment: '2026-10-11' }),
      baseRow(3, { appointment: null }),
      baseRow(4, { status: 'COMPLETED', appointment: '2026-10-10', completed_day: '2026-10-09' }),
    ];
    const r = computeProductivity(rows, { today: '2026-10-11' });
    expect(r.summary.overdue).toBe(1);
    expect(r.summary.ids.overdue).toEqual([1]);
    expect(r.summary.no_appointment).toBe(1);
  });

  it('credits completions via history attribution, not current assignment', () => {
    const rows = [
      baseRow(1, {
        status: 'COMPLETED', completed_day: '2026-10-10', appointment: '2026-10-10',
        assigned_technician: 'TECH B', attributed_tech: 'TECH A',
      }),
    ];
    const r = computeProductivity(rows, { today: '2026-10-11' });
    expect(r.summary.completed).toBe(1);
    expect(r.summary.unattributed_completions).toBe(0);
    const techA = r.by_technician.find((t) => t.technician === 'TECH A');
    const techB = r.by_technician.find((t) => t.technician === 'TECH B');
    expect(techA.completed).toBe(1);
    expect(techB.completed).toBe(0);
    expect(r.by_technician.some((t) => t.technician === 'Unassigned')).toBe(false);
  });

  it('surfaces unattributed completions as an Unattributed bucket', () => {
    const rows = [
      baseRow(1, { status: 'COMPLETED', completed_day: '2026-10-10', attributed_tech: null }),
    ];
    const r = computeProductivity(rows, { today: '2026-10-11' });
    expect(r.summary.unattributed_completions).toBe(1);
    const un = r.by_technician.find((t) => t.technician === 'Unattributed');
    expect(un.completed).toBe(1);
    expect(un.completion_rate).toBeNull();
  });

  it('computes on-time only when appointment AND completion date exist', () => {
    const rows = [
      baseRow(1, { status: 'COMPLETED', completed_day: '2026-10-10', appointment: '2026-10-10' }),
      baseRow(2, { status: 'COMPLETED', completed_day: '2026-10-12', appointment: '2026-10-10' }),
      baseRow(3, { status: 'COMPLETED', completed_day: '2026-10-10', appointment: null }),
    ];
    const r = computeProductivity(rows, { today: '2026-10-11' });
    expect(r.summary.completed).toBe(3);
    expect(r.summary.on_time_eligible).toBe(2);
    expect(r.summary.on_time_rate).toBe(50);
    expect(r.disclosure.some((d) => d.includes('Attribution'))).toBe(true);
  });

  it('applies completed_from/completed_to to completions only, not workload', () => {
    const rows = [
      baseRow(1, { status: 'COMPLETED', completed_day: '2026-10-01' }),
      baseRow(2, { status: 'COMPLETED', completed_day: '2026-10-10' }),
      baseRow(3),
    ];
    const r = computeProductivity(rows, {
      today: '2026-10-11',
      completedFrom: '2026-10-05',
      completedTo: '2026-10-15',
    });
    expect(r.summary.assigned).toBe(3);
    expect(r.summary.completed).toBe(1);
    expect(r.summary.ids.completed).toEqual([2]);
    expect(r.summary.completion_eligible).toBe(3);
  });

  it('marks roster membership and flags techs without any work', () => {
    const rows = [baseRow(1)];
    const r = computeProductivity(rows, {
      today: '2026-10-11',
      roster: [{ name: 'TECH A', team: 'Team One' }],
    });
    const techA = r.by_technician.find((t) => t.technician === 'TECH A');
    expect(techA.in_roster).toBe(true);
    expect(techA.team).toBe('Team One');
    const techB = r.by_technician.find((t) => t.technician === 'TECH B');
    expect(techB).toBeUndefined();
  });
});

describe('buildFilters additions (drill-down parity)', () => {
  it('filters by explicit ids', () => {
    const { where, params } = buildFilters({ ids: '1,2,x,3' });
    expect(where.join(' ')).toContain('wo.id = ANY($1)');
    expect(params[0]).toEqual([1, 2, 3]);
  });

  it('adds overdue as appointment < today and completed date range', () => {
    const f1 = buildFilters({ overdue: 'true' });
    expect(f1.where.join(' ')).toContain('wo.appointment < $1');
    expect(String(f1.params[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const f2 = buildFilters({ completed_from: '2026-10-01', completed_to: '2026-10-10' });
    expect(f2.where.join(' ')).toContain('wo.completion_date >= $1');
    expect(f2.where.join(' ')).toContain('wo.completion_date <= $2');
    expect(f2.params[1]).toBe('2026-10-10 23:59:59');
  });

  it('adds created-date range with inclusive end-of-day', () => {
    const { where, params } = buildFilters({ date_from: '2026-10-01', date_to: '2026-10-10' });
    expect(where.join(' ')).toContain('wo.date_created >= $1');
    expect(where.join(' ')).toContain('wo.date_created <= $2');
    expect(params[1]).toBe('2026-10-10 23:59:59');
  });

  it('adds priority as delayed OR non-terminal overdue', () => {
    const { where, params } = buildFilters({ priority: 'true' });
    const sql = where.join(' ');
    expect(sql).toContain(`wo.status = 'DELAYED'`);
    expect(sql).toContain(`wo.status NOT IN ('COMPLETED','CANCELLED','FAILED')`);
    expect(sql).toContain('wo.appointment < $1');
    expect(String(params[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('filters by area, territory, and assigned technician (global filters)', () => {
    const { where, params } = buildFilters({
      area: 'North',
      territory: 'T-1',
      assigned_technician: 'TECH A',
    });
    const sql = where.join(' ');
    expect(sql).toContain('wo.area = $1');
    expect(sql).toContain('wo.territory = $2');
    expect(sql).toContain('wo.assigned_technician = $3');
    expect(params).toEqual(['North', 'T-1', 'TECH A']);
  });
});

describe('manilaToday', () => {
  it('returns an ISO date string in Asia/Manila', () => {
    expect(manilaToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('helpers', () => {
  it('dayOf extracts ISO date prefix', () => {
    expect(dayOf('2026-10-11')).toBe('2026-10-11');
    expect(dayOf(null)).toBeNull();
    expect(dayOf(undefined)).toBeNull();
  });
  it('rate rounds to one decimal with N/A on zero denominator', () => {
    expect(rate(1, 4)).toBe(25);
    expect(rate(1, 3)).toBe(33.3);
    expect(rate(0, 0)).toBeNull();
  });
});