#!/usr/bin/env node
/**
 * Re-run NAP matching for existing work orders.
 *
 * Background: the business export puts the real NAP identifier in the
 * `facility` column while the dedicated NAP column is a dash ("-") placeholder.
 * Older imports stored that dash as `nap_id`, so NAP matching failed and the
 * NAP Groups page showed a single meaningless "-" group. The import mapping is
 * fixed in workOrderImport.js; this script back-fills records already stored.
 *
 * For every work order it computes the effective NAP reference
 * (a real `nap_id`, else the `facility` code when `nap_id` is a placeholder),
 * resolves it against the authoritative `naps` table via the shared resolver,
 * and updates nap_id + coordinates + match status exactly as an import would.
 *
 * Usage:
 *   node scripts/rematch-naps.js                 # dry run (default, no writes)
 *   node scripts/rematch-naps.js --apply         # write changes (local DB only)
 *   node scripts/rematch-naps.js --apply --allow-remote   # write to a remote DB
 *
 * SAFETY: does NOT load .env (the committed .env points at production). It uses
 * the DB_* / DATABASE_URL variables already present in the environment and
 * refuses to write to a non-local database without --allow-remote.
 */
const fs = require('fs');
const { pool } = require('../src/config/database');
const { lookupNaps, resolveCoordinates } = require('../src/utils/napResolver');

const PLACEHOLDER_VALUES = new Set(['-', '--', '—', '–', 'n/a', 'n.a.', 'na', 'none', 'null']);
const isPlaceholder = (v) => {
  if (v === null || v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === '' || PLACEHOLDER_VALUES.has(s);
};

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const allowRemote = argv.includes('--allow-remote');

function isLocalTarget() {
  if (process.env.DATABASE_URL) return false;
  const host = process.env.DB_HOST || 'localhost';
  return ['localhost', '127.0.0.1', '::1', ''].includes(host);
}

const numEq = (a, b) => {
  const na = a === null || a === undefined || a === '' ? null : Number(a);
  const nb = b === null || b === undefined || b === '' ? null : Number(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  return Math.abs(na - nb) < 1e-9;
};

async function main() {
  if (apply && !isLocalTarget() && !allowRemote) {
    console.error('Refusing to write to a non-local database without --allow-remote.');
    process.exit(1);
  }

  const who = await pool.query('SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS host');
  console.log('Target:', who.rows[0]);

  const { rows } = await pool.query(
    `SELECT id, work_order_number, nap_id, facility, source_latitude, source_longitude,
            latitude, longitude, coordinate_source, nap_match_status, coord_conflict, coord_diff_meters
       FROM work_orders
      WHERE deleted_at IS NULL`
  );

  const targets = rows
    .map((r) => ({
      row: r,
      effectiveNapId: isPlaceholder(r.nap_id) ? (isPlaceholder(r.facility) ? null : r.facility) : r.nap_id,
    }))
    .filter((t) => t.effectiveNapId);

  const napMap = await lookupNaps(targets.map((t) => t.effectiveNapId));

  const changes = [];
  for (const { row, effectiveNapId } of targets) {
    const srcLat = row.source_latitude != null ? Number(row.source_latitude) : null;
    const srcLng = row.source_longitude != null ? Number(row.source_longitude) : null;
    const res = resolveCoordinates({ napId: effectiveNapId, sourceLat: srcLat, sourceLng: srcLng }, napMap);
    const after = {
      nap_id: effectiveNapId,
      latitude: res.latitude,
      longitude: res.longitude,
      coordinate_source: res.coordinate_source,
      nap_match_status: res.nap_match_status,
      coord_conflict: res.coord_conflict,
      coord_diff_meters: res.coord_diff_meters,
    };
    const changed =
      String(row.nap_id ?? '') !== String(after.nap_id ?? '') ||
      String(row.nap_match_status ?? '') !== String(after.nap_match_status ?? '') ||
      String(row.coordinate_source ?? '') !== String(after.coordinate_source ?? '') ||
      !numEq(row.latitude, after.latitude) ||
      !numEq(row.longitude, after.longitude) ||
      !numEq(row.coord_diff_meters, after.coord_diff_meters) ||
      Boolean(row.coord_conflict) !== Boolean(after.coord_conflict);
    if (changed) {
      changes.push({
        id: row.id,
        work_order_number: row.work_order_number,
        before: {
          nap_id: row.nap_id,
          latitude: row.latitude,
          longitude: row.longitude,
          coordinate_source: row.coordinate_source,
          nap_match_status: row.nap_match_status,
          coord_conflict: row.coord_conflict,
          coord_diff_meters: row.coord_diff_meters,
        },
        after,
      });
    }
  }

  const matched = changes.filter((c) => c.after.nap_match_status === 'matched').length;
  const noCoords = changes.filter((c) => c.after.nap_match_status === 'matched_no_coords').length;
  const stillMissing = changes.filter((c) => c.after.nap_match_status === 'not_found').length;
  console.log(
    `Scanned ${rows.length} work orders, ${targets.length} with a NAP reference, ` +
    `${changes.length} need updating (matched=${matched}, matched_no_coords=${noCoords}, not_found=${stillMissing}).`
  );

  if (!apply) {
    console.log('\nDry run — no changes written. Re-run with --apply to commit.');
    console.log('Sample:', JSON.stringify(changes.slice(0, 3), null, 2));
    return;
  }
  if (changes.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `/tmp/nap-rematch-backup-${stamp}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(changes, null, 2));
  console.log('Backup of prior values written to', backupPath);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of changes) {
      await client.query(
        `UPDATE work_orders SET
           nap_id = $2, latitude = $3, longitude = $4, coordinate_source = $5,
           nap_match_status = $6, coord_conflict = $7, coord_diff_meters = $8,
           updated_at = NOW()
         WHERE id = $1`,
        [c.id, c.after.nap_id, c.after.latitude, c.after.longitude, c.after.coordinate_source,
          c.after.nap_match_status, c.after.coord_conflict, c.after.coord_diff_meters]
      );
    }
    await client.query('COMMIT');
    console.log(`Applied ${changes.length} updates.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Re-match FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error(err); pool.end().finally(() => process.exit(1)); });
