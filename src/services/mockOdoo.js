/**
 * THE SEAM.
 *
 * This first pass is UI only — nothing here touches a network. Every function
 * below keeps the exact signature its real implementation will have, so wiring
 * the app to a live Odoo server later means replacing these three bodies and
 * changing no screen code.
 *
 * What replaces them (the shape already working in the sibling 369Application):
 *
 *   fetchDatabases(url)
 *     POST {url}/web/database/list
 *     body: { jsonrpc: '2.0', method: 'call', params: {} }
 *     -> res.data.result is the string[] of database names.
 *     Servers with `list_db = False` in odoo.conf answer with an error; that is
 *     exactly why the Server screen keeps a manual-database fallback.
 *
 *   authenticate({ url, db, login, password })
 *     POST {url}/web/session/authenticate
 *     body: { jsonrpc: '2.0', method: 'call', params: { db, login, password } }
 *     -> res.data.result carries uid / name / username / user_context.
 *     Also capture the `set-cookie` response header and persist it: subsequent
 *     calls to /web/dataset/call_kw and the module's own /leave/* and /wfh/*
 *     routes (auth='user') are authorised by that session cookie.
 *
 *   getHomeData()
 *     hr.employee attendance_state + this module's day-status and summary
 *     models, read through /web/dataset/call_kw.
 */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolves the databases available on a server.
 *
 * Demo behaviour, so every branch of the Server screen can be exercised with
 * no server running:
 *   - a URL containing "single" -> exactly one database (auto-selected)
 *   - a URL containing "bad"    -> rejects (error card + Retry + manual entry)
 *   - a URL containing "empty"  -> resolves [] (no databases found)
 *   - anything else             -> three databases
 */
export async function fetchDatabases(url) {
  await delay(1200);
  const u = String(url || '').toLowerCase();

  if (u.includes('bad')) {
    throw new Error('Cannot reach this server. Check the URL and your network.');
  }
  if (u.includes('empty')) return [];
  if (u.includes('single')) return ['369_live'];

  return ['369_live', '369_staging', '369_test'];
}

/**
 * Signs a user in. Any non-empty credentials succeed, except the username
 * "fail", which rejects so the login error state stays reviewable.
 */
export async function authenticate({ url, db, login, password }) {
  await delay(1200);

  if (!login || !password) {
    throw new Error('Enter your username and password.');
  }
  if (String(login).trim().toLowerCase() === 'fail') {
    throw new Error('Invalid username or password.');
  }

  return {
    uid: 7,
    name: 'Arun Kumar',
    username: String(login).trim(),
    job: 'Software Engineer',
    department: 'Engineering',
    company: 'Alphalize Technologies',
    employeeCode: 'ALP-0142',
    initials: 'AK',
    db,
    server: url,
  };
}

/** Today's status, this month's totals and the last five days. */
export async function getHomeData() {
  await delay(800);
  return {
    today: {
      // The screen owns the live check-in state; this is the starting point.
      checkedIn: false,
      checkInAt: null,
      checkOutAt: null,
      status: 'present',
      lateMinutes: 0,
      workedHours: 0,
      expectedHours: 9,
      isWfh: false,
    },
    month: {
      label: new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }),
      present: 18,
      late: 3,
      absent: 1,
      leave: 2,
    },
    recent: [
      { id: 5, date: dayOffset(-1), checkIn: '09:04 AM', checkOut: '06:32 PM', hours: 9.4, status: 'present' },
      { id: 4, date: dayOffset(-2), checkIn: '09:48 AM', checkOut: '06:40 PM', hours: 8.8, status: 'late' },
      { id: 3, date: dayOffset(-3), checkIn: '08:58 AM', checkOut: '02:10 PM', hours: 5.2, status: 'half_day' },
      { id: 2, date: dayOffset(-4), checkIn: '—', checkOut: '—', hours: 0, status: 'absent' },
      { id: 1, date: dayOffset(-5), checkIn: '09:01 AM', checkOut: '06:28 PM', hours: 9.4, status: 'present' },
    ],
  };
}

function dayOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Vocabulary matches attendance_day_status.py on the Odoo side, so the later
// wiring pass is a data swap rather than a redesign of these chips.
export const DAY_STATUS = {
  present: { label: 'Present', tone: 'success' },
  late: { label: 'Late', tone: 'warning' },
  half_day: { label: 'Half Day', tone: 'info' },
  absent: { label: 'Absent', tone: 'danger' },
  leave: { label: 'Leave', tone: 'accent' },
  wfh: { label: 'WFH', tone: 'primary' },
};
