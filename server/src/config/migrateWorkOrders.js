require('dotenv').config();
const { pool } = require('./database');

// Default configurable lookups. Keeping these in the DB lets admins add
// statuses / channels without code changes (requirement 5 & 6).
const DEFAULT_STATUSES = [
  { code: 'NEW', label: 'New', color: '#3b82f6', sort: 1, terminal: false },
  { code: 'FOR DISPATCH', label: 'For Dispatch', color: '#8b5cf6', sort: 2, terminal: false },
  { code: 'ASSIGNED', label: 'Assigned', color: '#06b6d4', sort: 3, terminal: false },
  { code: 'IN PROGRESS', label: 'In Progress', color: '#f59e0b', sort: 4, terminal: false },
  { code: 'COMPLETED', label: 'Completed', color: '#22c55e', sort: 5, terminal: true },
  { code: 'DELAYED', label: 'Delayed', color: '#ef4444', sort: 6, terminal: false },
  { code: 'ON HOLD', label: 'On Hold', color: '#eab308', sort: 7, terminal: false },
  { code: 'CANCELLED', label: 'Cancelled', color: '#6b7280', sort: 8, terminal: true },
  { code: 'FAILED', label: 'Failed', color: '#991b1b', sort: 9, terminal: true },
];

// The 8 source channels required by the business spec. Dropdowns across the
// app show exactly these (only rows with is_active = true are listed).
const DEFAULT_CHANNELS = [
  { code: 'IPG', label: 'IPG', color: '#f97316', sort: 1 },
  { code: 'RTC', label: 'RTC', color: '#16a34a', sort: 2 },
  { code: 'EBISU', label: 'EBISU', color: '#7c3aed', sort: 3 },
  { code: '4AM', label: '4AM', color: '#0ea5e9', sort: 4 },
  { code: 'ALPHARD', label: 'ALPHARD', color: '#dc2626', sort: 5 },
  { code: 'EMCC', label: 'EMCC', color: '#db2777', sort: 6 },
  { code: 'STORES', label: 'STORES', color: '#2563eb', sort: 7 },
  { code: 'ONLINE', label: 'ONLINE', color: '#0891b2', sort: 8 },
];

// Technician roster. Without a unique constraint on name, seeding is done via
// a NOT EXISTS guard so the migration stays idempotent and admins' edits
// (team / phone / is_active) are never overwritten.
const DEFAULT_TECHNICIANS = [
  'KENNETH NACILLA',
  'JAY DELA CERNA',
  'JHEVSYN RAGASAJO',
  'FEDERICO LAPE',
  'RICKY BASTATAS',
  'NINO HANDUMON',
  'KENETH ARSUA',
  'RICHARD PASUMAL',
  'Robert Auman',
  'ALVIN DURANGPARANG',
  'JAY URBANO',
  'RANDY ABUAN',
  'MARVIN CAAYOHAN',
];

// Disposition taxonomy: categories used to group outcome reasons. The
// OPERATIONAL_STATUS category is only used to bucket status-alias rules.
const DEFAULT_DISPOSITION_CATEGORIES = [
  { code: 'OPERATIONAL_STATUS', label: 'Operational Status', color: '#475569', sort: 1 },
  { code: 'COMPLETED', label: 'Completed', color: '#16a34a', sort: 2 },
  { code: 'CUSTOMER_UNAVAILABLE', label: 'Customer Unavailable', color: '#ef4444', sort: 3 },
  { code: 'ACCESS_ISSUE', label: 'Access Issue', color: '#f97316', sort: 4 },
  { code: 'TECHNICAL_FAILURE', label: 'Technical Failure', color: '#7c3aed', sort: 5 },
  { code: 'LOGISTICS_CONSTRAINT', label: 'Logistics Constraint', color: '#d97706', sort: 6 },
  { code: 'RESCHEDULED', label: 'Rescheduled', color: '#0891b2', sort: 7 },
  { code: 'DUPLICATE', label: 'Duplicate / Already Served', color: '#64748b', sort: 8 },
  { code: 'CANCELLED', label: 'Cancelled / Rejected', color: '#6b7280', sort: 9 },
];

// Approved disposition dictionary seed. Kind 'status' aliases FSM status
// values to an operational status. Kind 'disposition' maps close codes /
// outcome reasons to a disposition, optionally to an operational status when
// there is an explicit FSM business rule. All entries are APPROVED; anything
// not in this dictionary goes to the review queue, never auto-guessed.
const DEFAULT_DISPOSITION_RULES = [
  // --- Operational status aliases (strict, approved) ---
  { kind: 'status', source: 'New', status: 'NEW', explanation: 'Explicit status value' },
  { kind: 'status', source: 'In Progress', status: 'IN PROGRESS', explanation: 'Explicit status value' },
  { kind: 'status', source: 'For Dispatch', status: 'FOR DISPATCH', explanation: 'Explicit status value' },
  { kind: 'status', source: 'Assigned', status: 'ASSIGNED', explanation: 'Explicit status value' },
  { kind: 'status', source: 'Completed', status: 'COMPLETED', explanation: 'Explicit approved completion value' },
  { kind: 'status', source: 'Delayed', status: 'DELAYED', explanation: 'Explicit status value' },
  { kind: 'status', source: 'On Hold', status: 'ON HOLD', explanation: 'Explicit status value' },
  { kind: 'status', source: 'Cancelled', status: 'CANCELLED', explanation: 'Explicit status value' },
  { kind: 'status', source: 'Failed', status: 'FAILED', explanation: 'Explicit status value' },

  // --- Dispositions / close codes (approved only) ---
  { kind: 'disposition', source: 'Completed', normalized: 'Completed', category: 'COMPLETED', status: 'COMPLETED', explanation: 'Explicit approved completion outcome' },
  { kind: 'disposition', source: 'Customer Unavailable', normalized: 'Customer Unavailable', category: 'CUSTOMER_UNAVAILABLE', status: 'DELAYED', explanation: 'FSM convention: no contact means the job cannot proceed; status DELAYED' },
  { kind: 'disposition', source: 'No Contact', normalized: 'Customer Unavailable', category: 'CUSTOMER_UNAVAILABLE', status: 'DELAYED', explanation: 'Approved alias of Customer Unavailable' },
  { kind: 'disposition', source: 'Customer Not Around', normalized: 'Customer Unavailable', category: 'CUSTOMER_UNAVAILABLE', status: 'DELAYED', explanation: 'Approved alias of Customer Unavailable' },
  { kind: 'disposition', source: 'Access Issue', normalized: 'Access Issue', category: 'ACCESS_ISSUE', status: 'DELAYED', explanation: 'Site access problem; job cannot proceed, status DELAYED' },
  { kind: 'disposition', source: 'No Access', normalized: 'Access Issue', category: 'ACCESS_ISSUE', status: 'DELAYED', explanation: 'Approved alias of Access Issue' },
  { kind: 'disposition', source: 'Gate Locked', normalized: 'Access Issue', category: 'ACCESS_ISSUE', status: 'DELAYED', explanation: 'Approved alias of Access Issue' },
  { kind: 'disposition', source: 'Technical Failure', normalized: 'Technical Failure', category: 'TECHNICAL_FAILURE', status: 'FAILED', explanation: 'FSM convention: site technical failure closes as FAILED' },
  { kind: 'disposition', source: 'Tech Failure', normalized: 'Technical Failure', category: 'TECHNICAL_FAILURE', status: 'FAILED', explanation: 'Approved alias of Technical Failure' },
  { kind: 'disposition', source: 'Material Shortage', normalized: 'Material Shortage', category: 'LOGISTICS_CONSTRAINT', status: 'DELAYED', explanation: 'Job deferred while material is sourced; status DELAYED' },
  { kind: 'disposition', source: 'No Material', normalized: 'Material Shortage', category: 'LOGISTICS_CONSTRAINT', status: 'DELAYED', explanation: 'Approved alias of Material Shortage' },
  { kind: 'disposition', source: 'Equipment Not Ready', normalized: 'Equipment Not Ready', category: 'LOGISTICS_CONSTRAINT', status: 'DELAYED', explanation: 'Premise equipment not ready; status DELAYED' },
  { kind: 'disposition', source: 'Customer Cancelled', normalized: 'Customer Cancelled', category: 'CANCELLED', status: 'CANCELLED', explanation: 'Explicit cancellation' },
  { kind: 'disposition', source: 'Cancelled by Customer', normalized: 'Customer Cancelled', category: 'CANCELLED', status: 'CANCELLED', explanation: 'Approved alias of Customer Cancelled' },
  { kind: 'disposition', source: 'Rescheduled', normalized: 'Rescheduled', category: 'RESCHEDULED', status: 'DELAYED', explanation: 'Customer requested new schedule; status DELAYED' },
  { kind: 'disposition', source: 'Customer Reschedule', normalized: 'Rescheduled', category: 'RESCHEDULED', status: 'DELAYED', explanation: 'Approved alias of Rescheduled' },
  { kind: 'disposition', source: 'Duplicate Order', normalized: 'Duplicate Order', category: 'DUPLICATE', status: 'CANCELLED', explanation: 'FSM convention: duplicate orders close as CANCELLED' },
  { kind: 'disposition', source: 'Duplicate', normalized: 'Duplicate Order', category: 'DUPLICATE', status: 'CANCELLED', explanation: 'Approved alias of Duplicate Order' },
  { kind: 'disposition', source: 'Already Served', normalized: 'Already Served', category: 'DUPLICATE', status: 'COMPLETED', explanation: 'Already served is a duplicate that was previously completed' },
];

const createWorkOrderTables = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Configurable statuses
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_order_statuses (
        code VARCHAR(30) PRIMARY KEY,
        label VARCHAR(60) NOT NULL,
        color VARCHAR(20) NOT NULL DEFAULT '#6b7280',
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        is_terminal BOOLEAN DEFAULT false
      )
    `);

    // Configurable source channels
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_order_channels (
        code VARCHAR(30) PRIMARY KEY,
        label VARCHAR(60) NOT NULL,
        color VARCHAR(20) DEFAULT '#3b82f6',
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true
      )
    `);

    // Technicians / teams (optional dataset - system works without it)
    await client.query(`
      CREATE TABLE IF NOT EXISTS technicians (
        id SERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        team VARCHAR(120),
        phone VARCHAR(60),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Import batches: holds parsed rows during preview, then the summary.
    await client.query(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255),
        file_type VARCHAR(20),
        status VARCHAR(20) DEFAULT 'preview',
        total_rows INTEGER DEFAULT 0,
        added INTEGER DEFAULT 0,
        updated INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        duplicated INTEGER DEFAULT 0,
        rejected INTEGER DEFAULT 0,
        flagged INTEGER DEFAULT 0,
        column_mapping JSONB,
        raw_data JSONB,
        errors JSONB,
        options JSONB,
        uploaded_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        finished_at TIMESTAMP
      )
    `);

    // Core work orders
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_orders (
        id SERIAL PRIMARY KEY,
        work_order_number VARCHAR(120),
        customer_name VARCHAR(200),
        customer_address TEXT,
        customer_contact VARCHAR(120),
        nap_id VARCHAR(100),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        source_latitude DECIMAL(10, 8),
        source_longitude DECIMAL(11, 8),
        coordinate_source VARCHAR(20),
        nap_match_status VARCHAR(20) DEFAULT 'no_nap_id',
        coord_conflict BOOLEAN DEFAULT false,
        coord_diff_meters REAL,
        area VARCHAR(160),
        territory VARCHAR(160),
        barangay VARCHAR(160),
        facility VARCHAR(200),
        plan_type VARCHAR(160),
        service_type VARCHAR(160),
        priority VARCHAR(30),
        date_created TIMESTAMP,
        last_updated TIMESTAMP,
        completion_date TIMESTAMP,
        status VARCHAR(30) DEFAULT 'NEW',
        status_source VARCHAR(20) DEFAULT 'import',
        original_status VARCHAR(80),
        source_channel VARCHAR(30),
        channel_source VARCHAR(20),
        assigned_technician VARCHAR(160),
        assigned_team VARCHAR(160),
        contractor VARCHAR(160),
        appointment VARCHAR(160),
        dispatch_notes TEXT,
        delay_reason TEXT,
        completion_notes TEXT,
        fsm_disposition VARCHAR(200),
        disposition VARCHAR(120),
        disposition_category VARCHAR(80),
        disposition_rule_id INTEGER,
        disposition_confidence VARCHAR(20) DEFAULT 'none',
        disposition_review_status VARCHAR(30) DEFAULT 'none',
        disposition_review_note TEXT,
        source_file VARCHAR(255),
        import_batch_id INTEGER,
        extra JSONB,
        deleted_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Idempotent column additions for databases created before these columns.
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS contractor VARCHAR(160)`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS appointment VARCHAR(160)`
    );
    // Appointment is date-only: strip any time component from legacy rows.
    await client.query(
      `UPDATE work_orders
          SET appointment = LEFT(appointment, 10)
        WHERE appointment ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} '`
    );
    await client.query(
      `UPDATE work_orders
          SET appointment = regexp_replace(appointment, '^([0-9]{2})[\\/\\-]([0-9]{2})[\\/\\-]([0-9]{4})[ ].*$', '\\3-\\1-\\2')
        WHERE appointment ~ '^[0-9]{2}[\\/\\-][0-9]{2}[\\/\\-][0-9]{4} '`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS fsm_disposition VARCHAR(200)`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS disposition VARCHAR(120)`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS disposition_category VARCHAR(80)`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS disposition_rule_id INTEGER`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS disposition_confidence VARCHAR(20) DEFAULT 'none'`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS disposition_review_status VARCHAR(30) DEFAULT 'none'`
    );
    await client.query(
      `ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS disposition_review_note TEXT`
    );

    // Disposition taxonomy + approved dictionary.
    await client.query(`
      CREATE TABLE IF NOT EXISTS disposition_categories (
        code VARCHAR(80) PRIMARY KEY,
        label VARCHAR(160) NOT NULL,
        color VARCHAR(20) DEFAULT '#64748b',
        sort_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true
      )
    `);

    // Lock down this shared reference table for the Supabase Data API
    // (fixes the "RLS Disabled in Public" advisor). The application reads and
    // writes it exclusively through the `postgres` role, which has BYPASSRLS,
    // and admin authorization is enforced in Express (JWT + is_admin); there is
    // no Supabase client / Data API usage anywhere in the repo. So: enable RLS
    // with NO permissive policies (deny-by-default for anon/authenticated) and
    // revoke the Supabase default grants to those roles. Role names are guarded
    // so this stays a no-op on databases without them (local dev, Render).
    await client.query(
      `ALTER TABLE public.disposition_categories ENABLE ROW LEVEL SECURITY`
    );
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON public.disposition_categories FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON public.disposition_categories FROM authenticated;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS disposition_rules (
        id SERIAL PRIMARY KEY,
        kind VARCHAR(30) NOT NULL CHECK (kind IN ('status', 'disposition')),
        source_value VARCHAR(200) NOT NULL,
        normalized VARCHAR(120),
        category VARCHAR(80) REFERENCES disposition_categories(code),
        operational_status VARCHAR(30),
        priority INTEGER DEFAULT 100,
        is_active BOOLEAN DEFAULT true,
        explanation TEXT,
        approval_status VARCHAR(30) DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // One approved rule per (kind, source value) prevents conflicting targets.
    // The classifier normalizes source values to formatting-only text before
    // matching, so formatting variants resolve here, not via new rows.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_disposition_rule_source
        ON disposition_rules (kind, lower(trim(source_value)))
    `);

    // Review queue for records whose disposition could not be auto-classified
    // or whose sources conflict. Exactly one open review per work order.
    await client.query(`
      CREATE TABLE IF NOT EXISTS disposition_reviews (
        id SERIAL PRIMARY KEY,
        work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
        original_disposition VARCHAR(200),
        original_fsm_status VARCHAR(120),
        suggested_disposition VARCHAR(120),
        suggested_category VARCHAR(80),
        suggested_status VARCHAR(30),
        rule_id INTEGER,
        reason TEXT,
        status VARCHAR(30) DEFAULT 'open',
        outcome TEXT,
        prev_state JSONB,
        new_state JSONB,
        note TEXT,
        actor_id INTEGER,
        actor_name VARCHAR(160),
        created_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_disposition_review_open
        ON disposition_reviews (work_order_id) WHERE status = 'open'
    `);

    // History / audit trail for status + important edits
    await client.query(`
      CREATE TABLE IF NOT EXISTS work_order_history (
        id SERIAL PRIMARY KEY,
        work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
        action VARCHAR(40) NOT NULL,
        field VARCHAR(60),
        old_value TEXT,
        new_value TEXT,
        note TEXT,
        actor_id INTEGER,
        actor_name VARCHAR(160),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Duplicate detection uses the work order number as business key.
    // Partial unique index ignores soft-deleted rows and rows without a number.
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_work_orders_number
        ON work_orders (work_order_number)
        WHERE work_order_number IS NOT NULL AND deleted_at IS NULL
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wo_nap_id ON work_orders (nap_id);
      CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders (status);
      CREATE INDEX IF NOT EXISTS idx_wo_channel ON work_orders (source_channel);
      CREATE INDEX IF NOT EXISTS idx_wo_area ON work_orders (area);
      CREATE INDEX IF NOT EXISTS idx_wo_territory ON work_orders (territory);
      CREATE INDEX IF NOT EXISTS idx_wo_barangay ON work_orders (barangay);
      CREATE INDEX IF NOT EXISTS idx_wo_coords ON work_orders (latitude, longitude);
      CREATE INDEX IF NOT EXISTS idx_wo_deleted ON work_orders (deleted_at);
      CREATE INDEX IF NOT EXISTS idx_wo_history_wo ON work_order_history (work_order_id);
    `);

    // Seed default statuses / channels (idempotent, does not overwrite edits)
    for (const s of DEFAULT_STATUSES) {
      await client.query(
        `INSERT INTO work_order_statuses (code, label, color, sort_order, is_terminal)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (code) DO NOTHING`,
        [s.code, s.label, s.color, s.sort, s.terminal]
      );
    }
    for (const c of DEFAULT_CHANNELS) {
      await client.query(
        `INSERT INTO work_order_channels (code, label, color, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET is_active = true`,
        [c.code, c.label, c.color, c.sort]
      );
    }
    for (const name of DEFAULT_TECHNICIANS) {
      await client.query(
        `INSERT INTO technicians (name)
         SELECT $1::varchar
          WHERE NOT EXISTS (
            SELECT 1 FROM technicians
             WHERE lower(trim(name)) = lower(trim($1::varchar))
          )`,
        [name]
      );
    }
    // The dropdown options must be exactly the 8 channels above. Any legacy
    // channel (e.g. BBSP/GSA) stays in the table for history, but is hidden
    // from every dropdown by marking it inactive.
    const activeCodes = DEFAULT_CHANNELS.map((c) => c.code);
    await client.query(
      `UPDATE work_order_channels SET is_active = false
        WHERE code != ALL($1::varchar[])`,
      [activeCodes]
    );

    // Seed disposition categories + approved dictionary (idempotent).
    for (const cat of DEFAULT_DISPOSITION_CATEGORIES) {
      await client.query(
        `INSERT INTO disposition_categories (code, label, color, sort_order)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, color = EXCLUDED.color`,
        [cat.code, cat.label, cat.color, cat.sort]
      );
    }
    for (const rule of DEFAULT_DISPOSITION_RULES) {
      await client.query(
        `INSERT INTO disposition_rules
           (kind, source_value, normalized, category, operational_status, priority, explanation, approval_status)
         VALUES ($1, $2, $3, $4, $5, 100, $6, 'approved')
         ON CONFLICT (kind, lower(trim(source_value))) DO UPDATE SET
           normalized = EXCLUDED.normalized,
           category = EXCLUDED.category,
           operational_status = EXCLUDED.operational_status,
           explanation = EXCLUDED.explanation,
           is_active = true,
           approval_status = 'approved'
         `,
        [
          rule.kind,
          rule.source,
          rule.normalized || null,
          rule.category || 'OPERATIONAL_STATUS',
          rule.status || null,
          rule.explanation || null,
        ]
      );
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wo_disposition_review
        ON work_orders (disposition_review_status)
        WHERE disposition_review_status = 'review_required';
      CREATE INDEX IF NOT EXISTS idx_wo_disposition
        ON work_orders (disposition_category);
      CREATE INDEX IF NOT EXISTS idx_disposition_reviews_wo
        ON disposition_reviews (work_order_id);
    `);

    // FSM sync state, per-file fingerprints, and run log (see fsmSync.js).
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id SMALLINT PRIMARY KEY,
        source VARCHAR(30) NOT NULL DEFAULT 'none',
        enabled BOOLEAN NOT NULL DEFAULT false,
        interval_min INTEGER NOT NULL DEFAULT 30,
        last_run_at TIMESTAMP,
        last_success_at TIMESTAMP,
        last_status VARCHAR(20),
        last_file VARCHAR(255),
        last_error TEXT,
        last_summary JSONB,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
      )
    `);
    await client.query(`INSERT INTO sync_state (id) VALUES (1) ON CONFLICT DO NOTHING`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_files (
        fingerprint VARCHAR(255) PRIMARY KEY,
        filename VARCHAR(255) NOT NULL,
        source VARCHAR(30) NOT NULL DEFAULT 'sync',
        processed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id SERIAL PRIMARY KEY,
        source VARCHAR(30),
        trigger VARCHAR(20),
        status VARCHAR(20),
        filename VARCHAR(255),
        total_rows INTEGER,
        added INTEGER DEFAULT 0,
        updated INTEGER DEFAULT 0,
        skipped INTEGER DEFAULT 0,
        duplicated INTEGER DEFAULT 0,
        rejected INTEGER DEFAULT 0,
        flagged INTEGER DEFAULT 0,
        errors JSONB,
        error TEXT,
        started_at TIMESTAMP DEFAULT NOW(),
        ended_at TIMESTAMP
      )
    `);

    await client.query('COMMIT');
    console.log('Work order tables ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Work order migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Allow running directly: node src/config/migrateWorkOrders.js
if (require.main === module) {
  createWorkOrderTables()
    .then(() => {
      console.log('Work order migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Work order migration failed:', error);
      process.exit(1);
    });
}

module.exports = { createWorkOrderTables, DEFAULT_STATUSES, DEFAULT_CHANNELS };
