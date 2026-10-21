import React, { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import {
  BarChart3, Download, TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, Pie, PieChart, Cell, AreaChart, Area,
} from 'recharts';
import { workOrderAPI, exportUrl } from '../services/api';
import { useConfig } from '../hooks/useConfig';
import { channelColor, statusStyle } from '../components/Badges';
import { C, CHART, CATEGORICAL } from '../theme';
import { format } from 'date-fns';

const DIMS = [
  ['status', 'Status'],
  ['source_channel', 'Source channel'],
  ['area', 'Area'],
  ['territory', 'Territory'],
  ['barangay', 'Barangay'],
  ['assigned_technician', 'Technician'],
];

const PIE_COLORS = CATEGORICAL;

function fmtTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const name = payload[0].name !== undefined && payload[0].name !== 'total' ? payload[0].name : label;
  return (
    <div className="chart-tooltip">
      <strong>{name}</strong>
      <div>{payload[0].value}</div>
    </div>
  );
}

export default function Reports() {
  const { config } = useConfig();
  const [dim, setDim] = useState('status');
  const [groups, setGroups] = useState([]);
  const [trends, setTrends] = useState([]);
  const [granularity, setGranularity] = useState('day');
  const [range, setRange] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);

  const params = useCallback(() => {
    const p = {};
    if (range.from) p.created_from = range.from;
    if (range.to) p.created_to = range.to;
    return p;
  }, [range.from, range.to]);

  useEffect(() => {
    setLoading(true);
    workOrderAPI.groupBy({ by: dim, ...params() }).then((res) => setGroups(res.groups || [])).catch(() => toast.error('Failed to load groups'));
    workOrderAPI.trends({ ...params(), granularity }).then((res) => setTrends(res.trends || [])).catch(() => {});
    setLoading(false);
  }, [dim, granularity, params]);

  const chartData = groups.map((g) => ({ name: String(g.key), value: g.count }));
  const isStatus = dim === 'status';

  const trendData = trends.map((t) => ({
    label: format(new Date(t.bucket), granularity === 'day' ? 'MM/dd' : granularity === 'week' ? "'Wk' w" : 'MMM yy'),
    total: t.total,
    completed: t.completed,
    delayed: t.delayed,
  }));

  const exportParams = { ...params() };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="subtitle">Slice work orders by any dimension, then export</p>
        </div>
        <div className="page-header-actions">
          <input type="date" className="input" style={{ width: 150 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span className="muted">to</span>
          <input type="date" className="input" style={{ width: 150 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <select className="select" style={{ width: 130 }} value={granularity} onChange={(e) => setGranularity(e.target.value)}>
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
          <a className="btn" href={exportUrl(exportParams)}><Download size={15} /> Export CSV</a>
        </div>
      </div>

      <div className="card mb">
        <div className="flex-between">
          <div className="card-title"><BarChart3 size={15} /> Grouped by</div>
          <div className="seg">
            {DIMS.map(([k, label]) => (
              <button key={k} className={`seg-btn ${dim === k ? 'active' : ''}`} onClick={() => setDim(k)}>{label}</button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="loading"><div className="spinner" />Loading...</div>
        ) : (
          <div className="grid grid-2">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData.slice(0, 20)} layout="vertical" margin={{ left: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} tickLine={false} width={chartsWidth(chartData)} />
                <Tooltip content={fmtTooltip} />
                <Bar dataKey="value" name="Count" fill={CHART.total} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={300}>
              {isStatus ? (
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name" outerRadius={110} innerRadius={50} paddingAngle={1}>
                    {chartData.map((c, i) => {
                      const s = config?.statuses?.find((x) => x.code === c.name);
                      return <Cell key={i} fill={s?.color || PIE_COLORS[i % PIE_COLORS.length]} />;
                    })}
                  </Pie>
                  <Tooltip content={fmtTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              ) : (
                <PieChart>
                  <Pie data={chartData.slice(0, 10)} dataKey="value" nameKey="name" outerRadius={110} innerRadius={50} paddingAngle={1}>
                    {chartData.slice(0, 10).map((c, i) => (
                      <Cell key={i} fill={dim === 'source_channel' ? channelColor(c.name) : PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={fmtTooltip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
        <div className="table-hscroll mt" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="table">
            <thead><tr><th>Value</th><th style={{ width: 110 }}>Count</th><th style={{ width: 140 }}>Share</th></tr></thead>
            <tbody>
              {groups.map((g) => {
                const total = groups.reduce((s, x) => s + x.count, 0);
                const pct = total ? ((g.count / total) * 100).toFixed(1) : '0';
                return (
                  <tr key={g.key}>
                    <td>
                      {isStatus ? <span className="tag" style={{ background: statusStyle(g.key).bg, color: statusStyle(g.key).text }}>{g.key}</span> : <span className="mono">{g.key}</span>}
                    </td>
                    <td className="num">{g.count}</td>
                    <td>
                      <div className="bar-bg"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                      <span className="small muted">{pct}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><TrendingUp size={15} /> Trend over time</div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id="gR" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART.total} stopOpacity={0.25} />
                <stop offset="95%" stopColor={CHART.total} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip content={fmtTooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="total" name="Total" stroke={CHART.total} fill="url(#gR)" strokeWidth={2} />
            <Area type="monotone" dataKey="completed" name="Completed" stroke={CHART.completed} fill="none" strokeWidth={2} />
            <Area type="monotone" dataKey="delayed" name="Delayed" stroke={CHART.delayed} fill="none" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function chartsWidth(data) {
  return Math.min(120, Math.max(60, String(data[0]?.name || '').length * 8));
}