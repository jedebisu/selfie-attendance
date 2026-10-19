// Pure metric aggregation for the Technician Productivity report.
//
// The route fetches the cohort rows (already scoped by the shared filters) and
// attaches the history-based completion attribution. Everything in this module
// is deterministic and database-free so the metric formulas are unit-testable.
//
// Attribution rule (per spec): a COMPLETED work order is credited to the
// technician from the most recent `assignment` history event that happened at
// or before the completion time. The current `assigned_technician` field is
// NEVER used to credit a completion. Work orders completed without such an
// event count as "Unattributed".

const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'FAILED']);

function dayOf(value) {
  if (value === null || value === undefined) return null;
  const m = /\d{4}-\d{2}-\d{2}/.exec(String(value));
  return m ? m[0] : null;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}

function emptyIdSet() {
  return { assigned: [], unassigned: [], pending: [], delayed: [], on_hold: [], overdue: [], completed: [], cancelled: [], failed: [] };
}

function sortDays(map) {
  return [...map.entries()]
    .filter(([k]) => k !== null)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, n]) => ({ bucket: day, count: n }));
}

function computeProductivity(rows, { today = '', completedFrom = null, completedTo = null, roster = [] } = {}) {
  const rosterNames = new Set(
    roster.map((t) => String((t && t.name) || '').trim().toUpperCase()).filter(Boolean)
  );
  const rosterMeta = new Map(
    roster.map((t) => [String((t && t.name) || '').trim().toUpperCase(), t])
  );
  const hasCompletionRange = Boolean(completedFrom || completedTo);

  const inRange = (day) => {
    if (day === null) return !hasCompletionRange;
    if (completedFrom && day < completedFrom) return false;
    if (completedTo && day > completedTo) return false;
    return true;
  };

  const summary = {
    total: rows.length,
    assigned: 0,
    unassigned: 0,
    pending: 0,
    delayed: 0,
    on_hold: 0,
    overdue: 0,
    no_appointment: 0,
    completed: 0,
    cancelled: 0,
    failed: 0,
    unattributed_completions: 0,
    completion_eligible: 0,
    completion_rate: null,
    on_time_eligible: 0,
    on_time_late: 0,
    on_time_rate: null,
    ids: emptyIdSet(),
  };

  const tech = new Map();
  const getTech = (key, name) => {
    if (!tech.has(key)) {
      tech.set(key, {
        technician: name,
        assigned: 0,
        unassigned: 0,
        pending: 0,
        delayed: 0,
        on_hold: 0,
        overdue: 0,
        no_appointment: 0,
        completed: 0,
        cancelled: 0,
        failed: 0,
        unattributed_completions: 0,
        completion_eligible: 0,
        completion_rate: null,
        on_time_eligible: 0,
        on_time_late: 0,
        on_time_rate: null,
        ids: emptyIdSet(),
      });
    }
    return tech.get(key);
  };

  const arrived = new Map();
  const completedDays = new Map();
  const completedRows = [];

  for (const row of rows) {
    const id = row.id;
    const name = row.assigned_technician ? String(row.assigned_technician).trim() : '';
    const status = row.status || 'NEW';
    const createdDay = dayOf(row.created_day);
    const completedDay = dayOf(row.completed_day);
    const appointment = dayOf(row.appointment);
    const isTerminal = TERMINAL.has(status);
    const isCompleted = status === 'COMPLETED' && inRange(completedDay);
    const related = name ? getTech(name.toUpperCase(), name) : null;

    if (name) {
      summary.assigned += 1;
      summary.ids.assigned.push(id);
    } else {
      summary.unassigned += 1;
      summary.ids.unassigned.push(id);
    }
    if (createdDay) arrived.set(createdDay, (arrived.get(createdDay) || 0) + 1);

    if (name) {
      related.assigned += 1;
      related.ids.assigned.push(id);
    }

    if (!isTerminal) {
      const b = status === 'ON HOLD' ? 'on_hold' : status === 'DELAYED' ? 'delayed' : 'pending';
      summary[b] += 1;
      summary.ids[b].push(id);
      if (related) {
        related[b] += 1;
        related.ids[b].push(id);
      }
      if (appointment && today && appointment < today) {
        summary.overdue += 1;
        summary.ids.overdue.push(id);
        if (related) {
          related.overdue += 1;
          related.ids.overdue.push(id);
        }
      } else if (!appointment) {
        summary.no_appointment += 1;
        if (related) related.no_appointment += 1;
      }
    }

    if (isCompleted) {
      summary.completed += 1;
      summary.ids.completed.push(id);
      if (completedDay) completedDays.set(completedDay, (completedDays.get(completedDay) || 0) + 1);
      completedRows.push(row);
    } else if (status === 'CANCELLED') {
      summary.cancelled += 1;
      summary.ids.cancelled.push(id);
      if (related) {
        related.cancelled += 1;
        related.ids.cancelled.push(id);
      }
    } else if (status === 'FAILED') {
      summary.failed += 1;
      summary.ids.failed.push(id);
      if (related) {
        related.failed += 1;
        related.ids.failed.push(id);
      }
    }
  }

  // Completion metrics use the history attribution, never the current assignee.
  for (const row of completedRows) {
    const attrName = row.attributed_tech ? String(row.attributed_tech).trim() : '';
    const appt = dayOf(row.appointment);
    const comp = dayOf(row.completed_day);
    const onTimePair = appt && comp ? comp <= appt : null;

    if (onTimePair !== null) {
      summary.on_time_eligible += 1;
      if (!onTimePair) summary.on_time_late += 1;
    }

    if (attrName) {
      const aw = getTech(attrName.toUpperCase(), attrName);
      aw.completed += 1;
      aw.ids.completed.push(row.id);
      if (onTimePair !== null) {
        aw.on_time_eligible += 1;
        if (!onTimePair) aw.on_time_late += 1;
      }
    } else {
      summary.unattributed_completions += 1;
      const un = getTech('__UNATTRIBUTED__', 'Unattributed');
      un.completed += 1;
      un.unattributed_completions += 1;
      un.ids.completed.push(row.id);
      if (onTimePair !== null) {
        un.on_time_eligible += 1;
        if (!onTimePair) un.on_time_late += 1;
      }
    }
  }

  summary.completion_eligible = summary.assigned - summary.cancelled - summary.failed;
  summary.completion_rate = rate(summary.completed, summary.completion_eligible);
  summary.on_time_rate = rate(summary.on_time_eligible - summary.on_time_late, summary.on_time_eligible);

  const by_technician = [...tech.entries()]
    .filter(([key, t]) => key !== '__UNATTRIBUTED__' && (t.assigned > 0 || t.completed > 0))
    .map(([, t]) => t)
    .sort((a, b) => {
      if (b.assigned !== a.assigned) return b.assigned - a.assigned;
      return a.technician.localeCompare(b.technician);
    });

  for (const t of by_technician) {
    const key = t.technician.trim().toUpperCase();
    const meta = rosterMeta.get(key);
    t.in_roster = rosterNames.has(key);
    t.team = meta ? meta.team || null : null;
    t.completion_eligible = t.assigned - t.cancelled - t.failed;
    t.completion_rate = rate(t.completed, t.completion_eligible);
    t.on_time_rate = rate(t.on_time_eligible - t.on_time_late, t.on_time_eligible);
  }

  const unattributed = tech.get('__UNATTRIBUTED__');
  if (unattributed && unattributed.completed > 0) {
    unattributed.technician = 'Unattributed';
    unattributed.in_roster = false;
    unattributed.team = null;
    unattributed.completion_rate = null;
    unattributed.on_time_rate = rate(unattributed.on_time_eligible - unattributed.on_time_late, unattributed.on_time_eligible);
    by_technician.push(unattributed);
  }
  if (summary.unassigned > 0) {
    by_technician.push({
      technician: 'Unassigned',
      in_roster: false,
      team: null,
      assigned: 0,
      unassigned: summary.unassigned,
      pending: summary.ids.pending.length,
      delayed: 0,
      on_hold: 0,
      overdue: 0,
      no_appointment: 0,
      completed: 0,
      cancelled: 0,
      failed: 0,
      unattributed_completions: 0,
      completion_eligible: 0,
      completion_rate: null,
      on_time_eligible: 0,
      on_time_late: 0,
      on_time_rate: null,
      ids: { ...emptyIdSet(), unassigned: summary.ids.unassigned },
    });
  }

  const disclosure = [];
  if (summary.completed === 0) {
    disclosure.push('No completions in the current data — completion rate is 0% and on-time rate is N/A (no completed work orders yet).');
  }
  if (summary.completed > 0 && summary.unattributed_completions === 0) {
    disclosure.push('All completions were credited to a technician via the work-order history.');
  }
  disclosure.push(
    'Attribution: a completed work order is credited to the technician from the most recent assignment event in work-order history at or before completion time. Work orders completed without such an event are shown as "Unattributed" and are NOT credited to the technician currently on the ticket.'
  );
  disclosure.push(
    'Workload counts reflect the current assigned_technician field. "Pending" excludes DELAYED and ON HOLD; "Overdue" = non-terminal work orders whose appointment is earlier than today (Asia/Manila). Techs with no assigned and no completed work are omitted.'
  );

  return {
    today,
    summary,
    by_technician,
    workload_trend: sortDays(arrived),
    completion_trend: sortDays(completedDays),
    disclosure,
  };
}

module.exports = { computeProductivity, dayOf, rate };