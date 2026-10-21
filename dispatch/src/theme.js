// Central Corporate-Colorful palette. Mirrors the CSS custom properties in
// index.css so charts / inline styles stay consistent with the design tokens.
// Keep the two in sync when adjusting brand colors.

export const C = {
  // Brand
  primary: '#1769E0',
  primaryDark: '#1157BE',
  primarySoft: '#E9F1FD',
  teal: '#0D9488',
  tealSoft: '#E1F4F2',
  purple: '#7C3AED',
  purpleSoft: '#F1EBFE',
  success: '#16A34A',
  successSoft: '#E7F6EC',
  warning: '#F59E0B',
  warningSoft: '#FEF3E2',
  danger: '#E5484D',
  dangerSoft: '#FDEBEC',
  navy: '#0B2545',
  navySoft: '#E7EDF5',

  // Surfaces & text
  bg: '#F4F7FC',
  surface: '#FFFFFF',
  surface2: '#F7FAFE',
  border: '#DCE5F0',
  text: '#152B4A',
  text2: '#64748B',
  text3: '#8A9BB4',

  // Neutral accent
  slate: '#64748B',
  slateSoft: '#EEF2F7',
};

// Semantic chart series palette (section 4).
export const CHART = {
  total: C.primary,
  completed: C.success,
  pending: C.warning,
  overdue: C.danger,
  delayed: '#C2323A',
  technician: C.purple,
  gah: C.teal,
  grid: C.border,
};

// Rotating categorical palette for multi-series charts (areas, territories,
// dispositions). Leads with the brand blues/purples/teals.
export const CATEGORICAL = [
  C.primary, C.purple, C.teal, '#DB2777', C.success, C.warning, C.danger, '#0891B2', C.slate, '#F97316',
];

// Status → chip styling.
//   bg    soft tint for badge backgrounds
//   color vivid accent for charts / map markers / legends
//   text  darker shade for badge text (accessible contrast, section 8)
export const STATUS_STYLE = {
  NEW: { bg: C.primarySoft, color: C.primary, text: C.primary },
  'FOR DISPATCH': { bg: C.purpleSoft, color: C.purple, text: C.purple },
  ASSIGNED: { bg: C.tealSoft, color: C.teal, text: '#0F766E' },
  'IN PROGRESS': { bg: '#E3EDFD', color: '#2563EB', text: '#1D4ED8' },
  COMPLETED: { bg: C.successSoft, color: C.success, text: '#15803D' },
  DELAYED: { bg: C.dangerSoft, color: C.danger, text: '#C2323A' },
  'ON HOLD': { bg: C.warningSoft, color: C.warning, text: '#B45309' },
  CANCELLED: { bg: C.slateSoft, color: C.slate, text: C.slate },
  FAILED: { bg: '#FBD9DB', color: '#B42318', text: '#B42318' },
  default: { bg: C.slateSoft, color: C.slate, text: C.slate },
};

// Source channel → accent color (nodes/bars/pies).
export const CHANNEL_COLOR = {
  IPG: '#F97316',
  RTC: C.success,
  EBISU: C.purple,
  '4AM': '#0EA5E9',
  ALPHARD: C.danger,
  EMCC: '#DB2777',
  STORES: C.primary,
  ONLINE: C.teal,
};

// Vivid accent per status (used for map markers, pie slices, legends).
export function statusStyle(status) {
  return STATUS_STYLE[status] || STATUS_STYLE.default;
}

export function channelColor(channel) {
  return CHANNEL_COLOR[channel] || C.text3;
}
