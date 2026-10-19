// Excel / CSV import pipeline: parse -> map -> validate -> resolve NAP -> analyze.
const XLSX = require('xlsx');
const { parse: parseCsv } = require('csv-parse/sync');
const {
  FIELDS,
  FIELD_BY_KEY,
  autoMapColumns,
  parseNumber,
  parseDate,
  dateOnly,
  isValidLatitude,
  isValidLongitude,
  normalizeStatus,
  normalizeChannel,
} = require('./workOrderFields');
const { lookupNaps, resolveCoordinates } = require('./napResolver');
const {
  loadActiveRules,
  classifySignal,
  classifyStatus,
  APPROVED,
  REVIEW,
} = require('./disposition');
const { pool } = require('../config/database');

const CANONICAL_KEYS = FIELDS.map((f) => f.key);

function normNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s || null;
}

// Values that mean "no reference" in the business export. The NAP column is a
// dash when the field is blank, so these must be treated as missing (not as a
// literal NAP ID) when deciding whether to fall back to the facility column.
const PLACEHOLDER_VALUES = new Set(['-', '--', '—', '–', 'n/a', 'n.a.', 'na', 'none', 'null']);
function isPlaceholder(v) {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || PLACEHOLDER_VALUES.has(s);
}

// Join first/last name parts without leftover spaces, nulls, or undefined.
// Returns null when no usable part exists.
function combineParts(...parts) {
  const usable = parts
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter(Boolean);
  return usable.length ? usable.join(' ').replace(/\s+/g, ' ') : null;
}

// Rank an appointment-like value for latest-wins comparison. Accepts ISO and
// dash/slash formats (month-first, matching dateOnly) with optional time.
// Returns ms since epoch valid for comparison, or null when unparseable
// (includes non-datetime slots such as "2026-09-22 PM Slot").
function appointmentRank(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const t = Date.UTC(
      +m[1], +m[2] - 1, +m[3],
      +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)
    );
    return Number.isNaN(t) ? null : t;
  }

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?(AM|PM)?/i);
  if (m) {
    let year = +m[3];
    if (year < 100) year += 2000;
    let h = +(m[4] || 0);
    const min = +(m[5] || 0);
    const sec = +(m[6] || 0);
    if (/pm/i.test(m[7] || '') && h < 12) h += 12;
    if (/am/i.test(m[7] || '') && h === 12) h = 0;
    const t = Date.UTC(year, +m[1] - 1, +m[2], h, min, sec);
    return Number.isNaN(t) ? null : t;
  }

  return null;
}

// Parse an uploaded buffer into headers + raw rows (arrays keyed by index).
function parseUpload(buffer, filename) {
  const name = (filename || '').toLowerCase();
  const isCsv = name.endsWith('.csv');
  let matrix = [];

  if (isCsv) {
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
    matrix = parseCsv(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: false,
    });
  } else {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: false });
  }

  if (!matrix || matrix.length === 0) {
    return { headers: [], rawRows: [], fileType: isCsv ? 'csv' : 'xlsx' };
  }

  // Find the header row: first row with at least 2 non-empty cells.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const nonEmpty = matrix[i].filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
    if (nonEmpty.length >= 2) {
      headerIdx = i;
      break;
    }
  }

  const rawHeaders = matrix[headerIdx].map((h, i) =>
    h === null || h === undefined || String(h).trim() === '' ? `Column ${i + 1}` : String(h).trim()
  );

  // Disambiguate duplicate header names while keeping them readable.
  const seen = {};
  const headers = rawHeaders.map((h) => {
    if (seen[h] === undefined) {
      seen[h] = 0;
      return h;
    }
    seen[h] += 1;
    return `${h} (${seen[h]})`;
  });

  const rawRows = [];
  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const obj = {};
    let hasValue = false;
    headers.forEach((_, i) => {
      const v = row[i] === undefined ? null : row[i];
      obj[i] = v;
      if (v !== null && String(v).trim() !== '') hasValue = true;
    });
    if (hasValue) rawRows.push({ rowNumber: r + 1, cells: obj });
  }

  return { headers, rawRows, fileType: isCsv ? 'csv' : 'xlsx' };
}

// Apply a column->field mapping to produce canonical data + preserved extras.
function mapRows(headers, rawRows, mapping) {
  const mappedFields = new Set(Object.values(mapping));
  const out = [];

  for (const raw of rawRows) {
    const data = {};
    const extras = {};

    headers.forEach((header, idx) => {
      const field = mapping[String(idx)];
      const value = raw.cells[idx];
      if (field && FIELD_BY_KEY[field]) {
        // Last column wins only if the current stored value is empty.
        if (data[field] === undefined || data[field] === null || data[field] === '') {
          data[field] = value;
        }
      } else if (value !== null && value !== undefined && String(value).trim() !== '') {
        extras[header] = value;
      }
    });

    // Combine split name columns into the canonical single-name fields.
    // The split fields win: customer name is always First + Last when the
    // first/last columns are mapped, overriding any combined-name column.
    if (data.customer_first_name !== undefined || data.customer_last_name !== undefined) {
      const full = combineParts(data.customer_first_name, data.customer_last_name);
      if (full) data.customer_name = full;
    }
    if (!data.assigned_technician && (data.technician_first_name !== undefined || data.technician_last_name !== undefined)) {
      const full = combineParts(data.technician_first_name, data.technician_last_name);
      if (full) data.assigned_technician = full;
    }
    // The business file format identifies the NAP via the facility column.
    // Use it as the NAP reference unless an explicit NAP field is mapped.
    // A placeholder NAP value ("-", "N/A", ...) counts as not-mapped, otherwise
    // the dash would shadow the facility code and break NAP matching.
    if (isPlaceholder(data.nap_id) && !isPlaceholder(data.facility)) {
      data.nap_id = data.facility;
    }
    delete data.customer_first_name;
    delete data.customer_last_name;
    delete data.technician_first_name;
    delete data.technician_last_name;

    out.push({ rowNumber: raw.rowNumber, data, extras });
  }
  return out;
}

function coerceData(data) {
  const d = {};
  d.work_order_number = normNumber(data.work_order_number);
  d.customer_name = normNumber(data.customer_name);
  d.customer_address = normNumber(data.customer_address);
  d.customer_contact = normNumber(data.customer_contact);
  d.nap_id = normNumber(data.nap_id);
  d.area = normNumber(data.area);
  d.territory = normNumber(data.territory);
  d.barangay = normNumber(data.barangay);
  d.facility = normNumber(data.facility);
  d.contractor = normNumber(data.contractor);
  d.appointment = dateOnly(data.appointment);
  d.plan_type = normNumber(data.plan_type);
  d.service_type = normNumber(data.service_type);
  d.priority = normNumber(data.priority);
  d.assigned_technician = normNumber(data.assigned_technician);
  d.assigned_team = normNumber(data.assigned_team);
  d.dispatch_notes = normNumber(data.dispatch_notes);
  d.delay_reason = normNumber(data.delay_reason);
  d.completion_notes = normNumber(data.completion_notes);
  d.original_status = normNumber(data.status);
  d.raw_disposition = normNumber(data.disposition);
  d.raw_channel = normNumber(data.source_channel);
  d.date_created = parseDate(data.date_created);
  d.last_updated = parseDate(data.last_updated);
  d.completion_date = parseDate(data.completion_date);
  d.source_latitude = parseNumber(data.latitude);
  d.source_longitude = parseNumber(data.longitude);
  // Retain the raw (pre-coercion) appointment for latest-wins comparison.
  d._raw_appointment = data.appointment === null || data.appointment === undefined
    ? null
    : String(data.appointment).trim();
  return d;
}

function statusAllowedOnImport(importedStatus, options) {
  // Never auto-complete from an imported status unless explicitly allowed.
  if (importedStatus === 'COMPLETED' && !options.trustImportedCompletion) return false;
  if (importedStatus === 'CANCELLED' && !options.trustImportedCompletion) return false;
  if (importedStatus === 'FAILED' && !options.trustImportedCompletion) return false;
  return true;
}

// Fetch existing work orders for a set of numbers -> Map(number -> row).
async function loadExistingByNumbers(numbers) {
  const clean = [...new Set(numbers.filter(Boolean))];
  const map = new Map();
  if (clean.length === 0) return map;
  const CHUNK = 2000;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const chunk = clean.slice(i, i + CHUNK);
    const { rows } = await pool.query(
      `SELECT * FROM work_orders WHERE work_order_number = ANY($1) AND deleted_at IS NULL`,
      [chunk]
    );
    for (const row of rows) map.set(row.work_order_number, row);
  }
  return map;
}

// Strict, approved-only disposition classification for an import row.
// Never guesses: approved mappings apply, everything else is flagged for review.
function classifyImportDisposition({ d, hasDispositionCol, rules }) {
  const rawStatus = d.original_status;
  const rawDisp = d.raw_disposition;

  const result = {
    meta: {
      fsm_disposition: rawDisp && String(rawDisp).trim() !== '' ? rawDisp : null,
      disposition: null,
      disposition_category: null,
      disposition_rule_id: null,
      disposition_confidence: 'none',
      disposition_review_status: 'none',
      disposition_review_note: null,
      suggested_status: null,
    },
    review: null,
    action: 'none',
  };

  const hasRawDisp = rawDisp != null && String(rawDisp).trim() !== '';
  const hasRawStatus = rawStatus != null && String(rawStatus).trim() !== '';
  if (!hasRawDisp && !hasRawStatus) return result;

  let decision;
  let origin;
  if (hasRawDisp) {
    decision = classifySignal({
      signal: rawDisp,
      isStatusSignal: false,
      rules,
      context: { rawStatus },
    });
    origin = 'disposition';
  } else if (!hasDispositionCol) {
    // No disposition column: the FSM status is the only signal. Prefer a strict
    // status alias; fall back to the disposition dictionary otherwise.
    const s = classifyStatus(rawStatus, rules);
    if (s.matched) {
      decision = {
        confidence: APPROVED,
        disposition: null,
        category: null,
        operational_status: s.operational_status,
        rule_id: s.rule_id,
        kind: s.kind,
        reason: s.reason,
        review: null,
      };
    } else {
      decision = classifySignal({ signal: rawStatus, isStatusSignal: false, rules, context: {} });
    }
    origin = 'status';
  } else {
    // Disposition column present but the cell is blank: keep the status
    // strictly as an operational status, never guess a disposition for it.
    decision = classifySignal({ signal: rawStatus, isStatusSignal: true, rules });
    origin = 'status';
  }

  const isConflict = decision.review && String(decision.review).startsWith('conflict:');
  // Only disposition rules may drive the operational status. Pure status-alias
  // values are handled by the strict status logic + terminal-status gate.
  const fromStatusAlias = decision.kind === 'status';

  if (decision.confidence === APPROVED && !isConflict) {
    result.meta.disposition = decision.disposition;
    result.meta.disposition_category = decision.category;
    result.meta.disposition_rule_id = decision.rule_id;
    result.meta.suggested_status = fromStatusAlias ? null : decision.operational_status || null;
    if (fromStatusAlias && !decision.disposition) {
      // No close-code was present — the status alias only normalized the
      // operational status. Do not count this as a disposition classification.
      result.meta.disposition_confidence = 'none';
      result.meta.disposition_review_status = 'none';
      result.meta.disposition_review_note = null;
      result.action = 'none';
    } else {
      result.meta.disposition_confidence = APPROVED;
      result.meta.disposition_review_note = decision.reason;
      result.action = 'mapped';
    }
    return result;
  }

  result.meta.disposition_confidence = REVIEW;
  result.meta.disposition_review_status = 'review_required';
  result.meta.disposition_review_note = decision.review
    ? String(decision.review).replace(/^(conflict|disposition|status):/, '')
    : decision.reason || 'Requires review';
  if (!isConflict) {
    result.meta.suggested_status = decision.operational_status || null;
  }
  result.review = {
    original_disposition: hasRawDisp ? rawDisp : null,
    original_fsm_status: hasRawStatus ? rawStatus : null,
    suggested_disposition: decision.disposition,
    suggested_category: decision.category,
    suggested_status: decision.operational_status || null,
    rule_id: decision.rule_id || null,
    reason: isConflict
      ? `Conflicting: ${String(decision.review).replace(/^conflict:/, '')}`
      : decision.reason,
    origin,
  };
  result.action = isConflict ? 'conflict' : 'unknown';
  return result;
}

// Full analysis used by both preview and commit.
async function analyzeImport({ headers, rawRows, mapping, statuses, channels, options = {} }) {
  const opts = {
    trustImportedCompletion: false,
    importWithoutNumber: true,
    ...options,
  };

  const mapped = mapRows(headers, rawRows, mapping);
  const napIds = mapped.map((m) => m.data.nap_id).filter(Boolean);
  const napMap = await lookupNaps(napIds);

  // Pre-load existing records for update/duplicate detection.
  const allNumbers = mapped.map((m) => normNumber(m.data.work_order_number)).filter(Boolean);
  const existing = await loadExistingByNumbers(allNumbers);

  const dispositionRules = await loadActiveRules();
  const hasDispositionCol = Object.values(mapping || {}).includes('disposition');

  const seenNumbers = new Map();
  const rowByNumber = new Map();
  const rows = [];

  for (const { rowNumber, data, extras } of mapped) {
    const errors = [];
    const warnings = [];
    const d = coerceData(data);
    // Sync ingestion (folder/SFTP/HTTP push) must never stomp what dispatch
    // staff assigned on a record that already exists. Only human-reviewed
    // manual imports may refresh those fields. See mergeWorkOrder.
    if (opts.preserveSyncedOverrides) d._preserve_synced_overrides = true;

    if (!d.work_order_number && !opts.importWithoutNumber) {
      errors.push('Missing work order number');
    }
    if (d.source_latitude != null && !isValidLatitude(d.source_latitude)) {
      warnings.push(`Latitude out of range: ${d.source_latitude}`);
      d.source_latitude = null;
    }
    if (d.source_longitude != null && !isValidLongitude(d.source_longitude)) {
      warnings.push(`Longitude out of range: ${d.source_longitude}`);
      d.source_longitude = null;
    }

    let duplicateInFile = false;
    if (d.work_order_number) {
      if (seenNumbers.has(d.work_order_number)) {
        duplicateInFile = true;
        seenNumbers.get(d.work_order_number).push(rowNumber);
      } else {
        seenNumbers.set(d.work_order_number, [rowNumber]);
      }
    }

    const resolution = resolveCoordinates(
      { napId: d.nap_id, sourceLat: d.source_latitude, sourceLng: d.source_longitude },
      napMap
    );

    if (d.nap_id && resolution.nap_match_status === 'not_found') {
      warnings.push(`NAP ID "${d.nap_id}" not found in NAP database`);
    }
    if (resolution.coord_conflict) {
      warnings.push(
        `Coordinate conflict: file location differs from NAP database by ${Math.round(resolution.coord_diff_meters)}m`
      );
    }
    if (resolution.nap_match_status === 'matched_no_coords') {
      warnings.push('Matched NAP has no coordinates');
    }
    if (!d.nap_id) warnings.push('Missing NAP ID');
    if (resolution.latitude == null || resolution.longitude == null) {
      warnings.push('No valid coordinates (unmapped)');
    }
    if (!d.raw_channel) {
      warnings.push('Missing source channel (needs manual assignment)');
    }

    const importedStatus = normalizeStatus(d.original_status, statuses);
    const normalizedChannel = normalizeChannel(d.raw_channel, channels);

    // Strict imported status, subject to the terminal-status safety gate.
    const safeStatus = importedStatus && statusAllowedOnImport(importedStatus, opts) ? importedStatus : 'NEW';
    let resolvedStatus = safeStatus;
    let statusSource = importedStatus && statusAllowedOnImport(importedStatus, opts) ? 'import' : 'default';

    // Disposition classification (approved-only, never guessed).
    const dispResult = classifyImportDisposition({
      d,
      hasDispositionCol,
      rules: dispositionRules,
    });
    if (
      dispResult.meta.suggested_status &&
      dispResult.meta.disposition_confidence === APPROVED &&
      dispResult.meta.suggested_status !== resolvedStatus
    ) {
      resolvedStatus = dispResult.meta.suggested_status;
      statusSource = 'import';
    }

    const existingRow = d.work_order_number ? existing.get(d.work_order_number) : null;
    let action;
    if (duplicateInFile) action = 'duplicate';
    else if (errors.length > 0) action = 'reject';
    else if (existingRow) action = 'update';
    else action = 'add';

    // Latest-valid-appointment rule. A re-import must never downgrade the
    // dispatch record to an earlier appointment, and a missing or invalid
    // source appointment must not erase a valid existing one. When the
    // correct record cannot be determined, flag it for human review.
    const incomingRank = appointmentRank(d._raw_appointment);
    if (d.work_order_number && existingRow) {
      const existingRank = appointmentRank(existingRow.appointment);
      if (incomingRank == null) {
        if (existingRank != null) {
          d._appointment_keep_existing = true;
          warnings.push('Missing/invalid appointment in import; kept existing appointment');
        } else {
          warnings.push('Missing/invalid appointment date — cannot determine correct record');
        }
      } else if (existingRank != null && incomingRank < existingRank) {
        d._appointment_keep_existing = true;
        warnings.push(
          `Older appointment skipped (existing ${existingRow.appointment || '(none)'} kept)`
        );
      } else if (existingRank == null || incomingRank > existingRank) {
        if (existingRank != null) {
          warnings.push(`Appointment updated to newer date (${d.appointment})`);
        }
      }
    }

    rows.push({
      rowNumber,
      action,
      disposition_action: dispResult.action,
      data: {
        ...d,
        status: importedStatus,
        resolved_status: resolvedStatus,
        status_source: statusSource,
        source_channel: normalizedChannel,
        channel_source: normalizedChannel ? 'import' : null,
        ...dispResult.meta,
        latitude: resolution.latitude,
        longitude: resolution.longitude,
        coordinate_source: resolution.coordinate_source,
        nap_match_status: resolution.nap_match_status,
        coord_conflict: resolution.coord_conflict,
        coord_diff_meters: resolution.coord_diff_meters,
      },
      disposition_review: dispResult.review,
      nap: resolution.nap
        ? {
            nap_id: resolution.nap.nap_id,
            city_name: resolution.nap.city_name,
            province_name: resolution.nap.province_name,
            barangay_name: resolution.nap.barangay_name,
            building_served: resolution.nap.building_served,
            dp_nap_lat: resolution.nap.dp_nap_lat,
            dp_nap_long: resolution.nap.dp_nap_long,
          }
        : null,
      existing_id: existingRow ? existingRow.id : null,
      existing_row: existingRow || null,
      extras,
      errors,
      warnings,
    });
    if (d.work_order_number) rowByNumber.set(rowNumber, rows[rows.length - 1]);
  }

  // In-file duplicates: keep the entry with the latest valid appointment.
  // Rows that lose the latest-appointment contest become duplicates; a group
  // with no valid appointment anywhere is flagged because the correct record
  // cannot be determined.
  for (const [num, rowNumbers] of seenNumbers) {
    if (!num || rowNumbers.length < 2) continue;
    const entries = rowNumbers.map((rn) => {
      const row = rowByNumber.get(rn);
      return { rowNumber: rn, rank: row ? appointmentRank(row.data._raw_appointment) : null, row };
    });
    const valid = entries.filter((e) => e.rank != null);
    const winner = valid.length
      ? entries.reduce((w, e) => (e.rank != null && e.rank > w.rank ? e : w))
      : entries[0];
    for (const e of entries) {
      if (!e.row || e.rowNumber === winner.rowNumber) continue;
      e.row.action = 'duplicate';
      e.row.warnings.push(
        winner.rank == null
          ? 'Duplicate in file: kept the matching record'
          : `Duplicate in file: kept the record with the later appointment (${winner.row.data.appointment || '(none)'})`
      );
    }
    if (winner.row) {
      const existingRow = winner.row.existing_row || existing.get(num);
      winner.row.action = winner.row.errors.length
        ? 'reject'
        : existingRow
          ? 'update'
          : 'add';
      if (winner.rank == null) {
        winner.row.warnings.push(
          'Duplicate in file: no valid appointment among matching records — cannot determine correct record'
        );
      }
    }
  }

  const summary = summarize(rows, rawRows.length);
  return { rows, summary, mapping };
}

function summarize(rows, totalRows) {
  const s = {
    total_rows: totalRows,
    added: 0,
    updated: 0,
    skipped: 0,
    duplicated: 0,
    rejected: 0,
    flagged: 0,
    disposition: { mapped: 0, unknown: 0, conflicting: 0, unresolved: 0 },
  };
  for (const r of rows) {
    if (r.action === 'add') s.added++;
    else if (r.action === 'update') s.updated++;
    else if (r.action === 'duplicate') s.duplicated++;
    else if (r.action === 'reject') s.rejected++;
    else if (r.action === 'skip') s.skipped++;
    if (r.disposition_action === 'mapped') s.disposition.mapped++;
    else if (r.disposition_action === 'unknown') {
      s.disposition.unknown++;
      s.disposition.unresolved++;
    } else if (r.disposition_action === 'conflict') {
      s.disposition.conflicting++;
      s.disposition.unresolved++;
    }
    if (
      r.warnings &&
      r.warnings.some((w) =>
        /conflict|not found|Missing NAP ID|unmapped|Missing source channel|appointment/i.test(w)
      )
    ) {
      s.flagged++;
    }
  }
  return s;
}

// Merge incoming data into an existing record, preserving manual overrides.
function mergeWorkOrder(existing, incoming) {
  const merged = {};
  const textFields = [
    'customer_name', 'customer_address', 'customer_contact', 'area', 'territory',
    'barangay', 'facility', 'plan_type', 'service_type', 'priority',
    'assigned_technician', 'assigned_team', 'contractor',
  ];
  for (const f of textFields) {
    merged[f] = incoming[f] != null && incoming[f] !== '' ? incoming[f] : existing[f];
  }

  // Appointment honors the latest-valid-appointment rule decided at analyze
  // time: never downgrade to an older date, never erase a valid date with a
  // missing/invalid one.
  if (incoming._appointment_keep_existing) {
    merged.appointment = existing.appointment;
  } else {
    merged.appointment = incoming.appointment != null && incoming.appointment !== ''
      ? incoming.appointment
      : existing.appointment;
  }
  merged.nap_id = incoming.nap_id != null && incoming.nap_id !== '' ? incoming.nap_id : existing.nap_id;

  // Preserve manual coordinate corrections.
  if (existing.coordinate_source === 'manual') {
    merged.latitude = existing.latitude;
    merged.longitude = existing.longitude;
    merged.coordinate_source = 'manual';
    merged.coord_conflict = existing.coord_conflict;
    merged.coord_diff_meters = existing.coord_diff_meters;
  } else {
    merged.latitude = incoming.latitude;
    merged.longitude = incoming.longitude;
    merged.coordinate_source = incoming.coordinate_source;
    merged.coord_conflict = incoming.coord_conflict;
    merged.coord_diff_meters = incoming.coord_diff_meters;
  }

  merged.nap_match_status = incoming.nap_match_status;

  // Preserve manually changed status.
  if (existing.status_source === 'manual') {
    merged.status = existing.status;
    merged.status_source = 'manual';
  } else {
    merged.status = incoming.status_source === 'import' ? incoming.status : existing.status;
    merged.status_source = incoming.status_source === 'import' ? 'import' : existing.status_source || 'import';
  }

  // Preserve manually assigned channel.
  if (existing.channel_source === 'manual') {
    merged.source_channel = existing.source_channel;
    merged.channel_source = 'manual';
  } else if (incoming.source_channel) {
    merged.source_channel = incoming.source_channel;
    merged.channel_source = incoming.channel_source;
  } else {
    merged.source_channel = existing.source_channel;
    merged.channel_source = existing.channel_source;
  }

  merged.dispatch_notes = incoming.dispatch_notes != null && incoming.dispatch_notes !== ''
    ? incoming.dispatch_notes
    : existing.dispatch_notes;
  merged.delay_reason = incoming.delay_reason != null && incoming.delay_reason !== ''
    ? incoming.delay_reason
    : existing.delay_reason;
  merged.completion_notes = incoming.completion_notes != null && incoming.completion_notes !== ''
    ? incoming.completion_notes
    : existing.completion_notes;

  merged.original_status = incoming.original_status != null && incoming.original_status !== ''
    ? incoming.original_status
    : existing.original_status;

  // Disposition re-derived from the file. A disposition a reviewer already
  // cleared stays untouched on re-import; only fsm_disposition refreshes.
  merged.fsm_disposition = incoming.fsm_disposition != null && incoming.fsm_disposition !== ''
    ? incoming.fsm_disposition
    : existing.fsm_disposition;
  if (existing.disposition_review_status === 'cleared' && incoming.disposition_review_status !== 'review_required') {
    merged.disposition = existing.disposition;
    merged.disposition_category = existing.disposition_category;
    merged.disposition_rule_id = existing.disposition_rule_id;
    merged.disposition_confidence = existing.disposition_confidence;
    merged.disposition_review_status = existing.disposition_review_status;
    merged.disposition_review_note = existing.disposition_review_note;
  } else {
    merged.disposition = incoming.disposition != null ? incoming.disposition : existing.disposition;
    merged.disposition_category = incoming.disposition_category != null ? incoming.disposition_category : existing.disposition_category;
    merged.disposition_rule_id = incoming.disposition_rule_id != null ? incoming.disposition_rule_id : existing.disposition_rule_id;
    merged.disposition_confidence = incoming.disposition_confidence != null ? incoming.disposition_confidence : existing.disposition_confidence;
    merged.disposition_review_status = incoming.disposition_review_status != null ? incoming.disposition_review_status : existing.disposition_review_status;
    merged.disposition_review_note = incoming.disposition_review_note != null ? incoming.disposition_review_note : existing.disposition_review_note;
  }

  merged.date_created = incoming.date_created || existing.date_created;
  merged.last_updated = incoming.last_updated || existing.last_updated;
  merged.completion_date = incoming.completion_date || existing.completion_date;
  merged.source_latitude = incoming.source_latitude != null ? incoming.source_latitude : existing.source_latitude;
  merged.source_longitude = incoming.source_longitude != null ? incoming.source_longitude : existing.source_longitude;

  // Sync ingestion is not authoritative for dispatch-owned fields. When an
  // existing record is re-imported by folder/SFTP/HTTP push, technician,
  // team, contractor, and the resolved NAP/coordinates always keep the values
  // dispatch staff set — the file only refreshes them on first creation.
  if (incoming._preserve_synced_overrides) {
    merged.assigned_technician = existing.assigned_technician;
    merged.assigned_team = existing.assigned_team;
    merged.contractor = existing.contractor;
    merged.nap_id = existing.nap_id;
    merged.latitude = existing.latitude;
    merged.longitude = existing.longitude;
    merged.coordinate_source = existing.coordinate_source;
    merged.coord_conflict = existing.coord_conflict;
    merged.coord_diff_meters = existing.coord_diff_meters;
    merged.nap_match_status = existing.nap_match_status;
  }

  return merged;
}

async function executeImport({ headers, rawRows, mapping, statuses, channels, options, actor, sourceFile, batchId }) {
  const { rows, summary } = await analyzeImport({ headers, rawRows, mapping, statuses, channels, options });

  const client = await pool.connect();
  const result = { ...summary };
  const errorsList = [];

  try {
    await client.query('BEGIN');

    for (const row of rows) {
      if (row.action === 'duplicate' || row.action === 'reject') continue;

      const d = row.data;
      let woId = null;
      try {
        if (row.action === 'add') {
          woId = await insertWorkOrder(client, d, row.extras, sourceFile, batchId);
          await addHistory(client, woId, {
            action: 'imported',
            note: `Imported from ${sourceFile || 'upload'}`,
            actor,
          });
        } else if (row.action === 'update' && row.existing_row) {
          woId = row.existing_row.id;
          const merged = mergeWorkOrder(row.existing_row, d);
          await updateWorkOrder(client, woId, merged);
          if (merged.status !== row.existing_row.status) {
            await addHistory(client, woId, {
              action: 'status_change',
              field: 'status',
              oldValue: row.existing_row.status,
              newValue: merged.status,
              note: `Updated via import from ${sourceFile || 'upload'}`,
              actor,
            });
          } else {
            await addHistory(client, woId, {
              action: 'imported_update',
              note: `Updated via import from ${sourceFile || 'upload'}`,
              actor,
            });
          }
        }

        // Flag the new/open disposition review for human resolution.
        if (woId && row.disposition_review) {
          await createDispositionReview(client, woId, row.disposition_review, actor);
        }
      } catch (rowErr) {
        errorsList.push({ row: row.rowNumber, error: rowErr.message });
        result.rejected += 1;
        if (row.action === 'add') result.added -= 1;
        if (row.action === 'update') result.updated -= 1;
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { summary: result, errors: errorsList };
}

async function insertWorkOrder(client, d, extras, sourceFile, batchId) {
  const cols = [
    'work_order_number', 'customer_name', 'customer_address', 'customer_contact',
    'nap_id', 'latitude', 'longitude', 'source_latitude', 'source_longitude',
    'coordinate_source', 'nap_match_status', 'coord_conflict', 'coord_diff_meters',
    'area', 'territory', 'barangay', 'facility', 'plan_type', 'service_type',
    'priority', 'date_created', 'last_updated', 'completion_date', 'status',
    'status_source', 'original_status', 'source_channel', 'channel_source',
    'assigned_technician', 'assigned_team', 'dispatch_notes', 'delay_reason',
    'completion_notes', 'contractor', 'appointment',
    'fsm_disposition', 'disposition', 'disposition_category', 'disposition_rule_id',
    'disposition_confidence', 'disposition_review_status', 'disposition_review_note',
    'source_file', 'import_batch_id', 'extra',
  ];
  const values = [
    d.work_order_number, d.customer_name, d.customer_address, d.customer_contact,
    d.nap_id, d.latitude, d.longitude, d.source_latitude, d.source_longitude,
    d.coordinate_source, d.nap_match_status, d.coord_conflict, d.coord_diff_meters,
    d.area, d.territory, d.barangay, d.facility, d.plan_type, d.service_type,
    d.priority, d.date_created, d.last_updated, d.completion_date, d.resolved_status,
    d.status_source, d.original_status, d.source_channel, d.channel_source,
    d.assigned_technician, d.assigned_team, d.dispatch_notes, d.delay_reason,
    d.completion_notes, d.contractor, d.appointment,
    d.fsm_disposition, d.disposition, d.disposition_category, d.disposition_rule_id,
    d.disposition_confidence, d.disposition_review_status, d.disposition_review_note,
    sourceFile || null, batchId || null,
    extras && Object.keys(extras).length ? JSON.stringify(extras) : null,
  ];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await client.query(
    `INSERT INTO work_orders (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values
  );
  return rows[0].id;
}

async function updateWorkOrder(client, id, m) {
  await client.query(
    `UPDATE work_orders SET
      customer_name = $2, customer_address = $3, customer_contact = $4, nap_id = $5,
      latitude = $6, longitude = $7, source_latitude = $8, source_longitude = $9,
      coordinate_source = $10, nap_match_status = $11, coord_conflict = $12,
      coord_diff_meters = $13, area = $14, territory = $15, barangay = $16,
      facility = $17, plan_type = $18, service_type = $19, priority = $20,
      date_created = $21, last_updated = $22, completion_date = $23, status = $24,
      status_source = $25, original_status = $26, source_channel = $27,
      channel_source = $28, assigned_technician = $29, assigned_team = $30,
      dispatch_notes = $31, delay_reason = $32, completion_notes = $33,
      contractor = $34, appointment = $35,
      fsm_disposition = $36, disposition = $37, disposition_category = $38,
      disposition_rule_id = $39, disposition_confidence = $40,
      disposition_review_status = $41, disposition_review_note = $42,
      updated_at = NOW()
     WHERE id = $1`,
    [
      id, m.customer_name, m.customer_address, m.customer_contact, m.nap_id,
      m.latitude, m.longitude, m.source_latitude, m.source_longitude,
      m.coordinate_source, m.nap_match_status, m.coord_conflict,
      m.coord_diff_meters, m.area, m.territory, m.barangay,
      m.facility, m.plan_type, m.service_type, m.priority,
      m.date_created, m.last_updated, m.completion_date, m.status,
      m.status_source, m.original_status, m.source_channel,
      m.channel_source, m.assigned_technician, m.assigned_team,
      m.dispatch_notes, m.delay_reason, m.completion_notes,
      m.contractor, m.appointment,
      m.fsm_disposition, m.disposition, m.disposition_category,
      m.disposition_rule_id, m.disposition_confidence,
      m.disposition_review_status, m.disposition_review_note,
    ]
  );
}

// Open a disposition review item. A work order can only have one open review;
// re-imports that re-flag the record keep the original item.
async function createDispositionReview(client, woId, review, actor) {
  await client.query(
    `INSERT INTO disposition_reviews
       (work_order_id, original_disposition, original_fsm_status, suggested_disposition,
        suggested_category, suggested_status, rule_id, reason, actor_id, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (work_order_id) WHERE status = 'open' DO NOTHING`,
    [
      woId,
      review.original_disposition,
      review.original_fsm_status,
      review.suggested_disposition,
      review.suggested_category,
      review.suggested_status,
      review.rule_id,
      review.reason,
      actor && actor.id ? actor.id : null,
      actor && (actor.name || actor.employee_id) ? actor.name || actor.employee_id : null,
    ]
  );
}

async function addHistory(client, workOrderId, { action, field, oldValue, newValue, note, actor }) {
  await client.query(
    `INSERT INTO work_order_history
       (work_order_id, action, field, old_value, new_value, note, actor_id, actor_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      workOrderId,
      action,
      field || null,
      oldValue != null ? String(oldValue) : null,
      newValue != null ? String(newValue) : null,
      note || null,
      actor && actor.id ? actor.id : null,
      actor && (actor.name || actor.employee_id) ? actor.name || actor.employee_id : null,
    ]
  );
}

module.exports = {
  parseUpload,
  mapRows,
  analyzeImport,
  executeImport,
  mergeWorkOrder,
  loadExistingByNumbers,
  addHistory,
  appointmentRank,
  CANONICAL_KEYS,
};
