// Canonical work-order fields, header aliases, and value coercion.
// Uploaded files vary wildly in column naming, so detection is alias based.

const FIELDS = [
  {
    key: 'work_order_number',
    label: 'Work Order Number / Job Order',
    type: 'text',
    aliases: [
      'work order', 'workorder', 'work order number', 'workordernumber', 'wo',
      'wo number', 'wo no', 'wo id', 'job order', 'job order number', 'joborder',
      'joborder number', 'jo', 'jo number', 'order number',
      'order no', 'ticket', 'ticket number', 'ticket no', 'ticket id',
      'reference', 'reference number', 'ref no', 'service order',
      'service order number', 'wono', 'wo_no', 'work order no', 'job order no',
      // orderActionId is the canonical source in the business file format.
      // Intentionally no 'order id' alias so a plain orderId column is never
      // mistaken for the work order number.
      'order action id', 'orderactionid', 'order action', 'orderaction',
      'action id', 'actionid', 'job action id',
    ],
  },
  {
    key: 'customer_name',
    label: 'Customer / Subscriber Name',
    type: 'text',
    aliases: [
      'customer', 'customer name', 'customername', 'subscriber',
      'subscriber name', 'name', 'account name', 'client', 'client name',
      'customer subscriber name', 'sub name', 'subscriber s name',
    ],
  },
  {
    key: 'customer_first_name',
    label: 'Customer First Name',
    type: 'text',
    aliases: [
      'customer first name', 'customerfirstname', 'customer firstname',
      'first name', 'firstname', 'first', 'given name', 'customer given name',
    ],
  },
  {
    key: 'customer_last_name',
    label: 'Customer Last Name',
    type: 'text',
    aliases: [
      'customer last name', 'customerlastname', 'customer lastname',
      'last name', 'lastname', 'surname', 'family name', 'customer surname',
    ],
  },
  {
    key: 'customer_address',
    label: 'Customer Address',
    type: 'text',
    aliases: [
      'address', 'customer address', 'service address', 'installation address',
      'addr', 'site address', 'complete address', 'home address',
    ],
  },
  {
    key: 'customer_contact',
    label: 'Customer Contact Number',
    type: 'text',
    aliases: [
      'contact', 'contact number', 'contact no', 'mobile', 'mobile number',
      'mobile no', 'phone', 'phone number', 'telephone', 'telephone number',
      'customer contact', 'subscriber contact', 'cp number', 'cellphone',
      'contact details',
    ],
  },
  {
    key: 'nap_id',
    label: 'NAP ID',
    type: 'text',
    aliases: [
      'nap', 'nap id', 'napid', 'nap code', 'napcode', 'nap no', 'nap number',
      'dp', 'dp id', 'dpid', 'dp code', 'cabinet', 'nap cabinet', 'nap name',
    ],
  },
  {
    key: 'latitude',
    label: 'Latitude',
    type: 'number',
    aliases: [
      'latitude', 'lat', 'y', 'ycoord', 'y coordinate', 'lattitude',
      'latitude y', 'lat y',
    ],
  },
  {
    key: 'longitude',
    label: 'Longitude',
    type: 'number',
    aliases: [
      'longitude', 'lng', 'long', 'lon', 'x', 'xcoord', 'x coordinate',
      'longtitude', 'longitude x', 'long x',
    ],
  },
  {
    key: 'area',
    label: 'Area',
    type: 'text',
    aliases: ['area', 'region', 'cluster', 'zone', 'area name'],
  },
  {
    key: 'territory',
    label: 'Territory',
    type: 'text',
    aliases: ['territory', 'territory name', 'terr', 'district', 'teriitory'],
  },
  {
    key: 'barangay',
    label: 'Barangay',
    type: 'text',
    aliases: ['barangay', 'brgy', 'brgy.', 'baranggay', 'bgy', 'barangay name', 'brgy name'],
  },
  {
    key: 'facility',
    label: 'Facility',
    type: 'text',
    aliases: ['facility', 'building', 'building served', 'site', 'facility name'],
  },
  {
    key: 'contractor',
    label: 'Contractor',
    type: 'text',
    aliases: [
      'contractor', 'contractor name', 'contractor company', 'contractor firm',
      'assigned contractor', 'crew contractor', 'vendor', 'vendor name',
    ],
  },
  {
    key: 'appointment',
    label: 'Appointment',
    type: 'date',
    aliases: [
      'appointment', 'appointment date', 'appointment date time', 'appointment time',
      'appt', 'appt date', 'appointment schedule', 'schedule', 'scheduled date',
      'scheduled time', 'schedule date', 'slot', 'time slot',
    ],
  },
  {
    key: 'plan_type',
    label: 'Plan / Package',
    type: 'text',
    aliases: ['plan', 'plan type', 'package', 'product', 'offer', 'plan name', 'promo'],
  },
  {
    key: 'service_type',
    label: 'Service Type',
    type: 'text',
    aliases: ['service', 'service type', 'service plan', 'subscription', 'service name'],
  },
  {
    key: 'date_created',
    label: 'Date Created',
    type: 'date',
    aliases: [
      'date created', 'created', 'created date', 'created at', 'created on',
      'datecreated', 'order date', 'date ordered', 'wo date', 'date',
      'ticket date', 'registration date', 'date registered',
    ],
  },
  {
    key: 'last_updated',
    label: 'Last Updated',
    type: 'date',
    aliases: [
      'last updated', 'updated', 'updated date', 'updated at', 'updated on',
      'modified', 'modified date', 'last update', 'last modified',
    ],
  },
  {
    key: 'completion_date',
    label: 'Completion Date',
    type: 'date',
    aliases: [
      'completion date', 'completed date', 'date completed', 'completed at',
      'completion', 'done date', 'date done', 'completion datetime',
    ],
  },
  {
    key: 'status',
    label: 'Current Status',
    type: 'status',
    aliases: [
      'status', 'wo status', 'work order status', 'order status',
      'current status', 'state', 'job status', 'wo state', 'validation status',
      'fsm status',
    ],
  },
  {
    key: 'disposition',
    label: 'Disposition / Close Code',
    type: 'text',
    aliases: [
      'disposition', 'disposition code', 'disposition reason', 'close code',
      'closecode', 'closing code', 'close reason', 'closing reason',
      'resolution code', 'resolution', 'resolve code', 'fsm disposition',
      'outcome', 'outcome code', 'reason code', 'termination code',
      'final disposition', 'status disposition',
    ],
  },
  {
    key: 'source_channel',
    label: 'Source Channel',
    type: 'channel',
    aliases: [
      'channel', 'source channel', 'source', 'originating channel',
      'sales channel', 'order channel', 'channel source', 'source of order',
      'store channel', 'acquisition channel',
    ],
  },
  {
    key: 'assigned_technician',
    label: 'Assigned Technician',
    type: 'text',
    aliases: [
      'technician', 'tech', 'assigned technician', 'assigned to', 'assignee',
      'installer', 'field tech', 'technician name', 'assigned tech',
      'technician full name', 'tech full name',
    ],
  },
  {
    key: 'technician_first_name',
    label: 'Technician First Name',
    type: 'text',
    aliases: [
      'technician first name', 'technician firstname', 'technician first',
      'tech first name', 'tech firstname', 'tech first',
      'technician given name', 'first name tech',
      'technicianfirstname', 'technicianfirst', 'techfirst', 'techfirstname',
    ],
  },
  {
    key: 'technician_last_name',
    label: 'Technician Last Name',
    type: 'text',
    aliases: [
      'technician last name', 'technician lastname', 'technician last',
      'tech last name', 'tech lastname', 'tech last',
      'technician surname', 'last name tech',
      'technicianlastname', 'technicianlast', 'techlast', 'techlastname',
    ],
  },
  {
    key: 'assigned_team',
    label: 'Assigned Team',
    type: 'text',
    aliases: ['team', 'assigned team', 'group', 'crew', 'dispatch team', 'team name'],
  },
  {
    key: 'dispatch_notes',
    label: 'Dispatch Notes',
    type: 'text',
    aliases: [
      'dispatch notes', 'notes', 'remarks', 'comments', 'dispatch remarks',
      'work notes', 'note', 'remark',
    ],
  },
  {
    key: 'delay_reason',
    label: 'Delay Reason',
    type: 'text',
    aliases: ['delay reason', 'reason', 'delay', 'cause', 'delay cause', 'reason for delay'],
  },
  {
    key: 'priority',
    label: 'Priority',
    type: 'text',
    aliases: ['priority', 'urgency', 'service level', 'sl', 'severity', 'priority level'],
  },
  {
    key: 'completion_notes',
    label: 'Completion Notes',
    type: 'text',
    aliases: ['completion notes', 'resolution', 'findings', 'completion remarks', 'done notes'],
  },
];

const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Normalize a header for comparison: lowercase, strip accents/punctuation.
function normalizeHeader(value) {
  return String(value == null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const ALIAS_INDEX = (() => {
  const map = new Map();
  for (const field of FIELDS) {
    for (const alias of field.aliases) {
      const norm = normalizeHeader(alias);
      if (!map.has(norm)) map.set(norm, field.key);
    }
  }
  return map;
})();

// Suggest a canonical field for a raw header. Returns null for unknown columns
// which are preserved in `extra` instead of being discarded.
function detectField(header) {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  if (ALIAS_INDEX.has(norm)) return ALIAS_INDEX.get(norm);

  const normTight = norm.replace(/ /g, '');

  // Concatenated equivalences: "workordernumber" matches the alias
  // "work order number", "appointmentdate" matches "appointment date",
  // and — crucially — "appointmentid" does NOT match the single-token alias
  // "appointment" (it is a separate FSM entity id, not a schedule).
  for (const field of FIELDS) {
    for (const alias of field.aliases) {
      const a = normalizeHeader(alias);
      if (a.length < 3) continue;
      if (a === norm || a.replace(/ /g, '') === normTight) return field.key;
      // Multi-word alias appearing as a contiguous token run inside a longer
      // header ("NAP_ID (Cabinet)" -> "nap id (cabinet)"). Single-word aliases
      // are deliberately excluded so "appointment" can never steal
      // "appointmentid".
      const aWords = a.split(' ');
      if (aWords.length === 1) continue;
      const hWords = norm.split(' ');
      for (let i = 0; i + aWords.length <= hWords.length; i++) {
        if (hWords.slice(i, i + aWords.length).join(' ') === a) return field.key;
      }
    }
  }
  return null;
}

// Build a column -> field map from detected headers.
function autoMapColumns(headers) {
  const mapping = {};
  const used = new Set();
  headers.forEach((header, idx) => {
    const detected = detectField(header);
    if (detected && !used.has(detected)) {
      mapping[String(idx)] = detected;
      used.add(detected);
    }
  });
  return mapping;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[^0-9.\-+eE]/g, '');
  if (!cleaned) return null;
  const num = Number.parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

function toCivilTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

// Tolerant date parser: ISO, common slash formats, and Excel serial numbers.
// The work order date columns are TIMESTAMP WITHOUT TIME ZONE, so parsed values
// are returned as naive civil wall-clock times ("YYYY-MM-DD HH:MM:SS"). Naive
// inputs (no timezone marker) are taken verbatim as the written wall-clock
// (Philippine business files are month-first, e.g. "10-10-2026 15:47:46"), and
// inputs with an explicit offset are converted to that offset's wall-clock.
// Either way the stored civil date equals the date written in the file with no
// off-by-one drift from the server's or session's timezone.
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value) ? null : toCivilTime(value);

  if (typeof value === 'number' && value > 20000 && value < 60000) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d) ? null : toCivilTime(d);
  }

  const str = String(value).trim();
  if (!str) return null;

  const time = str.match(/(?:^|[\sT])(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  const hh = time ? parseInt(time[1], 10) : 0;
  const mi = time ? parseInt(time[2], 10) : 0;
  const ss = time && time[3] !== undefined ? parseInt(time[3], 10) : 0;
  if (hh > 23 || mi > 59 || ss > 59) return null;

  const m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  const iso = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m && !iso) return null;

  let year, month, day;
  if (m) {
    year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    month = parseInt(m[1], 10);
    day = parseInt(m[2], 10);
  } else {
    year = parseInt(iso[1], 10);
    month = parseInt(iso[2], 10);
    day = parseInt(iso[3], 10);
  }

  let explicitOffsetMinutes = null;
  if (/[zZ]$/.test(str)) {
    explicitOffsetMinutes = 0;
  } else if (time) {
    const off = str.match(/([+-])(\d{2}):?(\d{2})$/);
    if (off) {
      explicitOffsetMinutes = (off[1] === '-' ? -1 : 1) * (parseInt(off[2], 10) * 60 + parseInt(off[3], 10));
    }
  }

  if (explicitOffsetMinutes !== null) {
    const d = new Date(str);
    if (isNaN(d)) return null;
    return toCivilTime(new Date(d.getTime() + explicitOffsetMinutes * 60000));
  }

  const d = new Date(Date.UTC(year, month - 1, day, hh, mi, ss));
  return isNaN(d) ? null : toCivilTime(d);
}

// Appointment store it as date-only ("2026-10-12") — drop any time component.
function dateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value) ? null : value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 20000 && value < 60000) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const str = String(value).trim().replace(/\s+/g, ' ');
  if (!str) return null;
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(parseInt(iso[2], 10)).padStart(2, '0')}-${String(parseInt(iso[3], 10)).padStart(2, '0')}`;
  }
  const slash = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (slash) {
    let [, a, b, c] = slash;
    let year = parseInt(c, 10);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, parseInt(a, 10) - 1, parseInt(b, 10)));
    return isNaN(d) ? str : d.toISOString().slice(0, 10);
  }
  return str;
}

function isValidLatitude(value) {
  const n = typeof value === 'number' ? value : parseNumber(value);
  return n !== null && n >= -90 && n <= 90;
}

function isValidLongitude(value) {
  const n = typeof value === 'number' ? value : parseNumber(value);
  return n !== null && n >= -180 && n <= 180;
}

// Snap a raw status to a configured status code (case/space tolerant).
function normalizeStatus(raw, knownStatuses) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const norm = normalizeHeader(raw);
  if (!norm) return null;
  for (const s of knownStatuses) {
    const codeNorm = normalizeHeader(s.code);
    const labelNorm = normalizeHeader(s.label);
    if (norm === codeNorm || norm === labelNorm) return s.code;
  }
  for (const s of knownStatuses) {
    const codeNorm = normalizeHeader(s.code);
    if (codeNorm.length >= 3 && (norm.includes(codeNorm) || codeNorm.includes(norm))) {
      return s.code;
    }
  }
  return null;
}

// Snap a raw channel to a configured channel code. Never guesses when the
// source value is unknown (requirement 6) - returns null so it is flagged.
function normalizeChannel(raw, knownChannels) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const norm = normalizeHeader(raw);
  if (!norm) return null;
  for (const c of knownChannels) {
    const codeNorm = normalizeHeader(c.code);
    const labelNorm = normalizeHeader(c.label);
    if (norm === codeNorm || norm === labelNorm) return c.code;
  }
  for (const c of knownChannels) {
    const codeNorm = normalizeHeader(c.code);
    if (codeNorm.length >= 3 && (norm.includes(codeNorm) || codeNorm.includes(norm))) {
      return c.code;
    }
  }
  return null;
}

module.exports = {
  FIELDS,
  FIELD_BY_KEY,
  normalizeHeader,
  detectField,
  autoMapColumns,
  parseNumber,
  parseDate,
  dateOnly,
  isValidLatitude,
  isValidLongitude,
  normalizeStatus,
  normalizeChannel,
};
