import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ListChecks, BookMarked, BarChart3, Filter, Search, ShieldCheck, X,
  RotateCcw, CheckCircle2, CircleSlash, FileDiff, Layers, Tag,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { dispositionAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';

const REVIEW_STATUS_STYLE = {
  open: { label: 'Open', color: '#d97706', bg: '#fffbeb' },
  approved: { label: 'Approved', color: '#16a34a', bg: '#f0fdf4' },
  cleared: { label: 'Cleared', color: '#64748b', bg: '#f1f5f9' },
  rolled_back: { label: 'Rolled back', color: '#dc2626', bg: '#fef2f2' },
};

function chip(label, color, bg) {
  return <span className="action-chip" style={{ color, background: bg }}>{label}</span>;
}

function ReviewChip({ status }) {
  const s = REVIEW_STATUS_STYLE[status] || { label: status, color: '#475569', bg: '#e2e8f0' };
  return chip(s.label, s.color, s.bg);
}

function StatMini({ label, value, color = '#2563eb' }) {
  return (
    <div className="mini-stat">
      <div style={{ color, fontWeight: 800, fontSize: 20 }}>{value ?? '—'}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

const TABS = [
  { key: 'review', label: 'Review Queue', icon: ListChecks },
  { key: 'dictionary', label: 'Disposition Dictionary', icon: BookMarked },
  { key: 'audit', label: 'Audit & Metrics', icon: BarChart3 },
];

export default function DispositionCenter() {
  const { user } = useAuth();
  const isAdmin = !!user?.is_admin;

  const [tab, setTab] = useState('review');

  /* ---------------- Review queue ---------------- */
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ status: 'open', channel: '', territory: '', facility: '', q: '' });
  const [selected, setSelected] = useState([]);
  const [approveRow, setApproveRow] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  /* ---------------- Dictionary ---------------- */
  const [rulesData, setRulesData] = useState(null);
  const [ruleModal, setRuleModal] = useState(null); // { editing? } | null
  const [applyRule, setApplyRule] = useState(null); // { rule, proposal }

  /* ---------------- Audit & metrics ---------------- */
  const [metrics, setMetrics] = useState(null);
  const [audit, setAudit] = useState(null);

  const loadReviews = (keepSelection = false) => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    dispositionAPI.reviewQueue(params)
      .then((res) => {
        setReviews(res.reviews || []);
        if (!keepSelection) setSelected([]);
      })
      .catch((e) => toast.error(e.response?.data?.error || 'Failed to load review queue'));
  };
  const loadStats = () => dispositionAPI.reviewStats().then(setStats).catch(() => {});
  const loadRules = () => dispositionAPI.rules().then(setRulesData).catch((e) => toast.error(e.response?.data?.error || 'Failed to load dictionary'));
  const loadAudit = () => {
    dispositionAPI.metrics().then(setMetrics).catch(() => {});
    dispositionAPI.audit().then(setAudit).catch((e) => toast.error(e.response?.data?.error || 'Failed to load audit'));
  };

  useEffect(() => { if (tab === 'review') { loadReviews(); loadStats(); } }, [tab, filters]);
  useEffect(() => { if (tab === 'dictionary') loadRules(); }, [tab]);
  useEffect(() => { if (tab === 'audit') loadAudit(); }, [tab]);

  const toggleAll = (checked) => setSelected(checked ? reviews.filter((r) => r.review_status === 'open').map((r) => r.review_id) : []);
  const toggleOne = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const approve = async (row, payload) => {
    try {
      const res = await dispositionAPI.approveReview(row.work_order_id, {
        review_id: row.review_id,
        disposition: payload.disposition,
        category: payload.category,
        status: payload.status,
        note: payload.note,
      });
      toast.success(`WO ${row.work_order_number} → ${res.next.disposition || res.next.status} (review #${res.review_id})`);
      setApproveRow(null);
      loadReviews(); loadStats();
    } catch (e) {
      toast.error(e.response?.data?.error || e.response?.data?.detail || 'Failed to approve');
    }
  };

  const clearReview = async (row) => {
    try {
      await dispositionAPI.clearReview(row.work_order_id, 'Cleared without change');
      toast.success(`Cleared review for ${row.work_order_number}`);
      loadReviews(); loadStats();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to clear');
    }
  };

  const rollback = async (row) => {
    try {
      const res = await dispositionAPI.rollback(row.review_id);
      toast.success(`Rolled back ${res.work_order_number || `WO #${res.work_order_id}`} to its previous state`);
      loadReviews(); loadStats();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to roll back');
    }
  };

  const bulkApply = async (payload) => {
    try {
      const res = await dispositionAPI.bulkReview({ ids: selected, ...payload });
      toast.success(`Resolved ${res.applied} reviews`);
      setBulkOpen(false);
      loadReviews(); loadStats();
    } catch (e) {
      toast.error(e.response?.data?.error || e.response?.data?.detail || 'Bulk apply failed');
    }
  };

  /* ---------------- Dictionary actions ---------------- */
  const saveRule = async (data) => {
    try {
      if (ruleModal.rule?.id) await dispositionAPI.updateRule(ruleModal.rule.id, data);
      else await dispositionAPI.createRule(data);
      toast.success('Rule saved');
      setRuleModal(null);
      loadRules();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Failed to save rule');
    }
  };

  const runCorrect = async (rule, confirm) => {
    try {
      if (!confirm) {
        const proposal = await dispositionAPI.correct({
          rule_id: rule.id,
          status: rule.operational_status || undefined,
          note: 'Corrected from disposition dictionary',
        });
        setApplyRule({ rule, proposal });
      } else {
        const res = await dispositionAPI.correct({
          rule_id: applyRule.rule.id,
          status: applyRule.rule.operational_status || undefined,
          confirm: 'yes',
          note: 'Corrected from disposition dictionary',
          work_order_ids: applyRule.proposal.work_order_ids,
        });
        toast.success(`Applied to ${res.applied} record(s)`);
        setApplyRule(null);
        loadAudit();
      }
    } catch (e) {
      toast.error(e.response?.data?.error || e.response?.data?.detail || 'Correction failed');
    }
  };

  const dispositions = useMemo(
    () => (rulesData?.rules || []).filter((r) => r.kind === 'disposition').map((r) => r.normalized),
    [rulesData]
  );
  const approvalEditors = {
    categories: rulesData?.categories || [],
    statuses: rulesData?.statuses || [],
    dispositions,
  };

  const reviewFilterValues = useMemo(() => {
    const uniq = (k) => [...new Set(reviews.map((r) => r[k]).filter(Boolean))].sort();
    return { channel: uniq('source_channel'), territory: uniq('territory'), facility: uniq('facility') };
  }, [reviews]);

  const selectedReviews = reviews.filter((r) => selected.includes(r.review_id));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Disposition Center</h1>
          <p className="subtitle">Approved-only close-code dictionary, review queue, and accuracy audit</p>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <span className="tag"><ShieldCheck size={12} /> Approved-only classification</span>
          {isAdmin && <Link className="btn btn-sm" to="/import">Import new data</Link>}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'review' && (
        <>
          {stats && (
            <div className="grid grid-5 mb">
              <StatMini label="Open reviews" value={stats.open} color="#d97706" />
              <StatMini label="Conflict" value={stats.types?.conflicting} color="#dc2626" />
              <StatMini label="Unknown / no rule" value={stats.types?.unknown} color="#b45309" />
              <StatMini label="Classified (approved)" value={stats.classified ?? '—'} color="#16a34a" />
              <StatMini label="Coverage" value={stats.coverage_pct != null ? `${stats.coverage_pct}%` : '—'} color="#2563eb" />
            </div>
          )}

          <div className="card mb">
            <div className="card-title flex-between" style={{ marginBottom: 12 }}>
              <span className="flex" style={{ gap: 6, alignItems: 'center' }}><Filter size={15} /> Review queue</span>
              <span className="muted small">{reviews.length} item(s)</span>
            </div>
            <div className="flex wrap mb" style={{ gap: 8 }}>
              <select
                className="select" style={{ width: 140 }} value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              >
                <option value="open">Open</option>
                <option value="all">All statuses</option>
                <option value="approved">Approved</option>
                <option value="cleared">Cleared</option>
                <option value="rolled_back">Rolled back</option>
              </select>
              <select className="select" style={{ width: 150 }} value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
                <option value="">All channels</option>
                {reviewFilterValues.channel.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="select" style={{ width: 150 }} value={filters.territory} onChange={(e) => setFilters({ ...filters, territory: e.target.value })}>
                <option value="">All territories</option>
                {reviewFilterValues.territory.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="flex" style={{ gap: 4, flex: 1, minWidth: 200 }}>
                <input
                  className="input" placeholder="Search WO # or customer…" value={filters.q}
                  onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                />
                <button className="btn" onClick={() => loadReviews(true)}><Search size={14} /></button>
              </div>
              {selected.length > 0 && (
                <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>
                  Bulk resolve ({selected.length})
                </button>
              )}
            </div>

            <div className="table-hscroll">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}><input type="checkbox" checked={selected.length > 0 && selected.length === reviews.filter((r) => r.review_status === 'open').length} onChange={(e) => toggleAll(e.target.checked)} /></th>
                    <th>Review</th>
                    <th>WO #</th>
                    <th>Customer</th>
                    <th>FSM status → disposition</th>
                    <th>Suggested</th>
                    <th>Reason</th>
                    <th>Created</th>
                    <th style={{ width: 150 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.review_id} className={r.review_status === 'open' ? '' : 'row-muted'}>
                      <td>
                        {r.review_status === 'open' ? (
                          <input type="checkbox" checked={selected.includes(r.review_id)} onChange={() => toggleOne(r.review_id)} />
                        ) : null}
                      </td>
                      <td><ReviewChip status={r.review_status} /></td>
                      <td>
                        <Link className="wo-link" to={`/workorders?focus=${r.work_order_id}`}><span className="mono">{r.work_order_number}</span></Link>
                      </td>
                      <td>{r.customer_name || <span className="muted">—</span>}</td>
                      <td>
                        <div className="small">
                          {r.original_fsm_status || <span className="muted">—</span>}
                          {r.original_disposition ? (
                            <span className="muted"> → <em>{r.original_disposition}</em></span>
                          ) : null}
                        </div>
                        {r.status ? <span className="tag">{r.status}</span> : null}
                      </td>
                      <td>
                        {r.suggested_disposition ? (
                          <span className="flex" style={{ gap: 4, alignItems: 'center' }}>
                            <span className="tag ok">{r.suggested_disposition}</span>
                            {r.suggested_status && <span className="tag">{r.suggested_status}</span>}
                          </span>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="small" style={{ maxWidth: 260 }}>{r.reason || <span className="muted">—</span>}</td>
                      <td className="small muted">{r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
                      <td>
                        {r.review_status === 'open' && (
                          <span className="flex" style={{ gap: 4 }}>
                            <button className="btn btn-sm btn-success" onClick={() => setApproveRow(r)}><CheckCircle2 size={13} /> Approve</button>
                            <button className="btn btn-sm" onClick={() => clearReview(r)}><CircleSlash size={13} /> Clear</button>
                          </span>
                        )}
                        {(r.review_status === 'approved' || r.review_status === 'corrected') && (
                          <button className="btn btn-sm" onClick={() => rollback(r)}><RotateCcw size={13} /> Rollback</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {reviews.length === 0 && (
                    <tr><td colSpan={9} className="empty">No reviews — every classified value is either approved or awaiting a rule</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'dictionary' && (
        <DictionaryTab
          data={rulesData}
          isAdmin={isAdmin}
          onNew={() => setRuleModal({ rule: null })}
          onEdit={(rule) => setRuleModal({ rule })}
          onApply={(rule) => runCorrect(rule, false)}
          applying={!!applyRule}
        />
      )}

      {tab === 'audit' && (
        <AuditTab metrics={metrics} audit={audit} />
      )}

      {/* Approve modal */}
      {approveRow && <ApproveModal row={approveRow} editors={approvalEditors} onSave={approve} onClose={() => setApproveRow(null)} />}

      {/* Bulk modal */}
      {bulkOpen && (
        <BulkModal reviews={selectedReviews} editors={approvalEditors} onSave={bulkApply} onClose={() => setBulkOpen(false)} />
      )}

      {/* Rule add/edit modal */}
      {ruleModal && (
        <RuleModal
          data={rulesData}
          rule={ruleModal.rule}
          isNew={ruleModal.rule === null}
          isAdmin={isAdmin}
          onSave={saveRule}
          onClose={() => setRuleModal(null)}
        />
      )}

      {/* Apply-rule confirmation modal */}
      {applyRule && (
        <div className="modal-backdrop" onClick={() => setApplyRule(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Apply rule "{applyRule.rule.source_value}" to existing records</h3>
              <button className="icon-btn" onClick={() => setApplyRule(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p className="small muted">This re-classifies records whose stored value matches the rule, and records before/after state for rollback.</p>
              <div className="flex wrap" style={{ gap: 8, margin: '10px 0' }}>
                <span className="tag ok">{applyRule.proposal.affected_count} affected record(s)</span>
                <span className="tag">→ {applyRule.proposal.proposed_disposition}</span>
                {applyRule.proposal.proposed_status && <span className="tag">→ {applyRule.proposal.proposed_status}</span>}
              </div>
              {applyRule.proposal.sample?.length > 0 && (
                <table className="table">
                  <thead><tr><th>WO #</th><th>Customer</th><th>Current status</th><th>Stored disposition</th></tr></thead>
                  <tbody>
                    {applyRule.proposal.sample.map((s) => (
                      <tr key={s.work_order_number}>
                        <td className="mono small">{s.work_order_number}</td>
                        <td className="small">{s.customer_name}</td>
                        <td className="small">{s.current_status}</td>
                        <td className="small">{s.fsm_disposition || s.current_disposition || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setApplyRule(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => runCorrect(null, true)}>
                <FileDiff size={14} /> Confirm — apply to {applyRule.proposal.affected_count} record(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Tab: Dictionary ================= */
function DictionaryTab({ data, isAdmin, onNew, onEdit, onApply, applying }) {
  const rules = (data?.rules || []).filter((r) => !r.deleted_at);
  const statusRules = rules.filter((r) => r.kind === 'status');
  const dispRules = rules.filter((r) => r.kind === 'disposition');
  const catMap = Object.fromEntries((data?.categories || []).map((c) => [c.code, c.label]));

  const RuleTable = ({ list, columns }) => {
    if (list.length === 0) return <tr><td colSpan={columns} className="empty">No rules</td></tr>;
    return list.map((r) => (
      <tr key={r.id}>
        <td><span className="mono small" title={r.dictionary_value || r.source_value}>{r.dictionary_value || r.source_value}</span></td>
        <td>
          <span className="flex wrap" style={{ gap: 4 }}>
            <span className="tag ok">{r.normalized || '—'}</span>
            {r.category && <span className="tag" title={catMap[r.category]}>{catMap[r.category] || r.category}</span>}
            {r.kind === 'disposition' && r.operational_status && <span className="tag">{r.operational_status}</span>}
          </span>
        </td>
        <td className="small">{r.explanation || <span className="muted">—</span>}</td>
        <td>
          <span className="flex wrap" style={{ gap: 4 }}>
            <span className={`tag ${r.is_active ? 'ok' : ''}`}>{r.is_active ? 'active' : 'inactive'}</span>
            <span className={`tag ${r.approval_status === 'approved' ? 'ok' : ''}`}>{r.approval_status}</span>
          </span>
        </td>
        <td className="small muted">{r.priority}</td>
        <td>
          {isAdmin ? (
            <span className="flex" style={{ gap: 4 }}>
              <button className="btn btn-sm" onClick={() => onEdit(r)}>Edit</button>
              {r.kind === 'disposition' && (
                <button className="btn btn-sm" disabled={applying} onClick={() => onApply(r)} title="Re-classify matching stored values">
                  Apply to existing
                </button>
              )}
            </span>
          ) : <span className="muted small">admin only</span>}
        </td>
      </tr>
    ));
  };

  return (
    <div className="card mb">
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <div>
          <h3 style={{ fontSize: 15 }}>Approved close-code dictionary</h3>
          <p className="small muted">Values are matched exactly after normalization. Unknown / conflicting values never auto-apply — they land in the review queue.</p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={onNew}><Layers size={14} /> Add rule</button>}
      </div>

      <h4 style={{ fontSize: 13, color: '#0f172a', margin: '12px 0 6px' }}>Disposition rules (close codes → category + operational status)</h4>
      <div className="table-hscroll mb">
        <table className="table">
          <thead><tr><th style={{ width: 160 }}>Source value</th><th style={{ width: 260 }}>Normalized → category / status</th><th>Explanation</th><th>Status</th><th style={{ width: 46 }}>Pri</th><th style={{ width: 200 }}>Actions</th></tr></thead>
          <tbody><RuleTable list={dispRules} columns={6} /></tbody>
        </table>
      </div>

      <h4 style={{ fontSize: 13, color: '#0f172a', margin: '12px 0 6px' }}>Operational status aliases (FSM status → normalized status)</h4>
      <div className="table-hscroll">
        <table className="table">
          <thead><tr><th style={{ width: 160 }}>Source value</th><th style={{ width: 260 }}>Normalized status</th><th>Explanation</th><th>Status</th><th style={{ width: 46 }}>Pri</th><th style={{ width: 200 }}>Actions</th></tr></thead>
          <tbody><RuleTable list={statusRules} columns={6} /></tbody>
        </table>
      </div>
    </div>
  );
}

/* ================= Tab: Audit & metrics ================= */
function AuditTab({ metrics, audit }) {
  return (
    <>
      {metrics && (
        <div className="grid grid-5 mb">
          <StatMini label="Total work orders" value={metrics.total} color="#2563eb" />
          <StatMini label="Classified" value={metrics.classified} color="#16a34a" />
          <StatMini label="Approved coverage" value={metrics.coverage_pct != null ? `${metrics.coverage_pct}%` : '—'} color="#0891b2" />
          <StatMini label="Open reviews" value={metrics.open_reviews} color="#d97706" />
          <StatMini label="Cleared" value={metrics.cleared} color="#6b7280" />
        </div>
      )}

      <div className="grid grid-2 mb">
        <div className="card">
          <div className="card-title">Review-required values</div>
          {(metrics?.unknown_values || []).length === 0 ? <div className="empty">No open reviews</div> : (
            <table className="table">
              <thead><tr><th>Stored FSM disposition</th><th>Records</th></tr></thead>
              <tbody>
                {metrics.unknown_values.map((v, i) => (
                  <tr key={i}>
                    <td>{v.value === null ? <span className="tag ok">no value</span> : <span className="mono small">{v.value}</span>}</td>
                    <td className="num">{v.cnt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-title">By source channel</div>
          {(metrics?.by_channel || []).length === 0 ? <div className="empty">No data</div> : (
            <table className="table">
              <thead><tr><th>Channel</th><th>Open reviews</th></tr></thead>
              <tbody>
                {metrics.by_channel.map((c, i) => (
                  <tr key={i}>
                    <td>{c.channel === null ? <span className="muted">—</span> : c.channel}</td>
                    <td className="num">{c.cnt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mb">
        <div className="card-title flex-between">
          <span className="flex" style={{ gap: 6, alignItems: 'center' }}><BarChart3 size={15} /> Live audit — distinct stored values</span>
          {audit && <span className="muted small">{audit.total_work_orders} work orders · {audit.generated_at ? new Date(audit.generated_at).toLocaleString() : ''}</span>}
        </div>
        {audit?.dictionary && (
          <div className="flex wrap mb" style={{ gap: 8 }}>
            <span className="tag">{audit.dictionary.dispositions} disposition rules</span>
            <span className="tag">{audit.dictionary.status_aliases} status aliases</span>
            <span className="tag">{audit.dictionary.active} active approved</span>
            <span className="tag">{audit.dictionary.drafts} draft</span>
            {audit.dictionary.inactive > 0 && <span className="tag">{audit.dictionary.inactive} inactive</span>}
          </div>
        )}
        <div className="table-hscroll">
          <table className="table">
            <thead><tr><th>FSM disposition</th><th>Original status</th><th>Stored disposition</th><th>Review</th><th>Records</th><th>Classification</th></tr></thead>
            <tbody>
              {(audit?.values || []).map((v, i) => (
                <tr key={i}>
                  <td>{v.disposition_value === null ? <span className="muted">—</span> : <span className="mono small">{v.disposition_value}</span>}</td>
                  <td>{v.status_value || <span className="muted">—</span>}</td>
                  <td>{v.stored_disposition === null ? <span className="muted">—</span> : <span className="mono small">{v.stored_disposition}</span>}</td>
                  <td>{v.review_status === null ? <span className="muted">—</span> : <ReviewChip status={v.review_status} />}</td>
                  <td className="num">{v.occurrences}</td>
                  <td className="small">
                    {v.classification?.matched ? (
                      <span className="flex wrap" style={{ gap: 4 }}>
                        <span className="tag ok">{v.classification.path}</span>
                        <span className="tag">→ {v.classification.target || '—'}</span>
                        {v.classification.rule_id ? <span className="tag">#{v.classification.rule_id}</span> : null}
                      </span>
                    ) : (
                      <span className="tag" style={{ color: '#b45309', background: '#fffbeb' }}>{v.classification?.reason || 'No value'}</span>
                    )}
                  </td>
                </tr>
              ))}
              {(audit?.values || []).length === 0 && <tr><td colSpan={6} className="empty">No work orders</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ================= Modals ================= */
function ApproveModal({ row, editors, onSave, onClose }) {
  const [form, setForm] = useState({
    disposition: row.suggested_disposition || '',
    category: row.suggested_category || '',
    status: row.suggested_status || '',
    note: `Approved: ${row.suggested_disposition || 'no change'}`,
  });
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Resolve review — {row.work_order_number}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="flex wrap mb" style={{ gap: 8 }}>
            <span className="tag">{row.original_fsm_status || 'no status'} → {row.original_disposition || 'no disposition'}</span>
            {row.reason && <span className="tag">{row.reason}</span>}
          </div>
          <label className="label">Disposition value</label>
          <input
            list="approve-dispositions" className="input mb" value={form.disposition}
            onChange={(e) => setForm({ ...form, disposition: e.target.value })}
          />
          <datalist id="approve-dispositions">
            {editors.dispositions.map((d) => <option key={d} value={d} />)}
          </datalist>
          <div className="grid grid-2">
            <div>
              <label className="label">Category</label>
              <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">— none —</option>
                {editors.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Operational status</label>
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="">(keep current)</option>
                {editors.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <label className="label">Note</label>
          <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" onClick={() => onSave(row, form)}><CheckCircle2 size={14} /> Approve & apply</button>
        </div>
      </div>
    </div>
  );
}

function BulkModal({ reviews, editors, onSave, onClose }) {
  const [target, setTarget] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const suggested = useMemo(() => [...new Set(reviews.map((r) => r.reason).filter(Boolean))], [reviews]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Bulk resolve — {reviews.length} review(s)</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="small muted mb">The target disposition must already be an approved dictionary value. Anything else is refused.</p>
          <label className="label">Apply disposition value</label>
          <input
            list="bulk-dispositions" className="input mb" placeholder="e.g. Customer Unavailable" value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <datalist id="bulk-dispositions">
            {editors.dispositions.map((d) => <option key={d} value={d} />)}
          </datalist>
          <div className="grid grid-2">
            <div>
              <label className="label">Category</label>
              <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">— none —</option>
                {editors.categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">(keep current)</option>
                {editors.statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <label className="label">Note</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          {suggested.length > 0 && (
            <div className="small muted mt">Pending reasons: {[...new Set(suggested)].slice(0, 3).map((s) => `"${s.slice(0, 60)}"`).join(', ')}</div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-success" disabled={!target} onClick={() => onSave({ disposition: target, category, status, note })}>
            <Tag size={14} /> Bulk resolve ({reviews.length})
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleModal({ data, rule, isNew, isAdmin, onSave, onClose }) {
  const cats = data?.categories || [];
  const statuses = data?.statuses || [];
  const [form, setForm] = useState(
    rule || {
      kind: 'disposition', source_value: '', dictionary_value: '', normalized: '',
      category: '', operational_status: '', priority: 100, explanation: '',
      approval_status: 'approved', is_active: true,
    }
  );
  const save = () => {
    if (!isAdmin) return;
    const src = form.source_value || form.dictionary_value;
    if (!src || !form.normalized?.trim()) {
      toast.error('Source value and normalized value are required');
      return;
    }
    onSave({
      kind: form.kind,
      source_value: (form.source_value || form.dictionary_value || '').trim(),
      normalized: form.normalized.trim(),
      category: form.category || null,
      operational_status: form.operational_status || null,
      priority: Number(form.priority) || 100,
      explanation: form.explanation || null,
      approval_status: form.approval_status === 'draft' ? 'draft' : 'approved',
      is_active: form.is_active !== false,
    });
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{isNew ? 'Add rule' : `Edit rule #${rule.id}`}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {!isNew && rule && (
            <div className="flex wrap mb" style={{ gap: 8 }}>
              <span className="tag ok">ID {rule.id}</span>
              <span className="tag">kind: {rule.kind}</span>
              <span className="tag">source: {rule.source_value}</span>
            </div>
          )}
          <div className="grid grid-2">
            <div>
              <label className="label">Kind</label>
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="disposition">Disposition (close code)</option>
                <option value="status">Status alias</option>
              </select>
            </div>
            <div>
              <label className="label">Source value (as it appears in files)</label>
              <input className="input" value={form.source_value || form.dictionary_value || ''} onChange={(e) => setForm({ ...form, source_value: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-2">
            <div>
              <label className="label">Normalized value</label>
              <input className="input" value={form.normalized || ''} onChange={(e) => setForm({ ...form, normalized: e.target.value })} />
            </div>
            <div>
              <label className="label">Priority</label>
              <input type="number" className="input" value={form.priority ?? 100} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-2">
            <div>
              <label className="label">Category</label>
              <select className="select" value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">— none —</option>
                {cats.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Operational status (disposition)</label>
              <select className="select" value={form.operational_status || ''} onChange={(e) => setForm({ ...form, operational_status: e.target.value })}>
                <option value="">— none —</option>
                {statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <label className="label">Explanation</label>
          <input className="input" value={form.explanation || ''} onChange={(e) => setForm({ ...form, explanation: e.target.value })} />
          <div className="flex wrap" style={{ gap: 16, marginTop: 10 }}>
            <label className="checkrow-label">
              <input type="checkbox" checked={form.approval_status !== 'draft'} onChange={(e) => setForm({ ...form, approval_status: e.target.checked ? 'approved' : 'draft' })} />
              Approved (participates in classification)
            </label>
            <label className="checkrow-label">
              <input type="checkbox" checked={form.is_active !== false} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active
            </label>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}><ShieldCheck size={14} /> Save rule</button>
        </div>
      </div>
    </div>
  );
}