// ---------------------------------------------------------------------------
// In-process cache for the public, read-only /api/napcheck/map route.
//
// Why: the full-pin payload (cols=min, ~55k tuples) costs a multi-query DB
// round trip per request. Repeated pans/zooms of the same unfiltered view
// were re-running that trip every time — now they are served from memory.
//
// Design:
//   - TTL 10 min fallback: nothing in the cache can be stale for more than
//     60 s, even if an external write (Supabase sync, admin import, manual
//     row edit) bypasses the invalidation hook.
//   - Explicit invalidation: a version stamp (`nap_version()`) is attached
//     to every cached entry. The stamp is the DB's own view of what data
//     exists — nap_report_date.txt (re-read live) AND max(updated_at) of
//     the naps table — so any import/sync that touches the records the map
//     serves bumps the version and the next request recomputes.
//   - Failed or partial responses are NEVER cached (only the completed,
//     success path stores an entry).
//   - Multi-instance note: the cache is per-process. On Render, every
//     build restarts the service, so a deploy (the only in-repo write
//     path) always clears every instance. External writes self-heal via
//     the 10 min TTL, bounded per instance.
//   - Bounded memory: at most 8 entries (LRU evict); full-map entry is
//     ~1 MB serialized — worst case ≈ 8 MB, well within the free plan.
//
// This is a cache only. It changes no query, no filter, no security rule.
// ---------------------------------------------------------------------------
const { pool } = require('../config/database');
const fs = require('fs');
const path = require('path');

const TTL_MS = 10 * 60 * 1000; // 10 min fallback; version-stamp invalidation is the primary freshness mechanism
const MAX_ENTRIES = 8;
const REPORT_DATE_FILE = path.join(__dirname, '..', 'config', 'nap_report_date.txt');

// The version stamp is consulted by EVERY cached request. `max(updated_at)`
// is a full 321k-row scan while unindexed, memoizing it briefly keeps
// cache hits at ~0 DB cost. The stamp memo window bounds staleness the same
// way the entry TTL does; the only in-repo write path is the deploy-time
// import, which restarts the process anyway.
const STAMP_MEMO_MS = 20 * 1000;
let stampMemo = { value: null, at: 0 };

let entries = new Map(); // version -> { payload, bodyBuffer, bodyJson, expires, order }

/**
 * Version stamp: nap_report_date.txt (live re-read) + max(updated_at) of
 * the naps table (catches any write path — importer, Supabase sync, manual
 * edits). Both are cheap: the file is tiny; max(updated_at) on a 321k-row
 * table with a maintained updated_at column is a fast index-able query.
 */
async function currentVersion() {
  if (stampMemo.value && Date.now() - stampMemo.at < STAMP_MEMO_MS) return stampMemo.value;
  let reportDate = null;
  try {
    reportDate = fs.readFileSync(REPORT_DATE_FILE, 'utf-8').trim() || null;
  } catch (_) {}
  let maxUpdated = null;
  try {
    const r = await pool.query('SELECT max(updated_at) AS v FROM naps');
    maxUpdated = r.rows[0].v;
  } catch (_) {}
  const stamp = `${reportDate || 'unknown'}|${maxUpdated || 'none'}`;
  stampMemo = { value: stamp, at: Date.now() };
  return stamp;
}

function cacheGet(key, version) {
  const e = entries.get(key);
  if (!e || e.version !== version || e.expires <= Date.now()) {
    if (e) entries.delete(key);
    return null;
  }
  return e;
}

function cacheSet(key, version, payload, bodyBuffer, bodyJson) {
  if (entries.size >= MAX_ENTRIES) {
    // Evict oldest entry (Map preserves insertion order; first key is LRU-ish)
    const first = entries.keys().next().value;
    entries.delete(first);
  }
  entries.set(key, { version, payload, bodyBuffer, bodyJson, expires: Date.now() + TTL_MS });
}

module.exports = { TTL_MS, currentVersion, cacheGet, cacheSet };
