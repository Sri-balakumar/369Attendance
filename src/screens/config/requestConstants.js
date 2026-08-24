/**
 * Vocabulary for the two manager approval queues.
 *
 * Leave and WFH do NOT share a state machine: leave has five states, WFH has
 * eight because an approved WFH day then gets checked in and out and can
 * expire. They are kept apart rather than merged into one lenient map, so an
 * unexpected value shows up as unknown instead of quietly borrowing a colour
 * that means something else.
 */

/** hr.leave.request.state -- five values. */
export const LEAVE_STATES = {
  draft: { label: 'Draft', tone: 'muted', icon: 'document-outline' },
  pending: { label: 'Pending', tone: 'warning', icon: 'hourglass-outline' },
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'close-circle-outline' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'ban-outline' },
};

/** hr.wfh.request.state -- eight, including the check-in lifecycle. */
export const WFH_STATES = {
  draft: { label: 'Draft', tone: 'muted', icon: 'document-outline' },
  pending: { label: 'Pending', tone: 'warning', icon: 'hourglass-outline' },
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'close-circle-outline' },
  checked_in: { label: 'Checked in', tone: 'info', icon: 'log-in-outline' },
  checked_out: { label: 'Done', tone: 'success', icon: 'log-out-outline' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'ban-outline' },
  expired: { label: 'Expired', tone: 'muted', icon: 'time-outline' },
};

/** hr.leave.request.leave_type -- six values, required, default casual. */
export const LEAVE_TYPES = {
  sick: 'Sick',
  casual: 'Casual',
  annual: 'Annual',
  personal: 'Personal',
  emergency: 'Emergency',
  other: 'Other',
};

const unknown = (v) => ({ label: v || 'Unknown', tone: 'muted', icon: 'help-circle-outline' });

export const leaveStateMeta = (s) => LEAVE_STATES[s] || unknown(s);
export const wfhStateMeta = (s) => WFH_STATES[s] || unknown(s);
export const leaveTypeLabel = (t) => LEAVE_TYPES[t] || t || '—';

/**
 * The filter chips, in the order a manager wants them.
 *
 * Pending first and selected by default, matching the backend action's
 * context={'search_default_pending': 1} -- the queue exists to be cleared, so
 * opening it on "everything ever" would bury the four rows that need a
 * decision.
 */
export const LEAVE_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: null, label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

export const WFH_FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: null, label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'checked_out', label: 'Done' },
  { key: 'rejected', label: 'Rejected' },
];
