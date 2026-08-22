import AsyncStorage from '@react-native-async-storage/async-storage';
import { odooUtcToIso, odooLocalToIso, todayKey } from '../utils/time';

/**
 * The real Odoo transport, replacing the bodies that mockOdoo.js stubbed.
 * Signatures are unchanged, so no screen code had to move.
 *
 * Two things about Odoo's JSON-RPC that shape everything here:
 *
 *   1. A failed call still returns HTTP 200. The failure is a JSON body with
 *      an `error` key, so checking response.ok proves nothing -- the body has
 *      to be inspected every time.
 *   2. Authentication is a cookie. /web/session/authenticate replies with
 *      Set-Cookie: session_id=..., and every later call to
 *      /web/dataset/call_kw or this module's /leave and /wfh routes is
 *      authorised by it. React Native's fetch keeps cookies in the native
 *      jar automatically, but that jar is opaque and cleared with the app, so
 *      the id is also captured and persisted here for later calls to send
 *      explicitly.
 */

const SESSION_KEY = '@369att:session_id';
const TIMEOUT_MS = 15000;

let sessionId = null;

// Only the employee ID is memoised, and only for the current session's uid.
// Never the rest of the record: getHomeData re-reads attendance_state on every
// load to decide whether the check-in button is live, and a cached copy of that
// would strand the button in the wrong position.
let employeeIdCache = null; // { uid, id }

// The database the session belongs to. Kept for logging and for anything that
// needs to name the database explicitly -- NOT sent as a header, see rpc().
let activeDb = null;

/**
 * Transport log. On in __DEV__ only, so nothing leaks in a release build.
 *
 * Deliberately verbose about the session cookie, because the failure this was
 * written for is invisible otherwise: login succeeds, no session is captured,
 * and every later call comes back as a 404 that looks like a wrong URL.
 */
const DEBUG = typeof __DEV__ !== 'undefined' && __DEV__;
const log = (...a) => { if (DEBUG) console.log('[odoo]', ...a); };

export async function loadSessionId() {
  if (sessionId) return sessionId;
  try {
    sessionId = await AsyncStorage.getItem(SESSION_KEY);
  } catch (e) {
    console.warn('[odoo] could not read stored session:', e?.message);
  }
  return sessionId;
}

export async function setSessionId(value) {
  sessionId = value || null;
  try {
    if (value) await AsyncStorage.setItem(SESSION_KEY, value);
    else await AsyncStorage.removeItem(SESSION_KEY);
  } catch (e) {
    console.warn('[odoo] could not persist session:', e?.message);
  }
}

export const clearSession = () => {
  employeeIdCache = null;
  activeDb = null;
  return setSessionId(null);
};

/** Pull session_id out of a Set-Cookie header, when the platform exposes one. */
function readSessionCookie(response) {
  const raw =
    response.headers?.get?.('set-cookie') || response.headers?.map?.['set-cookie'] || '';
  const match = /session_id=([^;,\s]+)/i.exec(String(raw));
  return match ? match[1] : null;
}

/**
 * One JSON-RPC call. Returns `result`, or throws an Error whose message is
 * already fit to show a user.
 */
async function rpc(url, path, params = {}, { withSession = true } = {}) {
  const endpoint = `${String(url).replace(/\/+$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  let sentSession = false;
  if (withSession) {
    const id = await loadSessionId();
    if (id) {
      headers.Cookie = `session_id=${id}`;
      sentSession = true;
    }
  }
  // NO X-Odoo-Database header here, deliberately.
  //
  // It looks like the right fix for the "No database is selected" 404, and
  // Odoo itself suggests it on that page -- but Odoo REFUSES a request that
  // carries both that header and a session_id cookie, with
  // "403 Cannot use both the session_id cookie and the x-odoo-database header".
  //
  // On a device that is unavoidable: React Native keeps its own native cookie
  // jar and attaches session_id automatically under credentials:'include',
  // without this code seeing it. So the header turned every authenticated call
  // into a 403 -- including login itself. The jar is also why the session works
  // at all, since Odoo 19 never returns session_id anywhere JS can read it.
  //
  // The database therefore travels in the session, exactly as Odoo intends.
  // Note the cookie figure below is what THIS code attached; the platform may
  // add one of its own, so "NONE" does not mean no cookie was sent.
  log(`--> POST ${path}`, { cookie: sentSession ? 'sent (explicit)' : 'none from app', withSession });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      credentials: 'include',
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params }),
    });
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') {
      throw new Error(`The server did not answer within ${TIMEOUT_MS / 1000}s.`);
    }
    // The single most common cause on a phone: "localhost" means the phone.
    throw new Error(
      'Cannot reach the server. Check the address and that your phone is on ' +
        'the same network. A phone cannot reach "localhost" — use the ' +
        "computer's network address, e.g. http://192.168.1.5:8069."
    );
  }
  clearTimeout(timer);

  const text = await response.text();
  log(`<-- ${response.status} ${path}`, {
    type: response.headers?.get?.('content-type') || '?',
    bytes: text.length,
  });

  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    // HTML rather than JSON. Log the actual page -- the wording is what
    // distinguishes the causes, and they need opposite fixes.
    log('NON-JSON REPLY:', text.slice(0, 300).replace(/\s+/g, ' '));

    // Odoo's own words when it cannot resolve a database. It means the session
    // was not recognised, NOT that the address is wrong, so it must not be
    // reported as a bad URL -- that sends people to re-type a correct address.
    // Guard against this being reintroduced: it presents as a blanket 403 on
    // every call including login, which is otherwise a confusing thing to see.
    if (/cannot use both the session_id cookie/i.test(text)) {
      throw new Error(
        'The app sent both a session cookie and a database header, which this ' +
          'server refuses. Remove the X-Odoo-Database header from rpc().'
      );
    }

    if (/no database is selected|database is not initialized/i.test(text)) {
      throw new Error(
        'Signed in, but the session was not kept. Sign in again; if it repeats, ' +
          'the server is not accepting the session cookie.'
      );
    }
    throw new Error(
      response.status === 404
        ? 'That address answered, but it is not an Odoo server.'
        : `Unexpected reply from the server (HTTP ${response.status}).`
    );
  }

  if (body.error) log('JSON-RPC ERROR:', JSON.stringify(body.error?.data?.name || body.error?.message || '').slice(0, 160));

  if (body.error) {
    const data = body.error.data || {};

    // Odoo signals an expired or unrecognised session with this exception name.
    // It is worth naming, because it is the one failure a person can act on --
    // and because the raw text is the bare word "Session expired", which gives
    // no hint that signing in again is the fix. The stored id is dropped so the
    // next attempt starts clean rather than resending something the server has
    // already rejected.
    if (/SessionExpired/i.test(String(data.name || ''))) {
      log('session rejected by the server -- clearing the stored id');
      await setSessionId(null);
      throw new Error('Your session has expired. Please sign in again.');
    }

    throw new Error(data.message || body.error.message || 'The server rejected the request.');
  }

  const cookie = readSessionCookie(response);
  if (cookie) {
    log('captured session_id from Set-Cookie');
    await setSessionId(cookie);
  }

  return body.result;
}

/**
 * Database names on a server.
 *
 * Servers with `list_db = False` in odoo.conf refuse this on purpose; the
 * message is rewritten so the Server screen's "Enter database manually"
 * fallback reads as the obvious next step rather than a dead end.
 */
export async function fetchDatabases(url) {
  let result;
  try {
    result = await rpc(url, '/web/database/list', {}, { withSession: false });
  } catch (e) {
    const message = String(e?.message || '');
    if (/access denied|not allowed|forbidden|list_db/i.test(message)) {
      throw new Error(
        'This server does not publish its database list. Enter the database ' +
          'name manually below.'
      );
    }
    throw e;
  }

  if (!Array.isArray(result)) {
    throw new Error(
      'This server does not publish its database list. Enter the database ' +
        'name manually below.'
    );
  }
  return result;
}

/**
 * Signs in and keeps the session cookie.
 *
 * Odoo answers a wrong password with a JSON-RPC error, which rpc() has already
 * turned into an exception. A *missing* uid without an error means the server
 * accepted the shape of the request but authenticated nobody.
 */
export async function authenticate({ url, db, login, password }) {
  if (!login || !password) {
    throw new Error('Enter your username and password.');
  }
  if (!url || !db) {
    throw new Error('The server address or database is missing.');
  }

  await clearSession(); // never send a stale cookie into a fresh login

  let result;
  try {
    result = await rpc(url, '/web/session/authenticate', {
      db,
      login: String(login).trim(),
      password,
    }, { withSession: false });
  } catch (e) {
    // Odoo's own wording for a bad password is "Access denied", which is
    // accurate but reads like a permissions problem to the person typing.
    if (/access denied|wrong login|invalid/i.test(String(e?.message || ''))) {
      throw new Error('Invalid username or password.');
    }
    throw e;
  }

  if (!result || !result.uid) {
    throw new Error('Invalid username or password.');
  }

  /**
   * Capturing the session on Odoo 19 is the fragile part of this whole module,
   * so it is logged in full.
   *
   * Two mechanisms, both of which can come up empty:
   *
   *   1. result.session_id -- Odoo 19 DOES NOT return it. The key is simply
   *      absent from /web/session/authenticate's payload. It is still read
   *      first because older servers do send it.
   *   2. Set-Cookie -- the server sends it, but "set-cookie" is a forbidden
   *      response header, and React Native does not expose it to JS. So
   *      readSessionCookie() returns null on a device even though the header
   *      is right there on the wire.
   *
   * When both come up empty the app holds no session id, and every later call
   * relies on the platform's own cookie jar. If that jar is not carrying it
   * either, the server cannot resolve which database the request means and
   * answers with an HTML "No database is selected" 404 -- which reads as a bad
   * URL and is anything but. rpc() detects that page by its wording and says
   * so plainly, rather than blaming the address.
   *
   * Sending X-Odoo-Database would sidestep the database question, but Odoo
   * rejects that header alongside a session cookie with a 403 -- and the
   * platform attaches the cookie on its own. So the session carries the
   * database, and the cookie jar is what has to work.
   */
  activeDb = result.db || db;
  const fromBody = result.session_id || null;
  if (fromBody) await setSessionId(fromBody);
  const stored = await loadSessionId();

  log('authenticated', {
    uid: result.uid,
    db: activeDb,
    session_id_in_body: fromBody ? 'yes' : 'NO (expected on Odoo 19)',
    session_stored: stored ? `yes (${String(stored).slice(0, 8)}...)` : 'NONE -- relying on the platform cookie jar',
  });

  return {
    uid: result.uid,
    name: result.name || result.username || String(login).trim(),
    username: result.username || String(login).trim(),
    db: result.db || db,
    context: result.user_context || {},
  };
}

/* ------------------------------------------------------------------ *
 * Talking to the module once signed in
 * ------------------------------------------------------------------ */

const SERVER_KEY = '@369att:server';

/**
 * The server the user connected to, as { url, db }.
 *
 * Read straight from the key SessionContext persists, so screens can call
 * callKw()/moduleCall() without threading the server address through every
 * component.
 */
export async function loadServer() {
  try {
    const raw = await AsyncStorage.getItem(SERVER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('[odoo] could not read stored server:', e?.message);
    return null;
  }
}

async function requireServer() {
  const server = await loadServer();
  if (!server?.url) {
    throw new Error('Not connected to a server. Sign in again.');
  }
  return server;
}

/**
 * Generic Odoo ORM call. The module has no REST route for attendance, so
 * check-in/out, day status and history all come through here.
 */
export async function callKw(model, method, args = [], kwargs = {}) {
  const { url } = await requireServer();
  return rpc(url, '/web/dataset/call_kw', {
    model,
    method,
    args,
    kwargs: { context: {}, ...kwargs },
  });
}

/**
 * One of this module's own /leave/* or /wfh/* routes.
 *
 * They answer with `{status: bool, message: str, ...}` -- note `status`, not
 * `success`, and there is no error code, only the message. A logical failure
 * still arrives as HTTP 200 with status false, so it has to be unwrapped here
 * rather than left to the caller.
 */
export async function moduleCall(path, params = {}) {
  const { url } = await requireServer();
  const result = await rpc(url, path, params);
  if (!result || result.status !== true) {
    throw new Error(result?.message || 'The request could not be completed.');
  }
  return result;
}

/**
 * The rows out of a module response.
 *
 * The key genuinely differs per endpoint -- leave returns `data`, WFH returns
 * `requests`, and the WFH dashboard returns `wfh_employees` -- so callers ask
 * for rows rather than guessing which one applies.
 */
export const rowsOf = (result) =>
  result?.data ?? result?.requests ?? result?.wfh_employees ?? [];

/* ------------------------------------------------------------------ *
 * Attendance
 *
 * Every call below was verified against a live Odoo 19 as an ORDINARY
 * employee, which matters because several obvious approaches are denied:
 *
 *   - hr.employee.attendance_manual does not exist in 19.
 *   - _attendance_action_change is private, so call_kw refuses it.
 *   - creating hr.attendance directly raises AccessError: the stock rule
 *     gives employees READ-ONLY on their own records (perm_create=0).
 *   - hr.attendance.late.config.get_config_for_employee() raises
 *     AccessError, because touching hr.employee pulls `version_id`, which
 *     is HR-officer-only in 19 thanks to the hr.version delegation.
 *
 * What works is the systray route the Odoo web client itself uses. It takes
 * the employee from the session, so nothing can be spoofed, and it routes
 * through the override in this module that injects
 * `skip_late_reason_required` -- so a late check-in is never blocked.
 * ------------------------------------------------------------------ */

// Denied to ordinary employees: check_in_office_time / check_out_office_time
// are formatted through hr.employee and raise. Times are formatted in the app
// instead, using the office timezone read from the config below.
const ATTENDANCE_FIELDS = [
  'check_in', 'check_out', 'worked_hours', 'is_late',
  'late_minutes_display', 'late_reason', 'work_location', 'is_wfh',
];

/** The signed-in user's employee record, or null if HR never linked one. */
export async function fetchMyEmployee(uid) {
  const rows = await callKw('hr.employee', 'search_read', [
    [['user_id', '=', uid]],
    ['id', 'name', 'attendance_state'],
  ]);
  const row = rows?.[0] || null;
  if (row) employeeIdCache = { uid, id: row.id };
  return row;
}

/**
 * The signed-in user's hr.employee id, memoised for the session.
 *
 * The leave balance is keyed by hr.employee id, not res.users id, so it needs
 * this. It is deliberately NOT stashed on the persisted session user: that
 * object is written once at sign-in and the app keeps people signed in
 * indefinitely, so anyone HR linked to an employee after their first login
 * would be stuck with a stale copy and no way to refresh it.
 */
export async function getMyEmployeeId(uid) {
  if (employeeIdCache && employeeIdCache.uid === uid) return employeeIdCache.id;
  const employee = await fetchMyEmployee(uid);
  if (!employee) {
    throw new Error('No employee record is linked to your user account. Please contact HR.');
  }
  return employee.id;
}

/** Office hours, grace and timezone. Read off the model, never via the method. */
export async function fetchAttendanceConfig() {
  const rows = await callKw('hr.attendance.late.config', 'search_read', [
    [],
    ['office_start_hour', 'office_end_hour', 'late_threshold_minutes',
     'daily_work_hours', 'late_until_hour', 'half_day_after_hour', 'timezone'],
  ], { limit: 1 });
  return rows?.[0] || null;
}

/**
 * Check in, or check out. One route, one button -- it toggles on the server.
 *
 * The reply carries a base64 avatar that is far larger than everything else
 * combined; it is dropped here so nothing downstream is tempted to keep it.
 */
export async function toggleAttendance() {
  const { url } = await requireServer();
  const result = await rpc(url, '/hr_attendance/systray_check_in_out', {});
  return {
    employeeId: result?.id,
    state: result?.attendance_state,      // 'checked_in' | 'checked_out'
    hoursToday: result?.hours_today || 0,
    lastCheckIn: odooUtcToIso(result?.last_check_in),
    lastWorkedHours: result?.last_attendance_worked_hours || 0,
  };
}

/** First and last day of a month, as 'YYYY-MM-DD'. */
function monthBounds(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(last)}` };
}

// todayKey now lives in utils/time.js beside the other date helpers. It is
// re-exported here so nothing that imported it from this module has to move.
export { todayKey };

/**
 * Everything the Home screen needs, in one place.
 *
 * The month figures come from hr.attendance.day.status -- the module's own
 * graded ladder -- and deliberately NOT from hr.employee.report, which
 * carries wage and final_amount. Even now those are rule-scoped, an
 * attendance screen has no business reading salary models.
 */
export async function getHomeData(uid) {
  const employee = await fetchMyEmployee(uid);
  if (!employee) {
    throw new Error(
      'No employee record is linked to your user account. Please contact HR.'
    );
  }

  const { from, to } = monthBounds();
  const today = todayKey();

  const [statuses, attendances, config, wfhToday] = await Promise.all([
    callKw('hr.attendance.day.status', 'search_read', [
      [['employee_id', '=', employee.id], ['date', '>=', from], ['date', '<=', to]],
      ['date', 'status', 'status_display', 'is_wfh'],
    ], { order: 'date desc' }),
    callKw('hr.attendance', 'search_read', [
      [['employee_id', '=', employee.id], ['check_in', '>=', `${from} 00:00:00`]],
      ATTENDANCE_FIELDS,
    ], { order: 'check_in desc', limit: 60 }),
    fetchAttendanceConfig(),
    // Whether today is an approved WFH day. Allowed to fail on its own: it
    // only badges the button and relaxes the geo-fence, so losing it must not
    // cost the whole dashboard.
    fetchWfhToday().catch(() => null),
  ]);

  const byDate = {};
  for (const row of attendances) {
    const day = String(row.check_in || '').slice(0, 10);
    if (!byDate[day]) byDate[day] = row;
  }

  const month = { present: 0, late: 0, absent: 0, leave: 0, half_day: 0 };
  for (const s of statuses) {
    if (month[s.status] !== undefined) month[s.status] += 1;
  }

  const todayStatus = statuses.find((s) => s.date === today) || null;
  const openRow = attendances.find((a) => a.check_in && !a.check_out) || null;
  const todayRow = byDate[today] || null;

  return {
    employee,
    config,
    today: {
      // 'checked_in' while an attendance is open. Once closed, the module
      // forbids checking in again the same day, so the button must go
      // inert rather than inviting a second check-in.
      checkedIn: employee.attendance_state === 'checked_in',
      doneForToday: Boolean(todayRow && todayRow.check_out),
      checkInAt: odooUtcToIso(todayRow?.check_in),
      checkOutAt: odooUtcToIso(todayRow?.check_out),
      workedHours: todayRow?.worked_hours || 0,
      isLate: Boolean(todayRow?.is_late),
      lateDisplay: todayRow?.late_minutes_display || '',
      lateReason: todayRow?.late_reason || '',
      isWfh: Boolean(todayRow?.is_wfh),
      status: todayStatus?.status || null,
      statusDisplay: todayStatus?.status_display || '',
      openAttendanceId: openRow ? openRow.id : null,
    },
    // The module is explicit that this must not become a second check-in
    // button: there is one, and this only badges it and skips the geo-fence.
    wfh: {
      today: Boolean(wfhToday?.hasWfhToday),
      skipGeofence: Boolean(wfhToday?.skipGeofence),
    },
    month: {
      label: new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }),
      ...month,
    },
    recent: statuses.slice(0, 10).map((s) => {
      const row = byDate[s.date];
      return {
        id: s.id,
        date: s.date,
        status: s.status,
        statusDisplay: s.status_display,
        checkIn: odooUtcToIso(row?.check_in),
        checkOut: odooUtcToIso(row?.check_out),
        hours: row?.worked_hours || 0,
        isWfh: Boolean(s.is_wfh),
      };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * Leave
 *
 * Four calls, and they do not share a transport. The three request routes are
 * this module's own `/leave/request/*` endpoints behind moduleCall(); the
 * balance has no route at all and goes through call_kw on the config model.
 *
 * Two id spaces meet here and they are NOT interchangeable: the routes take a
 * res.users id (which this app never sends -- see createLeaveRequest), while
 * the balance takes an hr.employee id.
 * ------------------------------------------------------------------ */

/**
 * One my_requests row, screen-shaped.
 *
 * from/to are DATE-ONLY strings and stay strings the whole way to the
 * formatter. odooUtcToIso() must never touch them: '2026-08-21' has no space
 * to replace, so it comes back '2026-08-21Z' -- not valid ISO 8601, and the
 * PREVIOUS day once the phone is west of Greenwich. approval_date is the one
 * field in this payload that really is a naive-UTC datetime, so it is the one
 * field that goes through the converter.
 */
function toLeaveRequest(r) {
  const from = r.from_date || '';
  const to = r.to_date || from;   // the route sends '' , not null, for a single day
  return {
    id: r.id,
    type: r.leave_type,
    typeLabel: r.leave_type_label || '',
    from,
    to,
    isSingleDay: to === from,
    days: Number(r.number_of_days) || 0,   // Float on the server; 0.5 is possible
    reason: r.reason || '',
    state: r.state,                        // note 'cancelled', British spelling
    approvedBy: r.approved_by || '',       // already a name, '' when nobody has acted
    autoApproved: Boolean(r.auto_approved),
    approvedAt: r.approval_date ? odooUtcToIso(r.approval_date) : null,
    rejectionReason: r.rejection_reason || '',
    // Mirrors action_cancel's own guard on the server, so no screen has to
    // re-derive the state machine. An APPROVED leave really is cancellable.
    canCancel: ['draft', 'pending', 'approved'].includes(r.state),
  };
}

/** My leave requests, newest first. The server caps this at 50 rows. */
export async function fetchLeaveRequests({ stateFilter = null } = {}) {
  const result = await moduleCall(
    '/leave/request/my_requests',
    stateFilter ? { state_filter: stateFilter } : {}
  );
  return rowsOf(result).map(toLeaveRequest);
}

/**
 * Paid-leave balance. There is no HTTP route, so this is call_kw on the config
 * model, and employee_id is an hr.employee id rather than a res.users id.
 *
 * callKw returns body.result raw with no envelope, and when the policy is off
 * the method returns EXACTLY {has_quota: false} with every other key absent.
 * Guarding on has_quota before reading anything else is required, not defensive.
 */
export async function fetchLeaveBalance(employeeId, year = new Date().getFullYear()) {
  const result = await callKw('hr.leave.config', 'get_employee_leave_balance', [employeeId, year]);
  if (!result || result.has_quota !== true) return { hasQuota: false };
  return {
    hasQuota: true,
    year,
    totalAllowed: Number(result.total_allowed) || 0,
    // Counts APPROVED requests only -- pending days are not deducted yet, which
    // the screen has to say out loud or the figure reads as wrong.
    totalUsed: Number(result.total_used) || 0,
    remaining: Number(result.remaining) || 0,
    perMonth: Number(result.per_month) || 0,
    unpaidDeductionEnabled: Boolean(result.unpaid_deduction_enabled),
  };
}

/**
 * Create and submit in one call -- the route runs action_submit itself, so a
 * new request comes back already 'pending' and never sits in 'draft'.
 *
 * user_id is deliberately never sent. The route falls back to the session user,
 * and the parameter is spoofable, so omitting it is both correct and the safer
 * default if this app is ever pointed at an unpatched server.
 */
export async function createLeaveRequest({ leaveType, fromDate, toDate, reason }) {
  const result = await moduleCall('/leave/request/create', {
    leave_type: leaveType || 'casual',
    from_date: fromDate,
    // A single day sends no to_date at all, matching the field's own "leave
    // empty for single day leave" and keeping number_of_days on its 1-day path.
    ...(toDate && toDate !== fromDate ? { to_date: toDate } : {}),
    reason,
  });
  // Not rowsOf(): `data` is an object {id, state} here, not an array.
  return { id: result?.data?.id, state: result?.data?.state || 'pending' };
}

/** Cancel. The route returns no state key, so the caller must re-read the list. */
export async function cancelLeaveRequest(requestId) {
  const result = await moduleCall('/leave/request/cancel', { request_id: Number(requestId) });
  return result?.message || 'Leave request cancelled';
}

/**
 * Everything the Leave screen needs, in one place. Mirrors getHomeData.
 *
 * The balance is allowed to fail on its own. get_employee_leave_balance reads
 * hr.employee.company_id, and an implicit dot-read on hr.employee is exactly
 * the shape that has raised AccessError here before, so a failure degrades the
 * balance card rather than taking down the list -- which is the screen's actual
 * reason to exist.
 */
export async function getLeaveData(uid, { stateFilter = null } = {}) {
  const employeeId = await getMyEmployeeId(uid);
  const year = new Date().getFullYear();
  const [requests, balance] = await Promise.all([
    fetchLeaveRequests({ stateFilter }),
    fetchLeaveBalance(employeeId, year).catch(() => null),
  ]);
  return { employeeId, year, balance, requests };
}

/* ------------------------------------------------------------------ *
 * Work From Home
 *
 * Same module, but the WFH envelope differs from leave at every turn, so
 * nothing here can be copied across without checking:
 *
 *   list key      requests          (leave: data)
 *   filter param  state             (leave: state_filter)
 *   create reply  request_id/state at the TOP level, not nested under data
 *   date          a single request_date, never a range
 *   states        eight, including checked_in / checked_out
 *
 * Neither create nor my_requests takes a user_id at all -- both read the
 * session user directly on the server -- so there is nothing to omit here.
 * ------------------------------------------------------------------ */

/**
 * One my_requests row.
 *
 * The times here are RAW UTC: get_my_wfh_requests uses str(field). Its sibling
 * /wfh/today_status runs the same fields through convert_to_user_tz and hands
 * back local ones instead, shaped identically. Getting the pair the wrong way
 * round is a silent five-and-a-half-hour error on this timezone, so the
 * converter is chosen per endpoint and never by inspecting the value.
 */
function toWfhRequest(r) {
  return {
    id: r.id,
    date: r.request_date || '',        // date-only: stays a string
    reason: r.reason || '',
    state: r.state,
    approvedBy: r.approved_by || '',
    autoApproved: Boolean(r.auto_approved),
    approvedAt: r.approval_date ? odooUtcToIso(r.approval_date) : null,
    rejectionReason: r.rejection_reason || '',
    checkIn: r.checkin_time ? odooUtcToIso(r.checkin_time) : null,
    checkOut: r.checkout_time ? odooUtcToIso(r.checkout_time) : null,
    workedHours: r.worked_hours_display || '',
    canCheckIn: Boolean(r.can_checkin),
    canCheckOut: Boolean(r.can_checkout),
    isToday: Boolean(r.is_today),
    // Mirrors action_cancel on the server. checked_out is deliberately absent:
    // the day is done, but it is NOT a terminal state -- the server still
    // allows another check-in, which is why it is not treated as finished.
    canCancel: ['draft', 'pending', 'approved'].includes(r.state),
  };
}

/** My WFH requests, newest first. Server caps this at 50 rows. */
export async function fetchWfhRequests({ stateFilter = null } = {}) {
  const result = await moduleCall(
    '/wfh/request/my_requests',
    stateFilter ? { state: stateFilter } : {}
  );
  return rowsOf(result).map(toWfhRequest);
}

/** Create and submit. The route sets state 'pending' itself, skipping draft. */
export async function createWfhRequest({ date, reason }) {
  const result = await moduleCall('/wfh/request/create', {
    request_date: date,
    reason,
  });
  // Top level, unlike leave's nested data.{id,state}.
  return { id: result?.request_id, state: result?.state || 'pending' };
}

/** Cancel. Unlike leave's, this one does return the resulting state. */
export async function cancelWfhRequest(requestId) {
  const result = await moduleCall('/wfh/request/cancel', { request_id: Number(requestId) });
  return { id: result?.request_id, state: result?.state, message: result?.message || 'WFH request cancelled' };
}

/**
 * Whether today is an approved WFH day.
 *
 * The module is explicit that this must NOT drive a second check-in button:
 * there is one attendance button, and this only decides whether to badge it
 * and skip the geo-fence. Times here are USER-LOCAL, hence odooLocalToIso.
 */
export async function fetchWfhToday() {
  const result = await moduleCall('/wfh/today_status', {});
  const w = result?.wfh_request || null;
  return {
    hasWfhToday: Boolean(result?.has_wfh_today),
    useNormalAttendance: result?.use_normal_attendance !== false,
    skipGeofence: Boolean(result?.skip_geofence),
    request: w
      ? {
          id: w.id,
          state: w.state,
          canCheckIn: Boolean(w.can_checkin),
          canCheckOut: Boolean(w.can_checkout),
          checkIn: w.checkin_time ? odooLocalToIso(w.checkin_time) : null,
          checkOut: w.checkout_time ? odooLocalToIso(w.checkout_time) : null,
          workedHours: w.worked_hours_display || '',
        }
      : null,
  };
}

/** Everything the WFH screen needs. Mirrors getLeaveData. */
export async function getWfhData(uid, { stateFilter = null } = {}) {
  const [requests, today] = await Promise.all([
    fetchWfhRequests({ stateFilter }),
    fetchWfhToday().catch(() => null),
  ]);
  return { today, requests };
}

/* ------------------------------------------------------------------ *
 * Attendance history, and My Details
 * ------------------------------------------------------------------ */

/**
 * A month of graded days.
 *
 * Same source as Home's month tiles -- hr.attendance.day.status, the module's
 * own ladder -- rather than hr.employee.report, which carries wage and
 * final_amount. deduction_amount is on this model too and is deliberately not
 * read: the app has no business showing a person a money figure it cannot
 * explain.
 */
export async function fetchAttendanceMonth(uid, year, month) {
  const employeeId = await getMyEmployeeId(uid);
  const pad = (n) => String(n).padStart(2, '0');
  const from = `${year}-${pad(month + 1)}-01`;
  const to = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;

  const [statuses, attendances] = await Promise.all([
    callKw('hr.attendance.day.status', 'search_read', [
      [['employee_id', '=', employeeId], ['date', '>=', from], ['date', '<=', to]],
      ['id', 'date', 'status', 'status_display', 'is_wfh'],
    ], { order: 'date desc' }),
    callKw('hr.attendance', 'search_read', [
      [['employee_id', '=', employeeId], ['check_in', '>=', `${from} 00:00:00`],
       ['check_in', '<=', `${to} 23:59:59`]],
      ATTENDANCE_FIELDS,
    ], { order: 'check_in desc', limit: 100 }),
  ]);

  const byDate = {};
  for (const a of attendances) {
    const key = odooUtcToIso(a.check_in)?.slice(0, 10);
    if (key && !byDate[key]) byDate[key] = a;
  }

  const totals = { present: 0, late: 0, absent: 0, leave: 0, half_day: 0 };
  let hours = 0;
  const days = statuses.map((s) => {
    if (totals[s.status] !== undefined) totals[s.status] += 1;
    const row = byDate[s.date];
    hours += row?.worked_hours || 0;
    return {
      id: s.id,
      date: s.date,                       // date-only: stays a string
      status: s.status,
      statusDisplay: s.status_display || '',
      isWfh: Boolean(s.is_wfh),
      checkIn: odooUtcToIso(row?.check_in),
      checkOut: odooUtcToIso(row?.check_out),
      hours: row?.worked_hours || 0,
      isLate: Boolean(row?.is_late),
      lateDisplay: row?.late_minutes_display || '',
    };
  });

  return {
    year,
    month,
    label: new Date(year, month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' }),
    totals,
    totalHours: hours,
    days,
  };
}

/**
 * The employee's own details, straight off res.users.
 *
 * NOT off hr.employee: that model has no base.group_user ACL row in Odoo 19,
 * and its public fallback refuses everything interesting -- blood_group,
 * emergency contacts and the rest all raise for the very person they describe.
 *
 * The addon already solves this the way core hr does, with SELF_READABLE_FIELDS
 * and SELF_WRITEABLE_FIELDS allow-lists on res.users plus related fields
 * carrying related_sudo=False. Reading through that inherits those access rules
 * instead of inventing a second set, and returns the visibility switches in the
 * same call -- so one read gives both the values and whether to show them.
 */
const DETAIL_FIELDS = [
  'name', 'login',
  'blood_group', 'father_name', 'mother_name',
  'emergency_contact_relation', 'emergency_contact_2', 'emergency_phone_2',
  'emergency_contact_relation_2',
  'show_personal_section', 'show_employment_section', 'show_statutory_section',
  'show_blood_group', 'show_father_name', 'show_mother_name',
  'show_emergency_relation', 'show_second_emergency_contact',
  'show_qualifications', 'show_previous_employment',
];

const BLOOD_GROUPS = {
  a_pos: 'A+', a_neg: 'A-', b_pos: 'B+', b_neg: 'B-',
  ab_pos: 'AB+', ab_neg: 'AB-', o_pos: 'O+', o_neg: 'O-',
};

export async function getMyDetails(uid) {
  const rows = await callKw('res.users', 'read', [[uid], DETAIL_FIELDS]);
  const u = rows?.[0];
  if (!u) throw new Error('Could not read your profile.');

  const show = (k) => Boolean(u[k]);
  const val = (v) => (v === false || v === null || v === undefined ? '' : String(v));

  const [qualifications, previous] = await Promise.all([
    show('show_qualifications')
      ? callKw('hr.employee.qualification', 'search_read', [
          [], ['id', 'name', 'specialization', 'institution', 'year_of_passing', 'grade'],
        ], { order: 'year_of_passing desc' })
      : Promise.resolve([]),
    show('show_previous_employment')
      ? callKw('hr.employee.previous.employment', 'search_read', [
          // last_drawn_salary is available here and deliberately not requested.
          [], ['id', 'company_name', 'job_title', 'location', 'date_from', 'date_to', 'duration_display'],
        ], { order: 'date_from desc' })
      : Promise.resolve([]),
  ]);

  return {
    name: val(u.name),
    login: val(u.login),
    sections: {
      personal: show('show_personal_section'),
      employment: show('show_employment_section'),
      statutory: show('show_statutory_section'),
      qualifications: show('show_qualifications'),
      previousEmployment: show('show_previous_employment'),
    },
    personal: {
      bloodGroup: show('show_blood_group') ? BLOOD_GROUPS[u.blood_group] || '' : '',
      fatherName: show('show_father_name') ? val(u.father_name) : '',
      motherName: show('show_mother_name') ? val(u.mother_name) : '',
      emergencyRelation: show('show_emergency_relation') ? val(u.emergency_contact_relation) : '',
      emergency2: show('show_second_emergency_contact')
        ? {
            name: val(u.emergency_contact_2),
            phone: val(u.emergency_phone_2),
            relation: val(u.emergency_contact_relation_2),
          }
        : null,
    },
    qualifications: (qualifications || []).map((q) => ({
      id: q.id,
      name: val(q.name),
      specialization: val(q.specialization),
      institution: val(q.institution),
      year: val(q.year_of_passing),
      grade: val(q.grade),
    })),
    previousEmployment: (previous || []).map((p) => ({
      id: p.id,
      company: val(p.company_name),
      jobTitle: val(p.job_title),
      location: val(p.location),
      from: val(p.date_from),
      to: val(p.date_to),
      duration: val(p.duration_display),
    })),
  };
}
