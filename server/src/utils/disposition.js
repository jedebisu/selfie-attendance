// Central Disposition Dictionary + deterministic classifier.
//
// Design rules (from the disposition-improvement spec):
//  - Normalization is FORMATTING ONLY (whitespace/case/unicode). Two source
//    values are "the same" only when they are textually identical after this
//    normalization. There is NO fuzzy word/token matching, so similar-looking
//    dispositions that mean different things can never be silently merged.
//  - A disposition is only accepted when an APPROVED rule in disposition_rules
//    maps it (exact match). Approved aliases are just additional rules pointing
//    at the same normalized value.
//  - Unknown or conflicting values never get guessed: they go to the review
//    queue with a human-readable reason.
//  - COMPLETED-status can never be inferred from free text ("done", "closed",
//    "finished", ...). Only an explicit approved rule can map to COMPLETED.

const { pool } = require('../config/database');

const REVIEW = 'review';
const APPROVED = 'approved';

// Formatting-only normalization. Never project words onto tokens.
function normalizeDisposition(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Build a lookup index from a list of rule rows. Rules are keyed by their
// normalized source text. If two active rules normalize to the same text but
// disagree on the target, both are flagged as conflicted.
function buildRuleIndex(rules) {
  const bySource = new Map();
  const conflicts = new Set();
  for (const rule of rules || []) {
    if (!rule.is_active) continue;
    const key = normalizeDisposition(rule.source_value);
    if (!key) continue;
    if (!bySource.has(key)) bySource.set(key, []);
    const bucket = bySource.get(key);
    bucket.push(rule);
    const first = bucket[0];
    const fingerprint = `${rule.kind}|${rule.normalized || ''}|${rule.operational_status || ''}`;
    const firstFingerprint = `${first.kind}|${first.normalized || ''}|${first.operational_status || ''}`;
    if (fingerprint !== firstFingerprint) {
      conflicts.add(key);
    }
  }
  return { bySource, conflicts };
}

const KIND_STATUS = 'status';
const KIND_DISPOSITION = 'disposition';

// Classify a STATUS source value (FSM status / operational status). Strict and
// approved-only. Returns { operational_status, kind, matched } or { none }.
function classifyStatus(rawText, rules) {
  const key = normalizeDisposition(rawText);
  if (!key) return { matched: false, reason: 'Empty status value' };
  const candidates = (rules || []).filter(
    (r) =>
      r.is_active &&
      r.approval_status === 'approved' &&
      r.kind === KIND_STATUS &&
      normalizeDisposition(r.source_value) === key
  );
  if (candidates.length === 0) {
    return {
      matched: false,
      operational_status: null,
      kind: KIND_STATUS,
      reason: `No approved rule for status "${rawText}"`,
    };
  }
  const byStatus = new Map();
  for (const r of candidates) {
    if (!r.operational_status) continue;
    if (!byStatus.has(r.operational_status)) byStatus.set(r.operational_status, r);
  }
  if (byStatus.size > 1) {
    return {
      matched: false,
      operational_status: null,
      kind: KIND_STATUS,
      reason: `Conflicting approved status rules for "${rawText}"`,
    };
  }
  const [[statusCode, rule]] = [...byStatus.entries()];
  return {
    matched: true,
    operational_status: statusCode,
    kind: KIND_STATUS,
    rule_id: rule.id,
    rule: rule,
    reason: `Approved rule #${rule.id} (${rule.source_value})`,
  };
}

// Classify a DISPOSITION source value (close code / outcome). Strict and
// approved-only. Returns normalized disposition, category and optional
// operational status.
function classifyDisposition(rawText, rules) {
  const key = normalizeDisposition(rawText);
  if (!key) {
    return { matched: false, reason: 'Empty disposition value' };
  }
  const candidates = (rules || []).filter(
    (r) =>
      r.is_active &&
      r.approval_status === 'approved' &&
      r.kind === KIND_DISPOSITION &&
      normalizeDisposition(r.source_value) === key
  );
  if (candidates.length === 0) {
    return {
      matched: false,
      disposition: null,
      category: null,
      operational_status: null,
      kind: KIND_DISPOSITION,
      reason: `Unknown disposition "${rawText}" — needs review`,
    };
  }
  const byTarget = new Map();
  for (const r of candidates) {
    if (!r.normalized) continue;
    const fp = `${r.normalized}|${r.category || ''}|${r.operational_status || ''}`;
    if (!byTarget.has(fp)) byTarget.set(fp, r);
  }
  if (byTarget.size > 1) {
    return {
      matched: false,
      disposition: null,
      category: null,
      operational_status: null,
      kind: KIND_DISPOSITION,
      reason: `Conflicting approved disposition rules for "${rawText}"`,
    };
  }
  const [[fp, rule]] = [...byTarget.entries()];
  return {
    matched: true,
    disposition: rule.normalized,
    category: rule.category || null,
    operational_status: rule.operational_status || null,
    kind: KIND_DISPOSITION,
    rule_id: rule.id,
    rule: rule,
    reason: `Approved rule #${rule.id} (${rule.source_value})`,
  };
}

// Classify a full import row's disposition/status signal.
// `signal` is either the disposition cell text or the status cell text.
// `isStatusSignal` selects which dictionary to use.
// `context` may carry `rawStatus` for conflict detection.
function classifySignal({ signal, isStatusSignal, rules, context = {} }) {
  if (isStatusSignal) {
    const s = classifyStatus(signal, rules);
    if (s.matched) {
      return {
        confidence: APPROVED,
        disposition: null,
        category: null,
        operational_status: s.operational_status,
        rule_id: s.rule_id,
        reason: s.reason,
        review: null,
      };
    }
    return {
      confidence: REVIEW,
      disposition: null,
      category: null,
      operational_status: null,
      rule_id: null,
      reason: s.reason,
      review: `status:${s.reason}`,
    };
  }

  const disp = classifyDisposition(signal, rules);
  // Conflict detection: an explicit disposition that maps to an operational
  // status which disagrees with the FSM status must be resolved by a human.
  let conflict = null;
  if (disp.matched && disp.operational_status && context.rawStatus) {
    const fs = classifyStatus(context.rawStatus, rules);
    if (fs.matched && fs.operational_status && fs.operational_status !== disp.operational_status) {
      conflict = `FSM status "${context.rawStatus}" (${fs.operational_status}) conflicts with disposition "${disp.disposition}" (${disp.operational_status})`;
    }
  }
  if (disp.matched) {
    return {
      confidence: conflict ? REVIEW : APPROVED,
      disposition: disp.disposition,
      category: disp.category,
      operational_status: disp.operational_status,
      rule_id: disp.rule_id,
      reason: disp.reason,
      review: conflict ? `conflict:${conflict}` : null,
    };
  }
  return {
    confidence: REVIEW,
    disposition: null,
    category: null,
    operational_status: null,
    rule_id: null,
    reason: disp.reason,
    review: `disposition:${disp.reason}`,
  };
}

// Load active rules once (imports call this per batch; small table).
async function loadActiveRules() {
  const { rows } = await pool.query(
    `SELECT * FROM disposition_rules
      WHERE is_active = TRUE AND approval_status = 'approved'
      ORDER BY kind, priority ASC, id ASC`
  );
  return rows;
}

module.exports = {
  normalizeDisposition,
  buildRuleIndex,
  classifyStatus,
  classifyDisposition,
  classifySignal,
  loadActiveRules,
  KIND_STATUS,
  KIND_DISPOSITION,
  REVIEW,
  APPROVED,
};