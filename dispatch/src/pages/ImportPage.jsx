import React, { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  UploadCloud, FileSpreadsheet, X, RefreshCw, Import as ImportIcon,
  AlertTriangle, MapPin,
} from 'lucide-react';
import { importAPI, workOrderAPI } from '../services/api';
import { FIELDS } from '../services/fields';

const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f, null]));
const FIELD_OPTIONS = FIELDS.map((f) => f.key);

function SummaryCard({ label, value, color }) {
  return (
    <div className="mini-stat">
      <div style={{ color, fontWeight: 800, fontSize: 20 }}>{value}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

const ACTION_LABEL = {
  add: { label: 'Add', color: '#16a34a', bg: '#f0fdf4' },
  update: { label: 'Update existing', color: '#2563eb', bg: '#eff6ff' },
  duplicate: { label: 'Duplicate in file', color: '#d97706', bg: '#fffbeb' },
  reject: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2' },
  skip: { label: 'Skipped', color: '#64748b', bg: '#f1f5f9' },
};

const DISP_ACTION_LABEL = {
  mapped: { label: 'mapped', color: '#16a34a', bg: '#f0fdf4' },
  unknown: { label: 'unknown → review', color: '#b45309', bg: '#fffbeb' },
  conflict: { label: 'conflict → review', color: '#dc2626', bg: '#fef2f2' },
  none: { label: '—', color: '#64748b', bg: '#f1f5f9' },
};

export default function ImportPage() {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [options, setOptions] = useState({ trustImportedCompletion: false, importWithoutNumber: true });
  const [history, setHistory] = useState([]);
  const [expand, setExpand] = useState({});

  const loadHistory = useCallback(() => {
    importAPI.batches().then((res) => setHistory(res.batches || [])).catch(() => {});
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const runPreview = useCallback((f, m, o) => {
    setParsing(true);
    importAPI.preview(f, m, o)
      .then((res) => {
        setPreview(res);
        setMapping(res.suggested_mapping || {});
      })
      .catch((e) => toast.error(e.response?.data?.error || e.response?.data?.detail || 'Failed to analyze file'))
      .finally(() => setParsing(false));
  }, []);

  const onFile = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    runPreview(f, null, options);
  };

  const rePreview = () => {
    if (!file) return;
    runPreview(file, mapping, options);
  };

  const commit = async () => {
    if (!preview) return;
    setParsing(true);
    try {
      const res = await importAPI.commit(preview.batch_id, mapping, options);
      toast.success(`Import committed — ${res.summary.added} added, ${res.summary.updated} updated`);
      setPreview(null);
      setFile(null);
      loadHistory();
      window.dispatchEvent(new CustomEvent('import-committed'));
    } catch (e) {
      toast.error(e.response?.data?.error || e.response?.data?.detail || 'Commit failed');
    } finally {
      setParsing(false);
    }
  };

  const mappedCount = Object.keys(mapping).filter((k) => mapping[k]).length;
  const previewRows = preview?.sample || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Import Work Orders</h1>
          <p className="subtitle">Upload a CSV or Excel file. Columns are auto-mapped — preview first, then commit.</p>
        </div>
        <a className="btn" href="/samples/sample_work_orders.csv" download>Download sample file</a>
      </div>

      <div className="card mb">
        <div
          className={`dropzone ${file ? 'has-file' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}
        >
          {file ? (
            <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
              <FileSpreadsheet size={28} color="#2563eb" />
              <div style={{ flex: 1, textAlign: 'left' }}>
                <div style={{ fontWeight: 600 }}>{file.name}</div>
                <div className="small muted">{(file.size / 1024).toFixed(1)} KB — click or drop to replace</div>
              </div>
              <button className="icon-btn" onClick={(e) => { e.stopPropagation(); setFile(null); setPreview(null); }}>
                <X size={18} />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud size={34} color="#94a3b8" />
              <div style={{ fontWeight: 600 }}>Click to choose a file or drag & drop</div>
              <div className="small muted">Supports .csv, .xlsx, .xls (max 20 MB)</div>
            </>
          )}
          <input ref={fileRef} type="file" hidden accept=".csv,.xlsx,.xls" onChange={(e) => onFile(e.target.files[0])} />
        </div>
        {parsing && <div className="mt small muted flex" style={{ gap: 6, alignItems: 'center' }}><div className="spinner spinner-sm" /> Analyzing file...</div>}
      </div>

      {preview && (
        <>
          <div className="card mb">
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <div className="flex wrap" style={{ gap: 8 }}>
                <h3 style={{ fontSize: 15 }}>Preview</h3>
                <span className="tag">{preview.file_type.toUpperCase()}</span>
                <span className="tag">{preview.total_rows} rows</span>
              </div>
              <button className="btn btn-sm" onClick={rePreview}><RefreshCw size={14} /> Re-analyze with current mapping</button>
            </div>
            <div className="grid grid-5">
              <SummaryCard label="Will add" value={preview.summary.added} color="#16a34a" />
              <SummaryCard label="Will update" value={preview.summary.updated} color="#2563eb" />
              <SummaryCard label="Duplicates in file" value={preview.summary.duplicated} color="#d97706" />
              <SummaryCard label="Rejected" value={preview.summary.rejected} color="#dc2626" />
              <SummaryCard label="Flagged" value={preview.summary.flagged} color="#a16207" />
            </div>
            {preview.summary.rejected > 0 && (
              <div className="alert alert-warn mt" style={{ marginBottom: 0 }}>
                <AlertTriangle size={15} /> {preview.summary.rejected} rows will be skipped because they are missing required fields
              </div>
            )}
            {preview.summary.disposition && (
              <div className="mt">
                <div className="small muted" style={{ marginBottom: 6 }}>Disposition classification (approved-only dictionary)</div>
                <div className="flex wrap" style={{ gap: 8 }}>
                  <span className="tag ok">mapped {preview.summary.disposition.mapped}</span>
                  <span className="tag" style={{ color: '#b45309', background: '#fffbeb' }}>unknown {preview.summary.disposition.unknown}</span>
                  <span className="tag" style={{ color: '#dc2626', background: '#fef2f2' }}>conflicting {preview.summary.disposition.conflicting}</span>
                  <span className="tag">→ review {preview.summary.disposition.unresolved}</span>
                </div>
              </div>
            )}
          </div>

          <div className="card mb">
            <div className="card-title">Column mapping — {mappedCount} of {preview.headers.length} columns mapped</div>
            <div className="mapping-row mapping-head">
              <span style={{ width: 110 }}>Column</span>
              <span style={{ flex: 1 }}>Maps to</span>
            </div>
            {preview.headers.map((h, idx) => (
              <div key={idx} className="mapping-row">
                <span className="mono small ellipsis" title={h} style={{ width: 110 }}>{h || `(column ${idx + 1})`}</span>
                <select
                  className="select"
                  value={mapping[String(idx)] || ''}
                  onChange={(e) => setMapping((m) => {
                    const next = { ...m };
                    if (e.target.value) next[String(idx)] = e.target.value;
                    else delete next[String(idx)];
                    return next;
                  })}
                >
                  <option value="">— not imported —</option>
                  {FIELD_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
            ))}
          </div>

          <div className="card mb">
            <div className="card-title">Options</div>
            <div className="flex wrap" style={{ gap: 16 }}>
              <label className="checkrow-label">
                <input type="checkbox" checked={options.trustImportedCompletion} onChange={(e) => setOptions({ ...options, trustImportedCompletion: e.target.checked })} />
                Trust imported COMPLETED / CANCELLED / FAILED statuses
                <div className="small muted nb">Off = they become NEW so the dispatch team re-processes them</div>
              </label>
              <label className="checkrow-label">
                <input type="checkbox" checked={options.importWithoutNumber} onChange={(e) => setOptions({ ...options, importWithoutNumber: e.target.checked })} />
                Allow rows without a WO number
                <div className="small muted nb">Off = those rows are rejected</div>
              </label>
            </div>
          </div>

          <div className="card mb">
            <div className="card-title">Sample preview ({previewRows.length} rows shown)</div>
            <div className="table-hscroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Action</th>
                    <th>WO #</th>
                    <th>Customer</th>
                    <th>NAP</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Channel</th>
                    <th>Disposition</th>
                    <th>Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => {
                    const a = ACTION_LABEL[r.action] || { label: r.action, color: '#475569', bg: '#e2e8f0' };
                    return (
                      <tr key={r.rowNumber} className={r.action === 'reject' ? 'row-warn' : ''}>
                        <td className="muted">{r.rowNumber}</td>
                        <td><span className="action-chip" style={{ color: a.color, background: a.bg }}>{a.label}</span></td>
                        <td className="mono">{r.data.work_order_number || <span className="muted">—</span>}</td>
                        <td>{r.data.customer_name || <span className="muted">—</span>}</td>
                        <td>
                          {r.data.nap_id || <span className="muted">—</span>}
                          {r.data.nap_match_status === 'not_found' && <span title="NAP not in database"> ✕</span>}
                        </td>
                        <td>
                          <span className="flex" style={{ gap: 3, alignItems: 'center' }}>
                            <MapPin size={11} color={r.data.latitude != null ? '#16a34a' : '#94a3b8'} />
                            <span className="small muted">{r.data.latitude != null ? 'mapped' : 'unmapped'}</span>
                          </span>
                          {r.data.coord_conflict && <span className="small" style={{ color: '#b45309' }} title={`differs from NAP DB by ${Math.round(r.data.coord_diff_meters || 0)}m`}> ⚠</span>}
                        </td>
                        <td>{r.data.resolved_status || r.data.status || <span className="muted">NEW</span>}</td>
                        <td>{r.data.source_channel || <span className="muted">—</span>}</td>
                        <td>
                          {(() => {
                            const d = DISP_ACTION_LABEL[r.disposition_action] || { label: '—', color: '#64748b', bg: '#f1f5f9' };
                            return (
                              <span className="flex wrap" style={{ gap: 4 }}>
                                <span className="action-chip" style={{ color: d.color, background: d.bg }}>{d.label}</span>
                                {r.disposition_review && <span className="action-chip" style={{ color: '#ffffff', background: '#d97706' }} title={r.disposition_review.reason}>review</span>}
                                {r.data.disposition && <span className="small muted">{r.data.disposition}</span>}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="small">
                          {(r.warnings || []).length === 0 && <span className="muted">ok</span>}
                          {(r.warnings || []).slice(0, 2).map((w, i) => (
                            <div key={i} style={{ color: '#b45309' }}>{w}</div>
                          ))}
                          {(r.warnings || []).length > 2 && <div className="muted">+{(r.warnings || []).length - 2} more</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex-end mb">
            <button className="btn btn-lg btn-primary" onClick={commit} disabled={parsing}>
              <ImportIcon size={16} /> Commit import ({preview.summary.added + preview.summary.updated} rows)
            </button>
          </div>
        </>
      )}

      <div className="card">
        <div className="card-title">Import history</div>
        {history.length === 0 ? <div className="empty">No imports yet</div> : (
          <table className="table">
            <thead><tr><th>File</th><th>Type</th><th>Status</th><th>Rows</th><th>Added</th><th>Updated</th><th>Skipped</th><th>Duplicates</th><th>Rejected</th><th>Flagged</th><th>Disposition</th><th>When</th></tr></thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id}>
                  <td className="mono small">{b.filename}</td>
                  <td>{b.file_type?.toUpperCase()}</td>
                  <td><span className={`tag ${b.status === 'committed' ? 'ok' : ''}`}>{b.status}</span></td>
                  <td className="num">{b.total_rows}</td>
                  <td className="num" style={{ color: '#16a34a' }}>{b.added ?? '—'}</td>
                  <td className="num" style={{ color: '#2563eb' }}>{b.updated ?? '—'}</td>
                  <td className="num">{b.skipped ?? '—'}</td>
                  <td className="num">{b.duplicated ?? '—'}</td>
                  <td className="num" style={{ color: '#dc2626' }}>{b.rejected ?? '—'}</td>
                  <td className="num" style={{ color: '#a16207' }}>{b.flagged ?? '—'}</td>
                  <td className="small">
                    {(() => {
                      const d = b.options?.disposition_summary;
                      if (!d) return <span className="muted">—</span>;
                      return (
                        <span className="flex wrap" style={{ gap: 4 }}>
                          <span className="tag ok">{d.mapped ?? 0} mapped</span>
                          <span className="tag">{d.unknown ?? 0} unk</span>
                          <span className="tag" style={{ color: '#dc2626' }}>{d.conflicting ?? 0} con</span>
                          <span className="tag">{d.unresolved ?? 0} rev</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="muted small">{b.created_at ? new Date(b.created_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}