import { useEffect, useState } from 'react';
import { fetchAttendanceConfig, fetchPublicHolidays } from '../services/odoo';

// hr.attendance.late.config work_* booleans -> JS getDay() numbers.
const WEEKDAY_FIELDS = [
  ['work_sunday', 0], ['work_monday', 1], ['work_tuesday', 2], ['work_wednesday', 3],
  ['work_thursday', 4], ['work_friday', 5], ['work_saturday', 6],
];

/**
 * Weekly offs and public holidays, for a date picker's markers.
 *
 * Loaded each time `active` turns on (a sheet opening), this year and next so
 * a December picker can reach January. Best effort: without them the
 * calendar still works, it just marks nothing beyond Sunday.
 */
export default function useWorkCalendar(active) {
  const [calendar, setCalendar] = useState({ weeklyOff: [0], holidays: {} });

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const year = new Date().getFullYear();
    Promise.all([
      fetchAttendanceConfig().catch(() => null),
      fetchPublicHolidays(year).catch(() => []),
      fetchPublicHolidays(year + 1).catch(() => []),
    ]).then(([cfg, thisYear, nextYear]) => {
      if (!alive) return;
      const weeklyOff = cfg ? WEEKDAY_FIELDS.filter(([f]) => cfg[f] === false).map(([, d]) => d) : [0];
      const holidays = {};
      for (const h of [...(thisYear || []), ...(nextYear || [])]) {
        if (h?.date) holidays[String(h.date).slice(0, 10)] = h.name || 'Holiday';
      }
      setCalendar({ weeklyOff, holidays });
    });
    return () => {
      alive = false;
    };
  }, [active]);

  return calendar;
}
