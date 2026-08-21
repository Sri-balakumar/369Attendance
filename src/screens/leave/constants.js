/**
 * The leave vocabulary: the server's Selection values, and how each one is
 * meant to look.
 *
 * This lives beside the screens rather than in services/odoo.js on purpose --
 * that module is transport and shaping only, and has no business knowing about
 * icons or palette tones. (mockOdoo.js's DAY_STATUS set the opposite
 * precedent, but that file is the dead mock seam and not worth extending.)
 */

/**
 * hr.leave.request.leave_type is a Selection field, not a model, so there is
 * nothing to fetch -- these six values are the whole set. `value` is sent to
 * /leave/request/create verbatim; anything else comes back as a raw ORM
 * "Wrong value for ..." error.
 */
export const LEAVE_TYPES = [
  { value: 'casual', label: 'Casual Leave', icon: 'cafe-outline' },
  { value: 'sick', label: 'Sick Leave', icon: 'medkit-outline' },
  { value: 'annual', label: 'Annual Leave', icon: 'sunny-outline' },
  { value: 'personal', label: 'Personal Leave', icon: 'person-outline' },
  { value: 'emergency', label: 'Emergency Leave', icon: 'warning-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

export const leaveTypeMeta = (type) =>
  LEAVE_TYPES.find((t) => t.value === type) || LEAVE_TYPES[LEAVE_TYPES.length - 1];

/**
 * The five states on hr.leave.request. Note 'cancelled' is spelled the British
 * way on the server -- 'canceled' silently matches nothing.
 *
 * `tone` names a key on the palette, which is what Chip expects. The colours
 * follow the backend list view's own convention so the app and the Odoo UI
 * agree at a glance.
 */
export const LEAVE_STATES = {
  draft: { label: 'Draft', tone: 'muted', icon: 'create-outline' },
  pending: { label: 'Pending', tone: 'warning', icon: 'hourglass-outline' },
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'close-circle-outline' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'ban-outline' },
};

/**
 * A Selection can gain a value in a later addon release. Chip already falls
 * back on an unknown tone, but the label would render as nothing, so an
 * unrecognised state shows its raw value rather than an empty pill.
 */
export const leaveStateMeta = (state) =>
  LEAVE_STATES[state] || { label: state || 'Unknown', tone: 'muted', icon: 'help-circle-outline' };

/**
 * Filter chips. Sent as `state_filter` -- note the leave API spells it that
 * way while the WFH API uses plain `state`.
 *
 * 'draft' is deliberately absent: /leave/request/create always submits, so a
 * draft can only be made in the backend. It stays in LEAVE_STATES above so such
 * a row still renders correctly, but it is not worth a filter of its own.
 */
export const STATE_FILTERS = [
  { value: null, label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** The server caps my_requests at this many rows, with no total in the payload. */
export const LEAVE_LIST_LIMIT = 50;
