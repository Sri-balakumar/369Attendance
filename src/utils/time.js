export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export function formatTime(date) {
  if (!date) return '--:--';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatLongDate(date = new Date()) {
  return date.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

// Milliseconds -> "3h 12m" / "48m". Used for the running check-in timer, so it
// must stay stable when the value is zero or briefly negative across a tick.
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function formatHours(hours) {
  const h = Number(hours) || 0;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}h ${String(mins).padStart(2, '0')}m`;
}

/**
 * Odoo datetimes are naive UTC: '2026-08-21 12:07:31', with no zone marker.
 *
 * `new Date()` reads that as LOCAL time, so on a +05:30 phone every check-in
 * would render five and a half hours early and the running timer would start
 * out wrong. Converting at the boundary means every screen can keep using
 * ordinary Date handling.
 */
export function odooUtcToIso(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  // already carries a zone
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return s.replace(' ', 'T') + 'Z';
}

/**
 * Today as 'YYYY-MM-DD', from LOCAL getters.
 *
 * Deliberately not toISOString().slice(0, 10): that converts to UTC first, so
 * anywhere east of Greenwich the calendar day flips at the wrong moment and
 * "today" becomes tomorrow for the last few hours of the evening.
 */
export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * 'YYYY-MM-DD' -> a Date at LOCAL midnight, or null.
 *
 * new Date('2026-08-21') is specified to parse as UTC midnight, which is the
 * PREVIOUS day anywhere west of Greenwich -- the same class of bug
 * odooUtcToIso() exists to prevent, wearing a different hat. Building it from
 * the parts pins it to the local day the user actually means.
 */
export function parseDateKey(key) {
  if (!key) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key).trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' -> '21 Aug 2026'. */
export function formatDateKeyShort(key) {
  const d = parseDateKey(key);
  if (!d) return '—';
  return `${d.getDate()} ${d.toLocaleDateString([], { month: 'short' })} ${d.getFullYear()}`;
}

/**
 * Two date keys -> one label, collapsing whatever the ends share:
 *   same day    '21 Aug 2026'
 *   same month  '21 – 23 Aug 2026'
 *   same year   '31 Aug – 2 Sep 2026'
 *   neither     '31 Dec 2026 – 2 Jan 2027'
 *
 * `toKey` may be '' or null, which the leave API uses to mean a single day.
 * The year is always shown: a leave list spans past and future dates, so a
 * bare '21 Aug' there is genuinely ambiguous in a way that a date in a screen
 * header never is.
 */
export function formatDateRange(fromKey, toKey) {
  const a = parseDateKey(fromKey);
  if (!a) return '—';
  const b = parseDateKey(toKey);
  if (!b || b.getTime() === a.getTime()) return formatDateKeyShort(fromKey);

  const mon = (d) => d.toLocaleDateString([], { month: 'short' });
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()} – ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
    }
    return `${a.getDate()} ${mon(a)} – ${b.getDate()} ${mon(b)} ${b.getFullYear()}`;
  }
  return `${formatDateKeyShort(fromKey)} – ${formatDateKeyShort(toKey)}`;
}

/**
 * Inclusive whole days between two keys: 1 when they are equal, 0 when either
 * is unparseable.
 *
 * Both ends are local midnight, so a day spanning a DST change is 23 or 25
 * hours. Rounding rather than flooring keeps that from truncating to one day
 * short.
 */
export function daysBetween(fromKey, toKey) {
  const a = parseDateKey(fromKey);
  if (!a) return 0;
  const b = parseDateKey(toKey) || a;
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diff < 0 ? 0 : diff + 1;
}

/** Day count -> '3 days' / '1 day' / 'Half day'. Leave days can be 0.5. */
export function formatDays(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '—';
  if (v === 0.5) return 'Half day';
  if (v === 1) return '1 day';
  return `${Number.isInteger(v) ? v : v.toFixed(1)} days`;
}
