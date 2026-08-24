import { useCallback, useMemo, useState } from 'react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Month pager state, shared by the screens that page a month at a time.
 *
 * `month` is 1-12 rather than JS's 0-11, because that is what goes into an
 * Odoo domain and mixing the two conventions in one screen is how an off-by-one
 * month bug gets written.
 *
 * Paging forward past the current month is blocked: those rows cannot exist
 * yet, so it would only ever show an empty list.
 */
export function useMonth(initial) {
  const now = new Date();
  const [cursor, setCursor] = useState(
    initial || { year: now.getFullYear(), month: now.getMonth() + 1 }
  );

  const shift = useCallback((delta) => {
    setCursor((c) => {
      const zero = c.month - 1 + delta;
      return { year: c.year + Math.floor(zero / 12), month: ((zero % 12) + 12) % 12 + 1 };
    });
  }, []);

  const isCurrent = cursor.year === now.getFullYear() && cursor.month === now.getMonth() + 1;

  return useMemo(
    () => ({
      year: cursor.year,
      month: cursor.month,
      label: `${MONTH_NAMES[cursor.month - 1]} ${cursor.year}`,
      prev: () => shift(-1),
      next: () => shift(1),
      isCurrent,
    }),
    [cursor.year, cursor.month, shift, isCurrent]
  );
}

export { MONTH_NAMES };
