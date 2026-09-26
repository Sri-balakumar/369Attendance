/** hr.comp.off.credit vocabulary, shared by the list, the form and the balances. */

export const COMP_OFF_STATES = {
  // The employee said "I'm working today"; nothing is earned until check-out.
  declared: { label: 'Declared', tone: 'info' },
  available: { label: 'Available', tone: 'success' },
  // Fully taken by approved comp-off leave. Kept, with the leave that took it.
  consumed: { label: 'Used', tone: 'primary' },
  expired: { label: 'Expired', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export const compOffStateMeta = (s) => COMP_OFF_STATES[s] || { label: s || '—', tone: 'muted' };

export const COMP_OFF_SOURCES = {
  weekly_off: 'Weekly off',
  public_holiday: 'Public holiday',
};

export const compOffSourceLabel = (s) => COMP_OFF_SOURCES[s] || s || '—';

export const COMP_OFF_FILTERS = [
  { key: 'available', label: 'Available' },
  { key: 'declared', label: 'Declared' },
  { key: 'consumed', label: 'Used' },
  { key: 'expired', label: 'Expired' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: null, label: 'All' },
];

/** 1 → "1", 0.5 → "0.5", never "1.00". */
export const fmtDays = (v) => String(Number(v) || 0).replace(/\.0+$/, '');
