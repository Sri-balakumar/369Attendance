import { useCallback, useEffect, useState } from 'react';
import { fetchHolidayCalendar } from '../services/odoo';
import { DEFAULT_RULE, isWeeklyOff } from '../utils/workDays';

/**
 * Weekly offs and public holidays, for a date picker's markers.
 *
 * Loaded each time `active` turns on (a sheet opening), this year and next so
 * a December picker can reach January. The weekly offs are the ones that
 * apply to this user -- their department's rules, and some-weeks-off days
 * like a 2nd Saturday -- straight from the server's app_calendar. Best
 * effort: without them the calendar still works, it just marks only Sundays.
 */
export default function useWorkCalendar(active) {
  const [state, setState] = useState({ rule: DEFAULT_RULE, holidays: {} });

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const year = new Date().getFullYear();
    Promise.all([
      fetchHolidayCalendar(year).catch(() => null),
      fetchHolidayCalendar(year + 1).catch(() => null),
    ]).then(([thisYear, nextYear]) => {
      if (!alive) return;
      const holidays = {};
      for (const h of [...(thisYear?.holidays || []), ...(nextYear?.holidays || [])]) {
        if (h?.date) holidays[String(h.date).slice(0, 10)] = h.name || 'Holiday';
      }
      setState({ rule: thisYear?.rule || nextYear?.rule || DEFAULT_RULE, holidays });
    });
    return () => {
      alive = false;
    };
  }, [active]);

  const isOff = useCallback((key) => isWeeklyOff(key, state.rule), [state.rule]);
  return { isWeeklyOff: isOff, holidays: state.holidays };
}
