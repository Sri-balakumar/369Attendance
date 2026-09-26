/**
 * Day-status vocabulary for attendance history.
 *
 * The same six values Home already renders, but defined here rather than
 * imported from services/mockOdoo.js. That file is the dead mock seam and its
 * DAY_STATUS map is the last thing in it still reachable from live code --
 * vocabulary belongs beside the screens, as it does for leave and WFH.
 */

/** hr.attendance.day.status.status -- six values, computed and stored. */
export const DAY_STATUSES = {
  present: { label: 'Present', tone: 'success', icon: 'checkmark-circle-outline' },
  late: { label: 'Late', tone: 'warning', icon: 'alarm-outline' },
  half_day: { label: 'Half Day', tone: 'info', icon: 'contrast-outline' },
  leave: { label: 'Leave', tone: 'accent', icon: 'calendar-outline' },
  absent: { label: 'Absent', tone: 'danger', icon: 'close-circle-outline' },
  // A weekly off or holiday that was worked. Never deducted; earns comp off.
  day_off: { label: 'Day Off', tone: 'primary', icon: 'sunny-outline' },
};

export const dayStatusMeta = (status) =>
  DAY_STATUSES[status] || { label: status || 'Unknown', tone: 'muted', icon: 'help-circle-outline' };

/** The order the summary strip reads in: good news first, then the exceptions. */
export const SUMMARY_ORDER = ['present', 'late', 'half_day', 'leave', 'absent', 'day_off'];
