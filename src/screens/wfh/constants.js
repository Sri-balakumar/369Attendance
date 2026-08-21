/**
 * WFH vocabulary. Same shape as the leave constants, but the state machine is
 * larger and behaves differently -- do not assume the two are interchangeable.
 */

/**
 * hr.wfh.request.state has EIGHT values, against leave's five.
 *
 * The two that have no leave equivalent are the point of the feature: an
 * approved WFH day is then worked, so it moves through checked_in and on to
 * checked_out. `checked_out` is NOT terminal -- the server still permits
 * another check-in the same day -- so it is styled as a finished-for-now state
 * rather than a closed one.
 *
 * `expired` is set by the server for an approved day that came and went
 * unworked. Nothing in the app produces it; it only has to render.
 */
export const WFH_STATES = {
  draft: { label: 'Draft', tone: 'muted', icon: 'create-outline' },
  pending: { label: 'Pending', tone: 'warning', icon: 'hourglass-outline' },
  approved: { label: 'Approved', tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Rejected', tone: 'danger', icon: 'close-circle-outline' },
  checked_in: { label: 'Working', tone: 'info', icon: 'radio-button-on-outline' },
  checked_out: { label: 'Done', tone: 'primary', icon: 'checkmark-done-outline' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'ban-outline' },
  expired: { label: 'Expired', tone: 'muted', icon: 'time-outline' },
};

export const wfhStateMeta = (state) =>
  WFH_STATES[state] || { label: state || 'Unknown', tone: 'muted', icon: 'help-circle-outline' };

/**
 * Sent as `state` -- the WFH API spells it that way while the leave API uses
 * `state_filter`. The asymmetry is real and is not abstracted anywhere.
 *
 * draft and expired are left out: neither is reachable through this app (the
 * route submits straight to pending, and expiry is a server-side cron), so a
 * filter for them would always come back empty. Both still render in a list.
 */
export const WFH_STATE_FILTERS = [
  { value: null, label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'checked_out', label: 'Done' },
  { value: 'rejected', label: 'Rejected' },
];

/** The server caps my_requests at this many rows, with no total in the payload. */
export const WFH_LIST_LIMIT = 50;
