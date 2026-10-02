import { parseDateKey } from './time';

/**
 * Weekly offs, the same rule as the server's is_weekly_off_day
 * (odoo_modules/hr_attendance_369/models/attendance_late_config.py), so the
 * app never marks a day differently from how the server grades it.
 *
 * A rule is { workingDays, monthlyOffs } in the server's numbering:
 *   workingDays  weekdays ticked as working, 0 = Monday .. 6 = Sunday
 *   monthlyOffs  { weekday: [weeks] } -- a working day that is still off on
 *                those weeks of the month: { 5: [2] } is "2nd Saturday off"
 */
export const DEFAULT_RULE = { workingDays: [0, 1, 2, 3, 4, 5], monthlyOffs: {} };

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th'];

/** JS getDay() (0 = Sunday) -> the server's weekday (0 = Monday). */
export const serverWeekday = (d) => (d.getDay() + 6) % 7;

/** 1 for the 1st-7th, 2 for the 8th-14th ... -- the 2nd Saturday is always the 8th-14th. */
export const weekOfMonth = (d) => Math.floor((d.getDate() - 1) / 7) + 1;

export const dayName = (weekday) => DAY_NAMES[weekday] || '';
export const ordinal = (n) => ORDINALS[n] || `${n}th`;

/** app_calendar's reply -> a rule. JSON turned the weekday keys into strings. */
export function ruleFromServer(data) {
  if (!data) return DEFAULT_RULE;
  const monthlyOffs = {};
  Object.entries(data.monthly_offs || {}).forEach(([wd, weeks]) => {
    monthlyOffs[Number(wd)] = (weeks || []).map(Number);
  });
  return {
    workingDays: Array.isArray(data.working_days) ? data.working_days.map(Number) : DEFAULT_RULE.workingDays,
    monthlyOffs,
  };
}

export function isWeeklyOff(dateKey, rule = DEFAULT_RULE) {
  const d = parseDateKey(dateKey);
  if (!d) return false;
  const wd = serverWeekday(d);
  if (!rule.workingDays.includes(wd)) return true;
  return (rule.monthlyOffs[wd] || []).includes(weekOfMonth(d));
}

/** Why a date is off, in words: 'Sunday' or '2nd Saturday'. '' on a working day. */
export function weeklyOffLabel(dateKey, rule = DEFAULT_RULE) {
  const d = parseDateKey(dateKey);
  if (!d || !isWeeklyOff(dateKey, rule)) return '';
  const wd = serverWeekday(d);
  return rule.workingDays.includes(wd) ? `${ordinal(weekOfMonth(d))} ${dayName(wd)}` : dayName(wd);
}
