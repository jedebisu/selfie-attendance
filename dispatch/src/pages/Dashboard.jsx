import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ListOrdered, Network, CircleCheck, Clock4, TriangleAlert, MapPinOff,
  Gauge, Percent, Tags, Users, TrendingUp, Download, RefreshCw, Info,
  BarChart3, AlertTriangle, CalendarDays, Pause, Filter, X, Target,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Legend, AreaChart, Area,
} from 'recharts';
import { workOrderAPI, dispositionAPI, productivityAPI, importAPI, exportUrl } from '../services/api';
import { useTechnicians } from '../hooks/useConfig';
import useSyncRefresh from '../hooks/useSyncRefresh';
import { statusStyle, channelColor } from '../components/Badges';
import { C, CHART } from '../theme';
import PriorityQueue from '../components/PriorityQueue';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

// ------------------------------------------------------------------ period helpers
// All period math is anchored to "today" in Asia/Manila so the dashboard matches
// the overdue rule used by the API (appointment < today, Asia/Manila).

function manilaToday() {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) || null;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function monthBoundsISO(y, m) {
  const mm = String(m).padStart(2, '0');
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

const PERIODS = [
  ['all', 'All time'],
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last_7', 'Last 7 days'],
  ['this_month', 'This month'],
  ['prev_month', 'Previous month'],
  ['custom', 'Custom'],
];

function periodBounds(preset, customFrom, customTo) {
  const today = manilaToday();
  const [y, m] = today.split('-').map(Number);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const d = addDaysISO(today, -1); return { from: d, to: d }; }
    case 'last_7': return { from: addDaysISO(today, -6), to: today };
    case 'this_month': return monthBoundsISO(y, m);
    case 'prev_month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return monthBoundsISO(py, pm);
    }
    case 'custom': {
      if (customFrom && customTo && customFrom > customTo) return { invalid: true };
      return { from: customFrom || '', to: customTo || '' };
    }
    default: return { from: '', to: '' };
  }
}

function periodLabel(preset, from, to) {
  const found = PERIODS.find(([k]) => k === preset);
  if (preset === 'custom') return from || to ? `${from || '…'} → ${to || '…'}` : 'Custom range';
  return found ? found[1] : 'All time';
}

// ------------------------------------------------------------------ small pieces

function KpiCard({ icon: Icon, label, value, sub, color = C.primary, bg = C.primarySoft, ids, onDrill, hint }) {
  const clickable = Boolean(ids && ids.length && onDrill);
  return (
    <div
      className={`stat-card${clickable ? ' interactive' : ''}`}
      onClick={clickable ? () => onDrill(ids) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onDrill(ids); } : undefined}
      title={clickable ? `${ids.length} work order(s) — click to view` : hint}
    >
      <div className="icon" style={{ background: bg, color }}><Icon size={20} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-value">{value ?? '—'}</div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
        {clickable && <div className="stat-drill">{ids.length} → view</div>}
      </div>
      <div className="stat-icon-bg"><Icon /></div>
    </div>
  );
}

const fmtTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{payload[0].name || payload[0].payload.name}</strong>
      <div>{payload[0].value}</div>
    </div>
  );
};

const pctText = (v) => (v === null || v === undefined ? 'N/A' : `${v}%`);
const ratePct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

// Ranked area/territory breakdown with real status counts and click-through.
function BreakdownTable({ title, keyField, paramKey, rows }) {
  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="table-hscroll">
        <table className="table">
          <thead>
            <tr>
              <th>{keyField === 'area' ? 'Area' : 'Territory'}</th>
              <th className="num">Total</th>
              <th className="num">Completed</th>
              <th className="num">Pending</th>
              <th className="num">Overdue</th>
              <th className="num">Completion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = r[keyField];
              const linkable = name && name !== 'Unassigned';
              const rate = ratePct(r.completed, r.count);
              return (
                <tr key={name}>
                  <td>
                    {linkable
                      ? <Link className="wo-link" to={`/workorders?${paramKey}=${encodeURIComponent(name)}`} title={`View work orders in ${name}`}>{name}</Link>
                      : <span className="muted">{name}</span>}
                  </td>
                  <td className="num">{r.count}</td>
                  <td className="num" style={{ color: C.success }}>{r.completed}</td>
                  <td className="num" style={{ color: C.warning }}>{r.pending}</td>
                  <td className="num" style={{ color: C.danger }}>{r.overdue}</td>
                  <td className="num">{rate === null ? '—' : `${rate}%`}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="empty">No data in scope</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatWhen(iso) {
  if (!iso) return '—';
  try { return format(new Date(iso), 'MMM d, HH:mm'); } catch { return '—'; }
}

// ------------------------------------------------------------------ page

export default function Dashboard() {
  const navigate = useNavigate();
  const roster = useTechnicians();
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [granularity, setGranularity] = useState('day');
  const [filters, setFilters] = useState({ area: '', territory: '', technician: '' });
  const [options, setOptions] = useState(null);
  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState(null);
  const [disp, setDisp] = useState(null);
  const [prod, setProd] = useState(null);
  const [batches, setBatches] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    workOrderAPI.filterOptions().then(setOptions).catch(() => setOptions({ areas: [], territories: [], technicians: [] }));
    importAPI.batches().then((r) => setBatches(r.batches || [])).catch(() => setBatches([]));
  }, []);

  const bounds = useMemo(
    () => periodBounds(period, custom.from, custom.to),
    [period, custom.from, custom.to]
  );

  const params = useMemo(() => {
    const p = {};
    if (bounds && !bounds.invalid) {
      if (bounds.from) p.date_from = bounds.from;
      if (bounds.to) p.date_to = bounds.to;
    }
    if (filters.area) p.area = filters.area;
    if (filters.territory) p.territory = filters.territory;
    if (filters.technician) p.assigned_technician = filters.technician;
    return p;
  }, [bounds, filters]);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      workOrderAPI.stats(params),
      workOrderAPI.trends({ ...params, granularity }),
      dispositionAPI.metrics(),
      productivityAPI.summary(params),
    ])
      .then(([st, tr, dm, pr]) => {
        setStats(st);
        setTrends(tr);
        setDisp(dm);
        setProd(pr);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params, granularity]);

  useEffect(() => { load(); }, [load]);
  useSyncRefresh(load);

  const drill = useCallback((ids) => {
    if (ids && ids.length) navigate(`/workorders?ids=${ids.join(',')}`);
  }, [navigate]);

  const activeFilterCount = (filters.area ? 1 : 0) + (filters.territory ? 1 : 0) + (filters.technician ? 1 : 0) + (period !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setFilters({ area: '', territory: '', technician: '' });
    setPeriod('all');
    setCustom({ from: '', to: '' });
  };

  const t = stats?.totals;
  const p = prod?.summary;
  const ids = p?.ids || {};

  const byStatus = stats
    ? Object.entries(stats.by_status).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
    : [];
  const statusTotal = byStatus.reduce((s, x) => s + x.value, 0);

  const statusPie = byStatus
    .filter((s) => s.value > 0)
    .map((s) => ({ name: s.name, value: s.value, color: statusStyle(s.name).color }));

  const byChannel = (stats?.by_channel || []).map((c) => ({ name: c.channel, value: c.count, fill: channelColor(c.channel) }));
  const byArea = (stats?.by_area || []).slice(0, 10);
  const byTerritory = (stats?.by_territory || []).slice(0, 10);

  const trendData = (trends?.trends || []).map((x) => ({
    label: format(new Date(x.bucket), granularity === 'day' ? 'MM/dd' : granularity === 'week' ? "'Wk' w" : 'MMM yy'),
    total: x.total,
    completed: x.completed,
    pending: x.pending,
    overdue: x.overdue,
  }));

  const techs = (prod?.by_technician || []).filter((x) => x.technician !== 'Unattributed' && x.technician !== 'Unassigned');
  const workloadData = techs
    .slice()
    .sort((a, b) => b.assigned - a.assigned)
    .slice(0, 10)
    .map((x) => ({ name: x.technician, value: x.assigned }));

  const exportParams = { ...params };
  const label = periodLabel(period, bounds?.from, bounds?.to);
  const today = prod?.today || manilaToday();
  const recentBatches = (batches || []).slice(0, 4);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Operations Command Center</h1>
          <p className="subtitle">
            Executive operations overview · <strong>{label}</strong> · as of {today} (Asia/Manila)
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn" onClick={load}><RefreshCw size={15} /> Refresh</button>
          <a className="btn" href={exportUrl(exportParams)}><Download size={15} /> Export CSV</a>
          <a className="btn" href={exportUrl({ format: 'xlsx', ...exportParams })}><Download size={15} /> Export XLSX</a>
        </div>
      </div>

      {/* ------------------------------- global filters ------------------------------- */}
      <div className="toolbar wrap period-bar">
        <CalendarDays size={15} className="muted" />
        <span className="muted small">Reporting period</span>
        <div className="seg">
          {PERIODS.map(([k, lbl]) => (
            <button key={k} className={`seg-btn ${period === k ? 'active' : ''}`} onClick={() => setPeriod(k)}>{lbl}</button>
          ))}
        </div>
        {period === 'custom' && (
          <span className="flex wrap" style={{ gap: 6, alignItems: 'center' }}>
            <input
              type="date" className="input" aria-label="Custom start date" style={{ width: 150 }}
              value={custom.from} max={custom.to || undefined}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
            <span className="muted">→</span>
            <input
              type="date" className="input" aria-label="Custom end date" style={{ width: 150 }}
              value={custom.to} min={custom.from || undefined}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
            {bounds?.invalid && <span className="small" style={{ color: '#C2323A' }}>Start must be on or before end</span>}
          </span>
        )}
        <span className="spacer" />
        <span className="muted small">Trend</span>
        <select className="select" style={{ width: 130 }} value={granularity} onChange={(e) => setGranularity(e.target.value)}>
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </select>
      </div>

      <div className="toolbar wrap period-bar">
        <Filter size={15} className="muted" />
        <span className="muted small">Filters</span>
        <select className="select" style={{ maxWidth: 170 }} value={filters.area} onChange={(e) => setFilters((f) => ({ ...f, area: e.target.value }))}>
          <option value="">All areas</option>
          {(options?.areas || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 190 }} value={filters.territory} onChange={(e) => setFilters((f) => ({ ...f, territory: e.target.value }))}>
          <option value="">All territories</option>
          {(options?.territories || []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 200 }} value={filters.technician} onChange={(e) => setFilters((f) => ({ ...f, technician: e.target.value }))}>
          <option value="">All technicians</option>
          {(options?.technicians || []).map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select
          className="select" style={{ maxWidth: 220 }} disabled
          title="Product classification (GFP/GAH) is not available in the work order data"
        >
          <option>All products · GFP/GAH n/a</option>
        </select>
        {activeFilterCount > 0 && (
          <button className="chip active" onClick={clearFilters} title="Clear all filters">
            <X size={12} /> Clear filters ({activeFilterCount})
          </button>
        )}
      </div>

      {loading && !stats ? (
        <div className="loading"><div className="spinner" />Loading dashboard...</div>
      ) : (
        <>
          <div className="dash-section-title"><Gauge size={15} /> Key performance indicators</div>
          <div className="grid grid-4 mb">
            <KpiCard
              icon={ListOrdered} label="Total work orders" value={t?.total}
              sub={`${t?.unique_naps ?? 0} unique NAP IDs`} color={C.primary} bg={C.primarySoft}
            />
            <KpiCard
              icon={CircleCheck} label="Completed" value={p?.completed ?? byStatus.find((s) => s.name === 'COMPLETED')?.value ?? 0}
              ids={ids.completed} onDrill={drill} color={C.success} bg={C.successSoft}
            />
            <KpiCard
              icon={Percent} label="Completion rate" value={pctText(p?.completion_rate)}
              hint="Completed ÷ (assigned − cancelled − failed)" color={C.teal} bg={C.tealSoft}
            />
            <KpiCard
              icon={Target} label="Target progress" value="—"
              sub="No monthly target configured"
              hint="A monthly target must be configured to show progress"
              color={C.navy} bg={C.navySoft}
            />
            <KpiCard
              icon={Clock4} label="Backlog (pending)" value={p?.pending}
              sub="open, excluding delayed & on hold" ids={ids.pending} onDrill={drill} color={C.warning} bg={C.warningSoft}
            />
            <KpiCard
              icon={TriangleAlert} label="Overdue" value={p?.overdue}
              sub="appointment before today" ids={ids.overdue} onDrill={drill} color={C.danger} bg={C.dangerSoft}
            />
            <KpiCard
              icon={Clock4} label="Delayed" value={p?.delayed}
              ids={ids.delayed} onDrill={drill} color={C.danger} bg={C.dangerSoft}
            />
            <KpiCard
              icon={Pause} label="On hold" value={p?.on_hold}
              ids={ids.on_hold} onDrill={drill} color={C.warning} bg={C.warningSoft}
            />
            <KpiCard
              icon={Gauge} label="On-time rate" value={pctText(p?.on_time_rate)}
              sub={p && p.on_time_eligible ? `${p.on_time_eligible} completed with both dates` : 'no paired appointment/completion dates'}
              color={C.teal} bg={C.tealSoft}
            />
            <KpiCard
              icon={Users} label="Assigned" value={p?.assigned}
              ids={ids.assigned} onDrill={drill} color={C.teal} bg={C.tealSoft}
            />
            <KpiCard
              icon={MapPinOff} label="Unassigned" value={p?.unassigned}
              sub="no technician on the ticket" ids={ids.unassigned} onDrill={drill} color={C.purple} bg={C.purpleSoft}
            />
            <KpiCard
              icon={Network} label="Unmapped" value={t?.unmapped}
              sub="missing coordinates" hint="Work orders without latitude/longitude" color={C.slate} bg={C.slateSoft}
            />
            <KpiCard
              icon={TriangleAlert} label="Issues flagged" value={(t?.coord_conflict ?? 0) + (t?.nap_not_found ?? 0)}
              sub={`${t?.coord_conflict ?? 0} conflicts · ${t?.nap_not_found ?? 0} NAP not found`}
              color={C.danger} bg={C.dangerSoft}
            />
          </div>

          <div className="grid grid-2 mb">
            {disp && disp.total > 0 && (
              <div className="card">
                <div className="flex-between" style={{ marginBottom: 10 }}>
                  <div className="card-title flex" style={{ gap: 8, alignItems: 'center' }}>
                    <Tags size={15} /> Disposition accuracy
                    <span className="muted small" style={{ fontWeight: 400 }}>workspace-wide (not filtered)</span>
                    <Link className="btn btn-sm" to="/disposition">Open Disposition Center</Link>
                  </div>
                  <span className="small muted">{disp.total - (disp.open_reviews ?? 0)}/{disp.total} resolved · {disp.coverage_pct ?? 0}% coverage</span>
                </div>
                <div className="grid grid-3">
                  <KpiCard label="Classified" value={disp.classified} color={C.success} bg={C.successSoft} icon={CircleCheck} />
                  <KpiCard label="Coverage" value={`${disp.coverage_pct ?? 0}%`} color={C.teal} bg={C.tealSoft} icon={Percent} />
                  <KpiCard label="Open reviews" value={disp.open_reviews} color={C.warning} bg={C.warningSoft} icon={Clock4} />
                </div>
              </div>
            )}
            <div className="card">
              <div className="card-title"><Tags size={15} /> GFP vs GAH</div>
              <p className="small muted" style={{ margin: 0 }}>
                Product classification (GFP vs GAH) is <strong>not available</strong> — the work order data has no
                product-classification field, so no split is fabricated. All <strong>{t?.total ?? 0}</strong> work
                orders in scope are unclassified. This mirrors the disclosure on the Technician Productivity report.
              </p>
            </div>
          </div>

          <div className="dash-section-title"><TrendingUp size={15} /> Work order trend</div>
          <div className="card mb">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="gT" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={C.primary} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={C.primary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip content={fmtTooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="total" name="Total" stroke={CHART.total} fill="url(#gT)" strokeWidth={2} />
                <Area type="monotone" dataKey="completed" name="Completed" stroke={CHART.completed} fill="none" strokeWidth={2} />
                <Area type="monotone" dataKey="pending" name="Pending" stroke={CHART.pending} fill="none" strokeWidth={2} />
                <Area type="monotone" dataKey="overdue" name="Overdue" stroke={CHART.overdue} fill="none" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              Each point is grouped by the work order <strong>created date</strong>. Completed/pending/overdue reflect the
              work order's <strong>current</strong> status — the system does not store historical status snapshots, so these
              are not point-in-time recordings. “Overdue” is computed as of today (Asia/Manila).
            </p>
          </div>

          <div className="grid grid-3 mb">
            <div className="card">
              <div className="card-title">Status distribution</div>
              {statusPie.length === 0 ? <div className="empty">No records</div> : (
                <>
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={78} paddingAngle={2}>
                        {statusPie.map((s) => <Cell key={s.name} fill={s.color} />)}
                      </Pie>
                      <Tooltip content={fmtTooltip} />
                    </PieChart>
                  </ResponsiveContainer>
                  <table className="table">
                    <tbody>
                      {byStatus.filter((s) => s.value > 0).map((s) => (
                        <tr key={s.name}>
                          <td><span className="dot" style={{ background: statusStyle(s.name).color, display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6 }} />{s.name}</td>
                          <td className="num">{s.value}</td>
                          <td className="num muted">{statusTotal ? `${Math.round((s.value / statusTotal) * 1000) / 10}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
            <div className="card">
              <div className="card-title">By source channel</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byChannel}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip content={fmtTooltip} />
                  <Bar dataKey="value" name="Count" fill={C.primary} radius={[6, 6, 0, 0]}>
                    {byChannel.map((c) => <Cell key={c.name} fill={c.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="card">
              <div className="card-title">Data quality</div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Mapped', value: t?.mapped ?? 0, color: C.success },
                      { name: 'Unmapped', value: t?.unmapped ?? 0, color: C.slate },
                    ]}
                    dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}
                  >
                    {[{ color: C.success }, { color: C.slate }].map((c, i) => <Cell key={i} fill={c.color} />)}
                  </Pie>
                  <Tooltip content={fmtTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="dash-section-title"><BarChart3 size={15} /> Work orders by area &amp; territory</div>
          <div className="grid grid-2 mb">
            <BreakdownTable title="By area" keyField="area" paramKey="area" rows={byArea} />
            <BreakdownTable title="By territory" keyField="territory" paramKey="territory" rows={byTerritory} />
          </div>

          <div className="dash-section-title"><Network size={15} /> Geographic operations</div>
          <div className="grid grid-4 mb">
            <KpiCard icon={CircleCheck} label="Mapped" value={t?.mapped} sub="with coordinates" color={C.success} bg={C.successSoft} />
            <KpiCard icon={MapPinOff} label="Unmapped" value={t?.unmapped} sub="missing coordinates" color={C.slate} bg={C.slateSoft} />
            <KpiCard icon={TriangleAlert} label="Coord conflicts" value={t?.coord_conflict} sub="conflicting coordinates" color={C.danger} bg={C.dangerSoft} />
            <KpiCard icon={Network} label="NAP not found" value={t?.nap_not_found} sub="no matching NAP" color={C.warning} bg={C.warningSoft} />
          </div>
          <div className="toolbar wrap mb">
            <Link className="btn" to="/map">Open Map View</Link>
            <Link className="btn" to="/naps">Open NAP Groups</Link>
            <Link className="btn" to="/workorders?unmapped=true">View unmapped work orders</Link>
            <Link className="btn" to="/workorders?coord_conflict=true">View coordinate conflicts</Link>
          </div>
          <div className="grid grid-2 mb">
            <div className="card">
              <div className="card-title">Busiest NAP IDs</div>
              <div className="table-hscroll">
                <table className="table">
                  <thead><tr><th style={{ width: 160 }}>NAP ID</th><th>Work orders</th></tr></thead>
                  <tbody>
                    {(stats?.top_naps || []).map((n) => (
                      <tr key={n.nap_id}>
                        <td><Link className="wo-link" to={`/naps?nap_id=${encodeURIComponent(n.nap_id)}&open=1`}>{n.nap_id}</Link></td>
                        <td className="num">{n.count}</td>
                      </tr>
                    ))}
                    {(stats?.top_naps || []).length === 0 && <tr><td colSpan={2} className="empty">No NAP grouping yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-title"><MapPinOff size={15} /> Coordinate coverage</div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Mapped', value: t?.mapped ?? 0 },
                      { name: 'Unmapped', value: t?.unmapped ?? 0 },
                    ]}
                    dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2}
                  >
                    {[{ color: C.success }, { color: C.slate }].map((c, i) => <Cell key={i} fill={c.color} />)}
                  </Pie>
                  <Tooltip content={fmtTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="dash-section-title"><AlertTriangle size={15} /> Priority queue</div>
          <PriorityQueue
            today={today}
            dateFrom={bounds && !bounds.invalid ? bounds.from : ''}
            dateTo={bounds && !bounds.invalid ? bounds.to : ''}
            area={filters.area}
            territory={filters.territory}
            technician={filters.technician}
          />

          <div className="dash-section-title"><Users size={15} /> Technician productivity</div>
          <div className="grid grid-2 mb">
            <div className="card">
              <div className="flex-between" style={{ marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}><BarChart3 size={15} /> Workload by technician (assigned)</div>
                <Link className="btn btn-sm" to="/productivity">Open full report</Link>
              </div>
              {workloadData.length === 0 ? <div className="empty">No assigned work in scope</div> : (
                <ResponsiveContainer width="100%" height={Math.max(200, workloadData.length * 30)}>
                  <BarChart data={workloadData} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} width={150} />
                    <Tooltip />
                    <Bar dataKey="value" name="Assigned" fill={CHART.technician} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="card">
              <div className="card-title"><AlertTriangle size={15} /> Team snapshot</div>
              <div className="grid grid-2" style={{ gap: 10 }}>
                <div className="summary-tile"><div className="n">{roster ? roster.length : '—'}</div><div className="l">Active technicians</div></div>
                <div className="summary-tile"><div className="n">{techs.length}</div><div className="l">With workload</div></div>
                <div className="summary-tile"><div className="n" style={{ color: C.danger }}>{p?.overdue ?? '—'}</div><div className="l">Overdue</div></div>
                <div className="summary-tile"><div className="n" style={{ color: C.warning }}>{p?.pending ?? '—'}</div><div className="l">Backlog</div></div>
              </div>
              <div className="table-hscroll mt" style={{ maxHeight: 220, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th className="num">Assigned</th>
                      <th className="num">Pending</th>
                      <th className="num">Overdue</th>
                      <th className="num">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {techs.slice(0, 12).map((x) => (
                      <tr key={x.technician}>
                        <td><span className="mono">{x.technician}</span></td>
                        <td className="num">{x.assigned}</td>
                        <td className="num">{x.pending}</td>
                        <td className="num">{x.overdue}</td>
                        <td className="num">{x.completed}</td>
                      </tr>
                    ))}
                    {techs.length === 0 && <tr><td colSpan={5} className="muted">No technician workload in scope.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="dash-section-title"><Info size={15} /> Recent activity &amp; data quality</div>
          <div className="grid grid-2 mb">
            <div className="card">
              <div className="flex-between" style={{ marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>Recent imports</div>
                <Link className="btn btn-sm" to="/import">Import Center</Link>
              </div>
              <div className="table-hscroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>File</th><th>Status</th>
                      <th className="num">Added</th><th className="num">Updated</th>
                      <th className="num">Rejected</th><th className="num">Flagged</th>
                      <th>Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentBatches.map((b) => (
                      <tr key={b.id}>
                        <td className="small" title={b.filename}>{String(b.filename || '').slice(0, 28)}</td>
                        <td><span className="tag">{b.status}</span></td>
                        <td className="num">{b.added}</td>
                        <td className="num">{b.updated}</td>
                        <td className="num" style={{ color: b.rejected ? C.danger : undefined }}>{b.rejected}</td>
                        <td className="num" style={{ color: b.flagged ? C.warning : undefined }}>{b.flagged}</td>
                        <td className="small muted">{formatWhen(b.finished_at || b.created_at)}</td>
                      </tr>
                    ))}
                    {recentBatches.length === 0 && <tr><td colSpan={7} className="empty">No import activity yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Data integrity</div>
              <div className="grid grid-2" style={{ gap: 10 }}>
                <div className="summary-tile"><div className="n" style={{ color: C.warning }}>{t?.nap_not_found ?? '—'}</div><div className="l">NAP not found</div></div>
                <div className="summary-tile"><div className="n" style={{ color: C.danger }}>{t?.coord_conflict ?? '—'}</div><div className="l">Coordinate conflicts</div></div>
                <div className="summary-tile"><div className="n" style={{ color: C.slate }}>{t?.unmapped ?? '—'}</div><div className="l">Unmapped</div></div>
                <div className="summary-tile"><div className="n" style={{ color: C.slate }}>{t?.no_channel ?? '—'}</div><div className="l">No source channel</div></div>
              </div>
              <p className="small muted" style={{ marginTop: 10 }}>
                Integrity counts reflect the current filters. Resolve unmatched NAPs on the NAP Groups page and
                coordinate conflicts from the Map View.
              </p>
            </div>
          </div>

          <div className="card" style={{ borderLeft: `4px solid ${C.warning}`, background: C.warningSoft }}>
            <div className="card-title" style={{ color: '#B45309' }}><Info size={15} /> Metrics &amp; data notes</div>
            <ul className="small" style={{ margin: '6px 0 0 18px', color: '#7a5a12' }}>
              <li>Reporting period and all global filters (area, territory, technician) apply to every card, chart, table, and export on this page.</li>
              <li>Reporting period is based on the work order <strong>created date</strong> and is inclusive of the end date.</li>
              <li>“Backlog (pending)” excludes delayed and on-hold work orders. “Overdue” = non-terminal work orders whose appointment is before today (Asia/Manila).</li>
              <li>Completions are credited to a technician via work-order history (not the current assignee). Completion rate = completed ÷ (assigned − cancelled − failed).</li>
              <li>Target progress is not available — no monthly target is configured in the system.</li>
              <li>GFP/GAH product classification is not available — the work order data has no product-classification field.</li>
              <li>The system stores only current work-order status; trend/status series are not historical snapshots. The priority queue applies no SLA.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
