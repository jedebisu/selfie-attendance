import React from 'react';

export default function TechnicianSelect({ value, roster, saving, onChange, className = 'select', style, title = 'Assign technician' }) {
  const rosterNames = (roster || []).map((t) => t.name);
  return (
    <select
      className={className}
      style={style}
      value={value || ''}
      disabled={saving}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      title={title}
    >
      <option value="">Unassigned</option>
      {(roster || []).map((t) => (
        <option key={t.id} value={t.name}>{t.name}{t.team ? ` (${t.team})` : ''}</option>
      ))}
      {value && !rosterNames.includes(value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}
