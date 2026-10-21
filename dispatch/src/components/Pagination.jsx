import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, pages, total, limit, onChange }) {
  if (pages <= 1 && total <= limit) return null;
  const range = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, page + 2);
  for (let i = start; i <= end; i++) range.push(i);

  return (
    <div className="flex-between wrap">
      <span className="muted small">Showing {total === 0 ? 0 : (page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
      <div className="pagination">
        <button className="page-btn" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={15} />
        </button>
        {start > 1 && <button className="page-btn" onClick={() => onChange(1)}>1</button>}
        {start > 2 && <span className="muted">…</span>}
        {range.map((p) => (
          <button key={p} className={`page-btn ${p === page ? 'active' : ''}`} onClick={() => onChange(p)}>{p}</button>
        ))}
        {end < pages - 1 && <span className="muted">…</span>}
        {end < pages && <button className="page-btn" onClick={() => onChange(pages)}>{pages}</button>}
        <button className="page-btn" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}