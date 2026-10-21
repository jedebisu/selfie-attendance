import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Users, Download, TrendingUp, BarChart3, AlertTriangle, Info, RefreshCw,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import { productivityAPI, exportUrl } from '../services/api';
import { useConfig } from '../hooks/useConfig';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { C, CHART, CATEGORICAL } from '../theme';

const PIE_COLORS = CATEGORICAL;

const pct = (v) => (v === null || v === undefined ? 'N/A' : `${v}%`);

function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

function downloadCsv(filename, text) {
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function TechnicianProductivity() {
  const navigate = useNavigate();
  const { config } = useConfig();
  const [filters, setFilters] = useState({
    status: '', assigned_technician: '', area: '', territory: '', q: '',
  });
  const [created, setCreated] = useState({ from: '', to: '' });
  const [completed, setCompleted] = useState({ from: '', to: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => {
    const p = {};
    for (const [k, v] of Object.entries(filters)) if (v) p[k] = v;
    if (created.from) p.date_from = created.from;
    if (created.to) p.date_to = created.to;
    if (completed.from) p.completed_from = completed.from;
    if (completed.to) p.completed_to = completed.to;
    return p;
  }, [filters, created, completed]);

  const load = useCallback(() => {
    setLoading(true);
    productivityAPI
      .summary(params)
      .then(setData)
      .catch(() => toast.error('Failed to load productivity metrics'))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const drill = (ids) => {
    if (!ids || !ids.length) return;
    navigate(`/workorders?ids=${ids.join(',')}`);
  };
  const drillable = (ids) => (ids && ids.length ? { role: 'button', tabIndex: 0, onClick: () => drill(ids), style: { cursor: 'pointer' } } : {});

  const summary = data?.summary;
  const techs = data?.by_technician || [];
  const workloadData = techs
    .filter((t) => t.technician !== 'Unattributed' && t.technician !== 'Unassigned')
    .map((t) => ({ name: t.technician, value: t.assigned }));

  const completionData = techs
    .filter((t) => t.completed > 0)
    .map((t) => ({ name: t.technician, value: t.completed }));

  const trendData = (data?.workload_trend || []).map((t) => ({
    label: format(new Date(t.bucket), 'MM/dd'),
    arrived: t.count,
  }));
  const completionTrend = (data?.completion_trend || []).map((t) => ({
    label: format(new Date(t.bucket), 'MM/dd'),
    completed: t.count,
  }));

  const onExportSummary = () => {
    if (!data) return;
    const headers = ['Technician', 'In roster', 'Team', 'Assigned', 'Pending', 'Delayed', 'On hold', 'Overdue', 'Completed (attributed)', 'Completion rate %', 'On-time rate %'];
    const rows = techs.map((t) => [
      t.technician, t.in_roster ? 'yes' : 'no', t.team || '', t.assigned, t.pending, t.delayed,
      t.on_hold, t.overdue, t.completed, t.completion_rate, t.on_time_rate,
    ]);
    const s = summary || {};
    const totals = ['TOTAL', '', '', s.assigned, s.pending, s.delayed, s.on_hold, s.overdue, s.completed, s.completion_rate, s.on_time_rate];
    const text = toCsv(headers, [totals, ...rows]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`technician_productivity_${stamp}.csv`, text);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Technician Productivity</h1>
          <p className="subtitle">
            Workload and completion metrics per technician, computed from work order and history records
            {data?.today ? ` · as of ${data.today} (Asia/Manila)` : ''}
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn" onClick={load}><RefreshCw size={15} /> Refresh</button>
          <a className="btn" href={exportUrl(params)}><Download size={15} /> Export underlying work orders</a>
          <button className="btn" onClick={onExportSummary}><Download size={15} /> Export summary CSV</button>
        </div>
      </div>

      <div className="toolbar wrap">
        <select className="select" style={{ maxWidth: 160 }} value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">All statuses</option>
          {(config?.statuses || []).map((s) => <option key={s.code} value={s.code}>{s.label || s.code}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 200 }} value={filters.assigned_technician} onChange={(e) => setFilter('assigned_technician', e.target.value)}>
          <option value="">All technicians</option>
          {(config?.technicians || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="select" style={{ maxWidth: 150 }} value={filters.area} onChange={(e) => setFilter('area', e.target.value)}>
          <option value="">All areas</option>
          {(config?.areas || []).map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="flex" style={{ gap: 6, alignItems: 'center' }}>
          <span className="muted small">Created</span>
          <input type="date" className="input" style={{ width: 150 }} value={created.from} onChange={(e) => setCreated({ ...created, from: e.target.value })} />
          <span className="muted">to</span>
          <input type="date" className="input" style={{ width: 150 }} value={created.to} onChange={(e) => setCreated({ ...created, to: e.target.value })} />
        </span>
        <span className="flex" style={{ gap: 6, alignItems: 'center' }}>
          <span className="muted small">Completed</span>
          <input type="date" className="input" style={{ width: 150 }} value={completed.from} onChange={(e) => setCompleted({ ...completed, from: e.target.value })} />
          <span className="muted">to</span>
          <input type="date" className="input" style={{ width: 150 }} value={completed.to} onChange={(e) => setCompleted({ ...completed, to: e.target.value })} />
        </span>
        <input className="input" style={{ maxWidth: 220 }} placeholder="Search customer / WO / NAP..." value={filters.q} onChange={(e) => setFilter('q', e.target.value)} />
      </div>

      {data?.disclosure?.length > 0 && (
        <div className="card mb" style={{ borderLeft: `4px solid ${C.warning}`, background: C.warningSoft }}>
          <div className="card-title" style={{ color: '#B45309' }}><Info size={15} /> How these metrics are measured</div>
          <ul className="small" style={{ margin: '6px 0 0 18px', color: '#7a5a12' }}>
            {data.disclosure.map((d, i) => <li key={i} style={{ marginBottom: 4 }}>{d}</li>)}
            <li>GFP/GAH product classification is not available in the data (no classification field), so it is intentionally not shown here.</li>
          </ul>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading productivity metrics...</div>
      ) : !data ? (
        <div className="card"><div className="muted">No data.</div></div>
      ) : (
        <>
          <div className="card mb">
            <div className="card-title"><Users size={15} /> Today's workload snapshot</div>
            <div className="grid grid-4" style={{ gap: 12 }}>
              <Metric label="Assigned" value={summary.assigned} ids={summary.ids.assigned} drillable={drillable} hint="Work orders in scope with a technician" />
              <Metric label="Pending" value={summary.pending} ids={summary.ids.pending} drillable={drillable} hint="Not completed / cancelled / failed, excluding delayed & on hold" />
              <Metric label="Delayed" value={summary.delayed} ids={summary.ids.delayed} drillable={drillable} tone="bad" />
              <Metric label="On hold" value={summary.on_hold} ids={summary.ids.on_hold} drillable={drillable} tone="warn" />
              <Metric label="Overdue" value={summary.overdue} ids={summary.ids.overdue} drillable={drillable} tone="bad" hint="Non-terminal with appointment before today (Asia/Manila)" />
              <Metric label="Completed" value={summary.completed} ids={summary.ids.completed} drillable={drillable} tone="good" hint="Status = COMPLETED (within completed range if set)" />
              <Metric label="Completion rate" value={pct(summary.completion_rate)} hint="Completed ÷ (assigned − cancelled − failed)" />
              <Metric label="On-time rate" value={pct(summary.on_time_rate)} hint={summary.on_time_eligible ? `${summary.on_time_eligible} completed order(s) with appointment + completion date` : 'No completed order has both an appointment and a completion date'} />
            </div>
          </div>

          <div className="grid grid-2 mb">
            <div className="card">
              <div className="card-title"><BarChart3 size={15} /> Workload distribution (assigned)</div>
              {workloadData.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={workloadData} layout="vertical" margin={{ left: 12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} width={140} />
                    <Tooltip />
                    <Bar dataKey="value" name="Assigned" fill={CHART.technician} radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="card">
              <div className="card-title"><BarChart3 size={15} /> Completed by technician (history-attributed)</div>
              {completionData.length === 0 ? (
                <Empty text="No attributed completions in scope." />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={completionData} dataKey="value" nameKey="name" outerRadius={110} innerRadius={50} paddingAngle={1}>
                      {completionData.map((c, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card mb">
            <div className="card-title"><AlertTriangle size={15} /> Overdue & delayed attention</div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <div>
                <div className="muted small">Overdue work orders</div>
                {summary.ids.overdue.length ? (
                  <ul className="small" style={{ margin: '6px 0 0 18px' }}>
                    {summary.ids.overdue.slice(0, 15).map((id) => (
                      <li key={id}><a href={`/workorders?focus=${id}`} className="link">Work order #{id}</a></li>
                    ))}
                    {summary.ids.overdue.length > 15 && <li className="muted">+{summary.ids.overdue.length - 15} more…</li>}
                  </ul>
                ) : <div className="muted small" style={{ marginTop: 6 }}>None.</div>}
              </div>
              <div>
                <div className="muted small">Delayed work orders</div>
                {summary.ids.delayed.length ? (
                  <ul className="small" style={{ margin: '6px 0 0 18px' }}>
                    {summary.ids.delayed.slice(0, 15).map((id) => (
                      <li key={id}><a href={`/workorders?focus=${id}`} className="link">Work order #{id}</a></li>
                    ))}
                    {summary.ids.delayed.length > 15 && <li className="muted">+{summary.ids.delayed.length - 15} more…</li>}
                  </ul>
                ) : <div className="muted small" style={{ marginTop: 6 }}>None.</div>}
              </div>
            </div>
          </div>

          <div className="grid grid-2 mb">
            <div className="card">
              <div className="card-title"><TrendingUp size={15} /> Work order arrivals (by created date)</div>
              {trendData.length === 0 ? <Empty /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="gArr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={CHART.gah} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={CHART.gah} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} width={32} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="arrived" name="Arrived" stroke={CHART.gah} fill="url(#gArr)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="card">
              <div className="card-title"><TrendingUp size={15} /> Completions (by completion date)</div>
              {completionTrend.length === 0 ? <Empty text="No completions recorded in scope." /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={completionTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} width={32} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="completed" name="Completed" fill={CHART.completed} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title"><Users size={15} /> Technician comparison</div>
            <div className="table-hscroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Technician</th>
                    <th className="num">Assigned</th>
                    <th className="num">Pending</th>
                    <th className="num">Delayed</th>
                    <th className="num">On hold</th>
                    <th className="num">Overdue</th>
                    <th className="num">Completed</th>
                    <th className="num">Completion rate</th>
                    <th className="num">On-time rate</th>
                  </tr>
                </thead>
                <tbody>
                  {techs.map((t) => (
                    <tr key={t.technician}>
                      <td>
                        <span className="mono">{t.technician}</span>
                        {!t.in_roster && t.technician !== 'Unattributed' && t.technician !== 'Unassigned' && (
                          <span className="tag" style={{ marginLeft: 8, background: C.dangerSoft, color: '#B42318' }} title="Not found in the technician roster">not in roster</span>
                        )}
                      </td>
                      <td className="num" {...drillable(t.ids.assigned)}>{t.assigned}</td>
                      <td className="num" {...drillable(t.ids.pending)}>{t.pending}</td>
                      <td className="num" {...drillable(t.ids.delayed)}>{t.delayed}</td>
                      <td className="num" {...drillable(t.ids.on_hold)}>{t.on_hold}</td>
                      <td className="num" {...drillable(t.ids.overdue)}>{t.overdue}</td>
                      <td className="num" {...drillable(t.ids.completed)}>{t.completed}</td>
                      <td className="num">{pct(t.completion_rate)}</td>
                      <td className="num">{pct(t.on_time_rate)}</td>
                    </tr>
                  ))}
                  {techs.length === 0 && <tr><td colSpan={9} className="muted">No technicians in scope.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, hint, tone, ids, drillable }) {
  const color = tone === 'bad' ? C.danger : tone === 'warn' ? C.warning : tone === 'good' ? C.success : C.text;
  const interactive = drillable && ids && ids.length ? drillable(ids) : {};
  return (
    <div className="card" style={{ padding: 14, margin: 0 }} {...interactive} title={interactive.onClick ? 'Click to view these work orders' : hint}>
      <div className="muted small">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>}
      {interactive.onClick && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{ids.length} → view</div>}
    </div>
  );
}

function Empty({ text = 'No data in scope.' }) {
  return <div className="muted" style={{ padding: '40px 0', textAlign: 'center' }}>{text}</div>;
}