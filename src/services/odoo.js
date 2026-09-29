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

const knownFieldCache = new Map();

/**
 * `wanted` narrowed to the fields this server's module actually has, or null
 * when the model itself does not exist there. The app can run ahead of the
 * server (Metro serves the repo before the addon is upgraded), and asking an
 * older server for one missing field fails the whole read with
 * "Invalid field", taking the screen down with it.
 */
async function knownFields(model, wanted) {
  const { url } = await requireServer();
  const key = `${url}|${model}`;
  if (!knownFieldCache.has(key)) {
    try {
      const defs = await callKw(model, 'fields_get', [], { attributes: ['type'] });
      knownFieldCache.set(key, new Set(Object.keys(defs || {})));
    } catch {
      // Model not installed on this server; don't cache, it may be upgraded.
      return null;
    }
  }
  const have = knownFieldCache.get(key);
  return wanted.filter((f) => have.has(f));
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
  let rows;
  try {
    rows = await callKw('hr.employee', 'search_read', [
      [['user_id', '=', uid]],
      ['id', 'name', 'attendance_state'],
    ]);
  } catch (e) {
    // A plain employee (no attendance-officer group) reads hr.employee
    // through hr.employee.public, where attendance_state is denied. Read the
    // public fields, then derive the state from their own OPEN attendance,
    // which the stock rule does let them read.
    if (!/attendance_state|enough rights/i.test(e?.message || '')) throw e;
    rows = await callKw('hr.employee', 'search_read', [[['user_id', '=', uid]], ['id', 'name']]);
    if (rows?.[0]) {
      const open = await callKw('hr.attendance', 'search_count', [
        [['employee_id', '=', rows[0].id], ['check_out', '=', false]],
      ]);
      rows[0].attendance_state = open ? 'checked_in' : 'checked_out';
    }
  }
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
const ATTENDANCE_CONFIG_FIELDS = [
  'id', 'company_id', 'department_id',
  'late_tracking_enabled', 'late_reason_required',
  'office_start_hour', 'office_end_hour', 'daily_work_hours',
  'late_threshold_minutes',
  'late_until_hour', 'half_day_after_hour', 'half_day_min_hours_ratio',
  'timezone',
  'work_monday', 'work_tuesday', 'work_wednesday', 'work_thursday',
  'work_friday', 'work_saturday', 'work_sunday',
  'kra_workday_creates_attendance',
  // _rec_name on the model: 'Company (Company-wide)' or 'Company / Dept'.
  'display_name',
];

/**
 * Office hours, grace and timezone. Read off the model, never via the method.
 *
 * get_config_for_employee() and its siblings all browse hr.employee, which an
 * ordinary employee cannot read in Odoo 19, so they raise AccessError. Reading
 * the fields directly is the supported path and works for everybody.
 *
 * Returns the COMPANY-WIDE row -- department_id false. Department rows exist
 * and take precedence on the server, so they are fetched separately rather than
 * silently collapsed into one figure here.
 */
export async function fetchAttendanceConfig() {
  const rows = await callKw('hr.attendance.late.config', 'search_read', [
    [['department_id', '=', false]],
    ATTENDANCE_CONFIG_FIELDS,
  ], { limit: 1 });
  return rows?.[0] || null;
}

/**
 * EVERY rules row -- company-wide first, then one per department.
 *
 * The Config screen lists them all rather than fetching the company-wide row
 * alone, mirroring the backend action's `view_mode: list,form`. That is not
 * cosmetic: department_id is editable, and a screen that queried
 * department_id = false would make a row it just re-scoped disappear -- taking
 * the company's only rules with it, silently, with every employee dropping to
 * get_config_for_employee's hardcoded fallback. Listing every row is what
 * makes the scope safe to edit.
 *
 * order: 'department_id' puts the NULL department (company-wide) first.
 */
export async function fetchAttendanceConfigs() {
  const rows = await callKw('hr.attendance.late.config', 'search_read', [
    [], ATTENDANCE_CONFIG_FIELDS,
  ], { order: 'department_id' });
  return rows || [];
}

/** Department overrides, which beat the company-wide row for their people. */
export async function fetchAttendanceConfigOverrides() {
  const rows = await callKw('hr.attendance.late.config', 'search_read', [
    [['department_id', '!=', false]],
    ATTENDANCE_CONFIG_FIELDS,
  ], { order: 'department_id' });
  return rows || [];
}

/**
 * May this user perform `operation` on `model`?
 *
 * Asks the permission question directly rather than testing group membership.
 * It stays correct if the ACL is re-cut, and it is the question the screen
 * actually has: show the control, or do not. (has_group works too, but must be
 * called as [[uid], 'xml.id'] -- passing the id alone raises a TypeError.)
 */
export async function canDo(model, operation) {
  try {
    return Boolean(
      await callKw(model, 'check_access_rights', [operation], { raise_exception: false })
    );
  } catch (e) {
    // A refusal is an answer, not a failure: treat it as "no".
    return false;
  }
}

/** May this user edit the attendance rules? */
export const canEditAttendanceConfig = () => canDo('hr.attendance.late.config', 'write');

/**
 * The three manager capabilities behind the Config tab, in one round trip.
 *
 * The two probes below are deliberately NOT the obvious ones. Both
 * hr.leave.request and hr.wfh.request grant base.group_user 1,1,1,0 -- every
 * employee may write their OWN requests -- so a write probe on either answers
 * true for everybody and would put the managers' approval queues in front of
 * staff. What separates a manager is:
 *
 *   leave -> write on hr.leave.config   (manager 1,1,1,1 / user 1,0,0,0)
 *   wfh   -> UNLINK on hr.wfh.request   (there is no wfh config model, and
 *                                        unlink is the one permission only
 *                                        group_wfh_manager holds)
 *
 * The three are independent: attendance_groups.xml gives group_leave_manager
 * and group_wfh_manager implied_ids = [base.group_user] only, so neither
 * implies hr.group_hr_manager and a user can hold any combination.
 *
 * Two more split HR from admin:
 *
 *   admin    -> write on ir.config_parameter (base.group_system only -- the
 *               same "Settings" access Odoo itself calls administrator).
 *               Gates the employee-details setup screens, which HR does not use.
 *   balances -> write on hr.comp.off.credit (hr.group_hr_user 1,1,1,0 and up;
 *               base.group_user is 1,0,0,0), so an HR Officer who holds none of
 *               the manager hats still reaches Comp Off and Leave Balances.
 */
export async function fetchCapabilities() {
  const [attendance, leave, wfh, payroll, admin, balances] = await Promise.all([
    canDo('hr.attendance.late.config', 'write'),
    canDo('hr.leave.config', 'write'),
    canDo('hr.wfh.request', 'unlink'),
    // Payroll resolves to hr.group_hr_manager today, the same as attendance.
    // Kept separate because they are different jobs, and the ACL could be
    // re-cut to hand payroll to somebody who does not set office hours.
    canDo('hr.payslip', 'write'),
    canDo('ir.config_parameter', 'write'),
    canDo('hr.comp.off.credit', 'write'),
  ]);
  return { attendance, leave, wfh, payroll, admin, balances };
}

/** Write changed fields, then hand back the server's own version of the row. */
export async function saveAttendanceConfig(id, values) {
  await callKw('hr.attendance.late.config', 'write', [[Number(id)], values]);
  const rows = await callKw('hr.attendance.late.config', 'read', [
    [Number(id)], ATTENDANCE_CONFIG_FIELDS,
  ]);
  return rows?.[0] || null;
}

/**
 * The office-timezone options, straight off the field definition.
 *
 * The model builds this Selection from pytz.all_timezones, so it is ~600
 * entries -- hardcoding a shortlist here would quietly make zones
 * unreachable from the app that the backend accepts. Asking the server keeps
 * the two in step for free.
 *
 * Memoised for the life of the session: it cannot change under us, and it is
 * the largest single payload this screen fetches.
 */
let timezoneOptionsCache = null;
export async function fetchTimezoneOptions() {
  if (timezoneOptionsCache) return timezoneOptionsCache;
  const fields = await callKw('hr.attendance.late.config', 'fields_get', [
    ['timezone'], ['selection'],
  ]);
  const pairs = fields?.timezone?.selection || [];
  timezoneOptionsCache = pairs.map(([value, label]) => ({ value, label }));
  return timezoneOptionsCache;
}

/** Companies and departments, for the two scope pickers. */
export async function fetchCompanies() {
  const rows = await callKw('res.company', 'search_read', [[], ['id', 'name']], { order: 'name' });
  return (rows || []).map((r) => ({ value: r.id, label: r.name }));
}

/** Every employee, for the report's "selected employees" filter. */
export async function fetchEmployeeOptions() {
  const rows = await callKw('hr.employee', 'search_read', [[], ['id', 'name']], { order: 'name' });
  return (rows || []).map((r) => ({ value: r.id, label: r.name }));
}

export async function fetchDepartments() {
  const rows = await callKw('hr.department', 'search_read', [[], ['id', 'name']], { order: 'name' });
  return (rows || []).map((r) => ({ value: r.id, label: r.name }));
}

/**
 * Re-grade the last three months for this rules row.
 *
 * write() already calls this itself whenever a rule-affecting field changes,
 * so the button matters mainly after switching late tracking back on -- the
 * figures it zeroed do not come back on their own. Answers with an
 * ir.actions.client notification dict, which is of no use to a native app and
 * is dropped.
 */
export async function recomputeAttendanceConfig(id) {
  await callKw('hr.attendance.late.config', 'action_recompute_records', [[Number(id)]]);
}

/**
 * Everything the Config screen needs: every rules row, and whether this user
 * may write them. The pickers are fetched by the form screen instead, so
 * opening the list does not pay for ~600 timezones nobody asked for.
 */
export async function getAttendanceSettings() {
  const [configs, canEdit] = await Promise.all([
    fetchAttendanceConfigs(),
    canEditAttendanceConfig(),
  ]);
  return { configs, canEdit };
}

/* ------------------------------------------------------------------ *
 * Attendance Status -- the admin menu behind the Config tab.
 *
 * Six destinations mirroring menu_late_tracking_root in the addon's
 * menu.xml. Every model below grants hr.group_hr_manager 1,1,1,1 and
 * base.group_user 1,0,0,0, so the tab's existing canManage gate (write
 * access on the late config) already covers the whole hub.
 * ------------------------------------------------------------------ */

const DAY_STATUS_FIELDS = [
  'id', 'employee_id', 'date', 'status', 'status_display',
  'is_wfh', 'leave_request_id', 'stamped_by_cron', 'deduction_amount',
];

/** 1-12 month -> the { from, to } the existing monthBounds() speaks. */
const monthRange = (year, month) => monthBounds(new Date(year, month - 1, 1));

/** Late check-ins across everybody -- the Late Records list. */
export async function fetchLateRecords({ year, month, limit = 200 } = {}) {
  const domain = [['is_late', '=', true]];
  if (year && month) {
    const { from, to } = monthRange(year, month);
    domain.push(['date', '>=', from], ['date', '<=', to]);
  }
  const rows = await callKw('hr.attendance', 'search_read', [
    domain,
    ['id', 'employee_id', 'date', 'check_in', 'check_out',
     'is_late', 'late_minutes', 'late_minutes_display', 'worked_hours'],
  ], { limit, order: 'date desc, check_in desc' });
  return rows || [];
}

/** Graded days for a month -- the Day Status list. */
export async function fetchDayStatuses({ year, month, limit = 300 } = {}) {
  const { from, to } = monthRange(year, month);
  const rows = await callKw('hr.attendance.day.status', 'search_read', [
    [['date', '>=', from], ['date', '<=', to]],
    DAY_STATUS_FIELDS,
  ], { limit, order: 'date desc, employee_id' });
  return rows || [];
}

/** Today's absentees. The backend menu gates this one to managers explicitly. */
export async function fetchAbsentToday() {
  const rows = await callKw('hr.attendance.day.status', 'search_read', [
    [['date', '=', todayKey()], ['status', '=', 'absent']],
    DAY_STATUS_FIELDS,
  ], { order: 'employee_id' });
  return rows || [];
}

/**
 * Everybody's graded day for today -- the HR tab's "who is in" board.
 *
 * A row exists once someone checks in, once approved leave covers the day,
 * or once the cron stamps an absentee after the late window. Readable in full
 * by hr.group_hr_user and up (day_status_rule_hr).
 */
export async function fetchTodayStatuses() {
  const rows = await callKw('hr.attendance.day.status', 'search_read', [
    [['date', '=', todayKey()]],
    DAY_STATUS_FIELDS,
  ], { order: 'employee_id' });
  return rows || [];
}

/**
 * Just the count, for the badge on the hub.
 *
 * search_count rather than reading the rows: this runs on every visit to the
 * Config tab and the number is the only part used.
 */
export async function countAbsentToday() {
  try {
    const n = await callKw('hr.attendance.day.status', 'search_count', [
      [['date', '=', todayKey()], ['status', '=', 'absent']],
    ]);
    return Number(n) || 0;
  } catch (e) {
    // A badge is decoration -- never let it take the menu down with it.
    return 0;
  }
}

const HOLIDAY_FIELDS = ['id', 'name', 'date', 'company_id', 'year', 'day_name', 'affects_working_days'];

export async function fetchPublicHolidays(year) {
  const domain = year ? [['year', '=', Number(year)]] : [];
  const rows = await callKw('hr.public.holiday', 'search_read', [domain, HOLIDAY_FIELDS], {
    order: 'date asc',
  });
  return rows || [];
}

/** Create when id is null, write otherwise. Returns the server's own row. */
export async function savePublicHoliday(id, values) {
  let recordId = id;
  if (recordId) {
    await callKw('hr.public.holiday', 'write', [[Number(recordId)], values]);
  } else {
    recordId = await callKw('hr.public.holiday', 'create', [values]);
  }
  const rows = await callKw('hr.public.holiday', 'read', [[Number(recordId)], HOLIDAY_FIELDS]);
  return rows?.[0] || null;
}

/**
 * Remove a holiday.
 *
 * Not a neutral delete: holidays are excluded from the working-day count that
 * divides the monthly wage, so dropping one LOWERS everybody's daily rate and
 * makes that month's absences cost less. The caller confirms first.
 */
export async function deletePublicHoliday(id) {
  await callKw('hr.public.holiday', 'unlink', [[Number(id)]]);
}

/**
 * Monthly late summary.
 *
 * A transient wizard: create it, run action_generate_summary, then read the
 * lines back. The action's own return is an act_window a native app cannot
 * use, so the lines are read directly.
 *
 * Read with an EMPTY domain deliberately. The lines carry no link back to
 * the wizard that made them -- action_generate_summary starts by unlinking
 * every existing line and then creates a fresh set -- so the whole table IS
 * this run's result. That also means the table is global: two people
 * generating at once overwrite each other. It is the server's design and
 * cannot be fixed from here, but it is why this must not be cached.
 *
 * Ordering comes from the model's own _order (total_late_days desc).
 */
export async function generateLateSummary({ month, year, departmentId = null }) {
  const values = { month: String(month), year: Number(year) };
  if (departmentId) values.department_id = Number(departmentId);
  const wizardId = await callKw('hr.attendance.late.summary.wizard', 'create', [values]);
  await callKw('hr.attendance.late.summary.wizard', 'action_generate_summary', [[wizardId]]);
  const rows = await callKw('hr.attendance.late.summary.line', 'search_read', [
    [],
    ['id', 'employee_name', 'department_name', 'total_late_days',
     'total_late_minutes', 'total_late_time_display'],
  ]);
  return rows || [];
}


/* ------------------------------------------------------------------ *
 * Leave / WFH manager queues, and the configuration behind them.
 *
 * The employee's own requests already live in getLeaveData/getWfhData.
 * These are the MANAGER surfaces: everybody's requests, plus approve
 * and reject. Both models grant base.group_user write on their own
 * rows, which is why the capability probes in fetchCapabilities() use
 * hr.leave.config and unlink instead.
 * ------------------------------------------------------------------ */

const LEAVE_QUEUE_FIELDS = [
  'id', 'hr_employee_id', 'employee_name', 'leave_type',
  'from_date', 'to_date', 'number_of_days', 'is_half_day', 'reason',
  'state', 'is_paid', 'paid_days', 'unpaid_days', 'deduction_amount',
  'approved_by', 'approval_date', 'submitted_on', 'auto_approved',
  'rejection_reason', 'comp_off_balance', 'comp_off_earned_dates',
  'cancel_requested', 'cancel_reason', 'cancel_requested_on', 'cancel_reject_reason',
];

const WFH_QUEUE_FIELDS = [
  'id', 'hr_employee_id', 'employee_name', 'request_date', 'reason',
  'state', 'approved_by', 'approval_date', 'submitted_on',
  'auto_approved', 'rejection_reason',
  'checkin_time', 'checkout_time', 'worked_hours_display',
];

/** Everybody's leave requests. A null state means every state. */
export async function fetchLeaveQueue({ state = null, limit = 200 } = {}) {
  const fields = (await knownFields('hr.leave.request', LEAVE_QUEUE_FIELDS)) || LEAVE_QUEUE_FIELDS;
  let domain = state ? [['state', '=', state]] : [];
  // Not a state: approved leave whose owner asked HR to cancel it.
  if (state === 'cancel_requested') {
    if (!fields.includes('cancel_requested')) return [];
    domain = [['cancel_requested', '=', true]];
  }
  const rows = await callKw('hr.leave.request', 'search_read', [domain, fields], {
    limit,
    order: 'from_date desc, id desc',
  });
  return rows || [];
}

/** Everybody's WFH requests. */
export async function fetchWfhQueue({ state = null, limit = 200 } = {}) {
  const domain = state ? [['state', '=', state]] : [];
  const rows = await callKw('hr.wfh.request', 'search_read', [domain, WFH_QUEUE_FIELDS], {
    limit,
    order: 'request_date desc, id desc',
  });
  return rows || [];
}

/** Badge counts for the hub. A badge must never take the menu down with it. */
async function countPending(model, domain = [['state', '=', 'pending']]) {
  try {
    const n = await callKw(model, 'search_count', [domain]);
    return Number(n) || 0;
  } catch (e) {
    return 0;
  }
}

/** Pending requests plus approved leave HR is asked to cancel -- both wait on HR. */
export async function countPendingLeave() {
  const known = await knownFields('hr.leave.request', ['cancel_requested']).catch(() => null);
  return countPending(
    'hr.leave.request',
    known && known.length
      ? ['|', ['state', '=', 'pending'], ['cancel_requested', '=', true]]
      : [['state', '=', 'pending']]
  );
}
export const countPendingWfh = () => countPending('hr.wfh.request');

/** The two leave queues HR works from, counted apart for the HR tab. */
export async function countLeaveApprovals() {
  const known = await knownFields('hr.leave.request', ['cancel_requested']).catch(() => null);
  const [pending, cancels] = await Promise.all([
    countPending('hr.leave.request'),
    known && known.length
      ? countPending('hr.leave.request', [['cancel_requested', '=', true]])
      : Promise.resolve(0),
  ]);
  return { pending, cancels };
}

/** Approved leave overlapping a month -- the Approved Leaves Report. */
export async function fetchApprovedLeaves({ year, month } = {}) {
  const domain = [['state', '=', 'approved']];
  if (year && month) {
    const { from, to } = monthRange(year, month);
    // A single-day leave is stored with to_date empty, and an empty to_date
    // never satisfies `to_date >= from` -- so every one-day leave vanished
    // from this report. Its end is its start.
    domain.push(
      ['from_date', '<=', to],
      '|', ['to_date', '>=', from],
      '&', ['to_date', '=', false], ['from_date', '>=', from]
    );
  }
  const fields = (await knownFields('hr.leave.request', LEAVE_QUEUE_FIELDS)) || LEAVE_QUEUE_FIELDS;
  const rows = await callKw('hr.leave.request', 'search_read', [domain, fields], {
    order: 'from_date desc',
  });
  return rows || [];
}

/*
 * Approve / reject.
 *
 * Reading goes through search_read above, because the manager record rule is
 * [(1,'=',1)] and search_read returns the FULL row -- the module's own
 * /leave/request/pending returns a reduced payload with no paid/unpaid days
 * and no deduction, and only ever the pending ones.
 *
 * Writing goes through the module's routes instead, because those are the
 * purpose-built API and are correctly guarded: leave_api._is_leave_manager()
 * and wfh_api._is_wfh_manager() run BEFORE the .sudo(), so the group is
 * checked and only then is the record rule bypassed -- which is what lets a
 * manager act on somebody else's row.
 *
 * Those same two checks are why fetchCapabilities() probes what it does:
 *   _is_leave_manager() == group_leave_manager or base.group_system
 *                       == exactly who holds write on hr.leave.config
 *   _is_wfh_manager()   == group_wfh_manager or base.group_system
 *                       == exactly who holds unlink on hr.wfh.request
 * so the row the app shows and the action the server will accept cannot drift
 * apart.
 *
 * The routes also settle the reject ordering. action_reject() does NOT take or
 * set rejection_reason -- the field is readonly on the model and the docstring
 * mentions a wizard that does not exist -- so leave_api rejects FIRST and
 * writes the reason second. Doing it the other way round would leave a reason
 * stranded on a still-pending request whenever the reject is refused.
 *
 * Note the two routes disagree about whether a reason is optional: WFH refuses
 * an empty one outright. The app asks for it in both cases.
 */
export async function approveLeave(id) {
  await moduleCall('/leave/request/approve', { request_id: Number(id) });
}

export async function rejectLeave(id, reason = '') {
  await moduleCall('/leave/request/reject', {
    request_id: Number(id),
    rejection_reason: String(reason || '').trim(),
  });
}

/** HR agrees to cancel an approved leave; its days go back to the balance. */
export async function approveLeaveCancellation(id) {
  await moduleCall('/leave/request/approve_cancel', { request_id: Number(id) });
}

/** HR keeps the leave; the employee sees `reason`. */
export async function rejectLeaveCancellation(id, reason) {
  await moduleCall('/leave/request/reject_cancel', {
    request_id: Number(id),
    reason: String(reason || '').trim(),
  });
}

/** HR cancels an approved leave directly (no request from the employee). */
export async function cancelApprovedLeave(id) {
  await moduleCall('/leave/request/cancel', { request_id: Number(id) });
}

export async function approveWfh(id) {
  await moduleCall('/wfh/request/approve', { request_id: Number(id) });
}

export async function rejectWfh(id, reason = '') {
  await moduleCall('/wfh/request/reject', {
    request_id: Number(id),
    reason: String(reason || '').trim(),
  });
}

/* --- Leave policy (hr.leave.config) --- */

const LEAVE_CONFIG_FIELDS = [
  'id', 'company_id', 'paid_leave_enabled', 'paid_leave_days_per_year',
  'paid_leave_days_per_month', 'unpaid_leave_deduction_enabled',
  'carry_forward_enabled', 'max_carry_forward_days', 'display_name',
  'comp_off_enabled', 'comp_off_expiry_days',
  'comp_off_carry_forward_enabled', 'comp_off_max_carry_forward_days',
  'notify_on_submit', 'notify_emails',
];

/**
 * LEAVE_CONFIG_FIELDS narrowed to what this server's module actually has.
 * The notify_* pair arrived in 19.0.10.1.0; asking an older server for them
 * fails the whole read with "Invalid field", which took the screen down.
 */
async function leaveConfigFields() {
  return (await knownFields('hr.leave.config', LEAVE_CONFIG_FIELDS)) || LEAVE_CONFIG_FIELDS;
}

/**
 * The company's policy row, or -- when none has been saved yet -- the
 * server's own defaults with id null, so the screen can offer them and the
 * first Save creates the row. Without that an admin could not start at all.
 */
/**
 * Whether submitting leave emails HR, and to how many people. Read by the
 * apply sheet so the employee sees the alert before sending it. The addresses
 * themselves are deliberately not handed to the screen: the employee needs to
 * know HR is told, not who is on the list.
 *
 * Safe on a server older than 19.0.10.1.0: the fields do not exist there, and
 * knownFields drops them, which reads as "off".
 */
/**
 * The HR alert email for a request that does not exist yet, built by the
 * server from the same code as the real email. `sample: true` asks for a
 * made-up Casual Leave, for the Leave Policy screen.
 */
export async function previewLeaveMail({ leaveType, fromDate, toDate, isHalfDay, reason, sample = false } = {}) {
  const result = await moduleCall('/leave/preview_mail', sample
    ? { sample: true }
    : {
        leave_type: leaveType || 'casual',
        from_date: fromDate || false,
        ...(!isHalfDay && toDate && toDate !== fromDate ? { to_date: toDate } : {}),
        ...(isHalfDay ? { is_half_day: true } : {}),
        reason: reason || '',
      });
  return {
    enabled: Boolean(result.enabled),
    recipients: Number(result.recipients) || 0,
    subject: result.subject || '',
    rows: (result.rows || []).map((r) => ({ label: r.label, value: r.value })),
    intro: result.intro || '',
    footer: result.footer || '',
  };
}

export async function fetchSubmitNotice() {
  const fields = await knownFields('hr.leave.config', ['notify_on_submit', 'notify_emails']);
  if (!fields || fields.length < 2) return { enabled: false, recipients: 0 };
  const rows = await callKw('hr.leave.config', 'search_read', [[], fields], { limit: 1 });
  const row = rows?.[0];
  if (!row || !row.notify_on_submit) return { enabled: false, recipients: 0 };
  const recipients = String(row.notify_emails || '')
    .split(/[;,]/)
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)).length;
  return { enabled: recipients > 0, recipients };
}

export async function fetchLeaveConfig() {
  const fields = await leaveConfigFields();
  const rows = await callKw('hr.leave.config', 'search_read', [[], fields], { limit: 1 });
  if (rows?.[0]) return rows[0];
  const defaults = await callKw('hr.leave.config', 'get_config_for_company', []);
  const out = { id: null, company_id: false };
  fields.forEach((f) => {
    if (f in (defaults || {}) && f !== 'id') out[f] = defaults[f];
  });
  return out;
}

/** Write when id is set, create otherwise. Unknown fields are dropped. */
export async function saveLeaveConfig(id, values) {
  const fields = await leaveConfigFields();
  const clean = Object.fromEntries(Object.entries(values).filter(([k]) => fields.includes(k)));
  let recordId = id;
  if (recordId) {
    await callKw('hr.leave.config', 'write', [[Number(recordId)], clean]);
  } else {
    recordId = await callKw('hr.leave.config', 'create', [clean]);
  }
  const rows = await callKw('hr.leave.config', 'read', [[Number(recordId)], fields]);
  return rows?.[0] || null;
}

/* --- Auto-approval (hr.request.auto.approve.config) ---
 *
 * ONE record carrying both the leave_* and the wfh_* fields, which is why the
 * hub shows a single row rather than mirroring Odoo's two menu entries.
 *
 * Its ACL grants write to hr.group_hr_manager only, while the two menuitems
 * that reach it in Odoo are gated on the leave/wfh manager groups -- so a
 * Leave Manager can open it there and then fail to save. The hub gates this
 * row on the ACL instead, which is the truth.
 */
const AUTO_APPROVE_FIELDS = [
  'id', 'company_id', 'display_name',
  'leave_auto_approve', 'leave_delay_number', 'leave_delay_unit', 'leave_delay_minutes',
  'wfh_auto_approve', 'wfh_delay_number', 'wfh_delay_unit', 'wfh_delay_minutes',
];

export async function fetchAutoApproveConfig() {
  const rows = await callKw('hr.request.auto.approve.config', 'search_read', [[], AUTO_APPROVE_FIELDS], {
    limit: 1,
  });
  return rows?.[0] || null;
}

/**
 * Write, or create the row if the company has none.
 *
 * A company can legitimately have no auto-approval row: the model's own
 * get_config_for_company() answers with everything switched OFF rather than
 * raising, so "not configured" and "configured to do nothing" mean the same
 * thing. Nothing creates the row on install, so the first time somebody turns
 * a switch on in the app is the moment it has to exist.
 */
export async function saveAutoApproveConfig(id, values) {
  let recordId = id;
  if (recordId) {
    await callKw('hr.request.auto.approve.config', 'write', [[Number(recordId)], values]);
  } else {
    recordId = await callKw('hr.request.auto.approve.config', 'create', [values]);
  }
  const rows = await callKw('hr.request.auto.approve.config', 'read', [[Number(recordId)], AUTO_APPROVE_FIELDS]);
  return rows?.[0] || null;
}


/* ------------------------------------------------------------------ *
 * Employee Details -- the three configuration models behind the
 * "Employee Details" menu. All three are hr.group_hr_manager 1,1,1,1
 * and base.group_user read-only, so they sit under the attendance
 * capability like the rest of Configuration.
 * ------------------------------------------------------------------ */

/**
 * Which sections and fields My Details shows.
 *
 * NOT a singleton. A record with config_scope 'global' holds the company
 * defaults, and each 'employee' record is a SIBLING -- same model, employee_id
 * set, parent_config_id pointing back -- that REPLACES the defaults for that
 * person rather than merging with them. So this is a list, like the attendance
 * rules, not one form.
 */
const DETAILS_CONFIG_FIELDS = [
  'id', 'company_id', 'employee_id', 'config_scope', 'parent_config_id', 'active',
  'show_salary_section', 'show_statutory_section', 'show_bank_section',
  'show_personal_section', 'show_employment_section',
  'show_salary_effective_date', 'show_annual_ctc', 'show_payment_mode',
  'show_tax_regime', 'show_professional_tax_state',
  'show_bank_ifsc', 'show_bank_branch', 'show_bank_account_category',
  'show_blood_group', 'show_father_name', 'show_mother_name',
  'show_emergency_relation', 'show_second_emergency_contact',
  'show_confirmation_date', 'show_notice_period', 'show_previous_employment',
];

export const DETAILS_CONFIG_FIELD_LIST = DETAILS_CONFIG_FIELDS;

export async function fetchDetailsConfigs() {
  const rows = await callKw('hr.employee.details.config', 'search_read', [[], DETAILS_CONFIG_FIELDS], {
    order: 'config_scope, employee_id',
  });
  return rows || [];
}

export async function saveDetailsConfig(id, values) {
  await callKw('hr.employee.details.config', 'write', [[Number(id)], values]);
  const rows = await callKw('hr.employee.details.config', 'read', [[Number(id)], DETAILS_CONFIG_FIELDS]);
  return rows?.[0] || null;
}

/* --- Salary components --- */

const SALARY_COMPONENT_FIELDS = [
  'id', 'name', 'code', 'component_type', 'computation',
  'base_component_id', 'percentage', 'default_amount', 'sequence',
  'company_id', 'active',
];

export async function fetchSalaryComponents() {
  const rows = await callKw('hr.salary.component', 'search_read', [[], SALARY_COMPONENT_FIELDS], {
    order: 'sequence, name',
  });
  return rows || [];
}

export async function saveSalaryComponent(id, values) {
  let recordId = id;
  if (recordId) {
    await callKw('hr.salary.component', 'write', [[Number(recordId)], values]);
  } else {
    recordId = await callKw('hr.salary.component', 'create', [values]);
  }
  const rows = await callKw('hr.salary.component', 'read', [[Number(recordId)], SALARY_COMPONENT_FIELDS]);
  return rows?.[0] || null;
}

export async function deleteSalaryComponent(id) {
  await callKw('hr.salary.component', 'unlink', [[Number(id)]]);
}

/* --- Statutory ID types --- */

const STATUTORY_TYPE_FIELDS = [
  'id', 'name', 'code', 'validation_regex', 'validation_message',
  'is_required', 'is_confidential', 'sequence', 'company_id', 'active',
];

export async function fetchStatutoryIdTypes() {
  const rows = await callKw('hr.statutory.id.type', 'search_read', [[], STATUTORY_TYPE_FIELDS], {
    order: 'sequence, name',
  });
  return rows || [];
}

export async function saveStatutoryIdType(id, values) {
  let recordId = id;
  if (recordId) {
    await callKw('hr.statutory.id.type', 'write', [[Number(recordId)], values]);
  } else {
    recordId = await callKw('hr.statutory.id.type', 'create', [values]);
  }
  const rows = await callKw('hr.statutory.id.type', 'read', [[Number(recordId)], STATUTORY_TYPE_FIELDS]);
  return rows?.[0] || null;
}

export async function deleteStatutoryIdType(id) {
  await callKw('hr.statutory.id.type', 'unlink', [[Number(id)]]);
}


/* ------------------------------------------------------------------ *
 * Payroll and Employee Report -- the last two admin menus.
 *
 * Everything here is hr.group_hr_manager 1,1,1,1 with hr.group_hr_user
 * read-only, and everything here is money. That is the standing rule
 * for this tab: manager-only, so figures are shown; none of it goes
 * near the employee-facing screens.
 *
 * No module HTTP routes exist for payroll or reports -- controllers/
 * holds only help, leave and wfh -- so it is call_kw throughout.
 * ------------------------------------------------------------------ */

const PAYROLL_RUN_FIELDS = [
  'id', 'name', 'month', 'year', 'date_from', 'date_to', 'pay_date',
  'state', 'company_id', 'currency_id',
  // These five are NON-STORED computes. They can be read per record but
  // never searched, sorted or grouped over RPC.
  'employee_count', 'total_gross', 'total_deductions', 'total_net', 'mismatch_count',
];

export async function fetchPayrollRuns() {
  const rows = await callKw('hr.payslip.run', 'search_read', [[], PAYROLL_RUN_FIELDS], {
    order: 'year desc, month desc',
  });
  return rows || [];
}

export async function fetchPayrollRun(id) {
  const rows = await callKw('hr.payslip.run', 'read', [[Number(id)], PAYROLL_RUN_FIELDS]);
  return rows?.[0] || null;
}

/**
 * A new run for a month.
 *
 * Sends only month, year and company. `name` comes from an ir.sequence inside
 * create(), and date_from/date_to are stored computes off month+year --
 * supplying either would be wrong, and the model carries a comment about a
 * real bug where a shared compute got skipped for exactly that reason.
 *
 * month is a STRING ('1'..'12'), not an integer.
 *
 * A UNIQUE(company_id, year, month) SQL constraint means the second run for a
 * month fails at the database. The caller checks first so it can say so
 * properly, but the constraint is the real guard.
 */
export async function createPayrollRun({ month, year, companyId }) {
  const id = await callKw('hr.payslip.run', 'create', [{
    month: String(month),
    year: Number(year),
    company_id: Number(companyId),
  }]);
  return fetchPayrollRun(id);
}

/** Runs still in draft, for the hub badge. `state` is stored, so this is cheap. */
export async function countDraftRuns() {
  try {
    const n = await callKw('hr.payslip.run', 'search_count', [[['state', '=', 'draft']]]);
    return Number(n) || 0;
  } catch (e) {
    return 0;
  }
}

/*
 * The four run actions. Each takes no argument and returns true.
 *
 * Three of them guard their own state and raise a UserError the caller should
 * surface verbatim -- action_confirm's in particular lists every mismatched
 * payslip with both figures, which is the most useful thing on the screen when
 * it happens.
 *
 * action_confirm is the exception, and it is why the UI gates that one itself:
 * it has NO state guard of its own. In the web client only the button's
 * invisible= attribute stops it, so calling it over RPC on a run already
 * marked PAID silently moves that run back to confirmed. The screen therefore
 * offers Confirm only for a draft run that has payslips, rather than trusting
 * the server to refuse.
 */
export async function generatePayrollRun(id) {
  await callKw('hr.payslip.run', 'action_generate', [[Number(id)]]);
}

export async function confirmPayrollRun(id) {
  await callKw('hr.payslip.run', 'action_confirm', [[Number(id)]]);
}

export async function markPayrollRunPaid(id) {
  await callKw('hr.payslip.run', 'action_mark_paid', [[Number(id)]]);
}

export async function reopenPayrollRun(id) {
  await callKw('hr.payslip.run', 'action_reset_to_draft', [[Number(id)]]);
}

const PAYSLIP_FIELDS = [
  'id', 'run_id', 'employee_id', 'employee_name', 'department_name', 'job_title',
  'date_from', 'date_to', 'pay_date', 'state', 'currency_id',
  'working_days', 'present_days', 'half_days', 'absent_days',
  'leave_days_paid', 'leave_days_unpaid', 'comp_off_days', 'lop_days', 'paid_days',
  'gross_earnings', 'total_deductions', 'net_pay', 'net_pay_rounded',
  'net_in_words', 'monthly_wage', 'wage_mismatch',
  'leave_opening', 'leave_taken', 'leave_closing',
];

/** A run's payslips, or every payslip when runId is null. */
export async function fetchPayslips({ runId = null, limit = 300 } = {}) {
  const domain = runId ? [['run_id', '=', Number(runId)]] : [];
  const rows = await callKw('hr.payslip', 'search_read', [domain, PAYSLIP_FIELDS], {
    limit,
    order: 'employee_name',
  });
  return rows || [];
}

/**
 * The earnings and deductions printed on one payslip.
 *
 * These are SNAPSHOTS, not live links: name and code were copied off the
 * salary component when the payslip was generated, precisely so a payslip an
 * employee already holds cannot change when somebody renames a component next
 * year. Never resolve a line back to its component for display.
 */
export async function fetchPayslipLines(payslipId) {
  const rows = await callKw('hr.payslip.line', 'search_read', [
    [['payslip_id', '=', Number(payslipId)]],
    ['id', 'name', 'code', 'category', 'sequence', 'amount'],
  ], { order: 'category desc, sequence, id' });
  return rows || [];
}

/* --- Employee Report --- */

const REPORT_FIELDS = [
  'id', 'name', 'month', 'year', 'date_from', 'date_to', 'company_id', 'currency_id',
  'employee_select', 'employee_ids', 'department_id',
  'grand_leave_deduction', 'grand_total_deduction', 'grand_wage', 'grand_final_amount',
];

export async function fetchEmployeeReports() {
  const rows = await callKw('hr.employee.report', 'search_read', [[], REPORT_FIELDS], {
    order: 'year desc, month desc, id desc',
  });
  return rows || [];
}

export async function fetchEmployeeReport(id) {
  const rows = await callKw('hr.employee.report', 'read', [[Number(id)], REPORT_FIELDS]);
  return rows?.[0] || null;
}

/**
 * Generate a report, and find out which one it made.
 *
 * The wizard is transient: create it, call action_generate_report, and it
 * creates a PERSISTENT hr.employee.report, refreshes it, and hands back an
 * ir.actions.act_window pointing at the result. A native client cannot
 * dispatch that action -- but its res_id is exactly the new report's id, and
 * that is the only handle there is. Everything else in the dict is discarded.
 *
 * Slow: action_refresh recomputes the whole month for every employee in scope.
 */
export async function generateEmployeeReport({
  month, year, companyId, employeeSelect = 'all', employeeIds = [], departmentId = null,
}) {
  const values = {
    month: String(month),
    year: Number(year),
    company_id: Number(companyId),
    employee_select: employeeSelect,
    employee_ids: employeeSelect === 'selected' ? [[6, 0, employeeIds.map(Number)]] : [[5]],
  };
  if (departmentId) values.department_id = Number(departmentId);

  const wizardId = await callKw('hr.employee.report.wizard', 'create', [values]);
  const action = await callKw('hr.employee.report.wizard', 'action_generate_report', [[wizardId]]);
  const reportId = action?.res_id;
  if (!reportId) throw new Error('The report was generated, but the server did not say which one.');
  return fetchEmployeeReport(reportId);
}

/** Recompute an existing report in place. */
export async function refreshEmployeeReport(id) {
  await callKw('hr.employee.report', 'action_refresh', [[Number(id)]]);
  return fetchEmployeeReport(id);
}

export async function fetchReportSummaryLines(reportId) {
  const rows = await callKw('hr.employee.report.summary.line', 'search_read', [
    [['report_id', '=', Number(reportId)]],
    ['id', 'employee_id', 'employee_name', 'department_name',
     'total_working_days', 'total_present_days', 'late_days', 'total_late_days_raw',
     'late_minutes', 'late_minutes_display', 'paid_leave_days', 'unpaid_leave_days',
     'comp_off_days', 'leave_deduction', 'wage', 'total_deduction', 'final_amount'],
  ], { order: 'employee_name' });
  return rows || [];
}

/** One employee's day-by-day lines, or the whole report's. */
export async function fetchReportDetailLines(reportId, employeeId = null) {
  const domain = [['report_id', '=', Number(reportId)]];
  if (employeeId) domain.push(['employee_id', '=', Number(employeeId)]);
  const rows = await callKw('hr.employee.report.detail.line', 'search_read', [domain, []], {
    order: 'id',
  });
  return rows || [];
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

  const [statuses, attendances, config, wfhToday, compOffToday] = await Promise.all([
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
    // Whether today is a weekly off or public holiday, and whether it has
    // been declared. Allowed to fail on its own like WFH: a server without
    // the route simply behaves as an ordinary day, and the server's own
    // check-in gate still has the last word.
    fetchCompOffToday().catch(() => null),
  ]);

  const byDate = {};
  for (const row of attendances) {
    const day = String(row.check_in || '').slice(0, 10);
    if (!byDate[day]) byDate[day] = row;
  }

  const month = { present: 0, late: 0, absent: 0, leave: 0, half_day: 0, day_off: 0 };
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
      dayOff: compOffToday && !compOffToday.isWorkingDay ? compOffToday : null,
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
    isHalfDay: Boolean(r.is_half_day),
    // Which worked days off pay for a comp-off request. The server fills this
    // when the request is submitted; the employee never picks them.
    compOffEarnedDates: r.comp_off_earned_dates || '',
    compOffCredits: (r.comp_off_credits || []).map(toCompOffAllocation),
    // Cancelling APPROVED leave goes through HR on 19.0.10.3.0+: the employee
    // files a request and the leave stays approved until HR decides. An older
    // server sends no cancel_requested key and still lets the owner cancel.
    cancelRequested: Boolean(r.cancel_requested),
    cancelReason: r.cancel_reason || '',
    cancelRejectReason: r.cancel_reject_reason || '',
    canCancel:
      ['draft', 'pending'].includes(r.state) ||
      (r.state === 'approved' && r.cancel_requested === undefined),
    canRequestCancel: r.state === 'approved' && r.cancel_requested === false,
  };
}

/** Ask HR to cancel my approved leave. The leave stays approved until HR decides. */
export async function requestLeaveCancellation(requestId, reason) {
  await moduleCall('/leave/request/request_cancel', {
    request_id: Number(requestId),
    reason: String(reason || '').trim(),
  });
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
    // Newer servers only (19.0.10.3.0+): what the NEXT request would get,
    // counting pending leave and this month's cap the way pricing does.
    // null on an older server, and the screens fall back to `remaining`.
    pendingDays: result.pending_days == null ? null : Number(result.pending_days) || 0,
    remainingThisMonth:
      result.remaining_this_month == null ? null : Number(result.remaining_this_month) || 0,
    isQuotaExhausted: result.is_quota_exhausted == null ? null : Boolean(result.is_quota_exhausted),
  };
}

/**
 * How the server would price my leave over these dates: paid days, and the
 * unpaid (LOP) rest. The same quota code prices the saved request, so the red
 * warning on the apply sheet is exactly what the employee will be charged.
 * Throws on a server without the route; the caller treats that as "no preview".
 */
export async function previewPaidSplit({ fromDate, toDate = null, isHalfDay = false, leaveType }) {
  const r = await moduleCall('/leave/preview_paid', {
    from_date: fromDate,
    ...(!isHalfDay && toDate && toDate !== fromDate ? { to_date: toDate } : {}),
    ...(isHalfDay ? { is_half_day: true } : {}),
    leave_type: leaveType,
  });
  const d = r?.data || {};
  return {
    hasQuota: Boolean(d.has_quota),
    workingDays: Number(d.working_days) || 0,
    paidDays: Number(d.paid_days) || 0,
    unpaidDays: Number(d.unpaid_days) || 0,
    remainingMonth: Number(d.remaining_month) || 0,
    perMonth: Number(d.per_month) || 0,
    limitedBy: d.limited_by || null,
    exhausted: Boolean(d.is_quota_exhausted),
    deductionEnabled: d.deduction_enabled !== false,
  };
}

/**
 * Compensatory-off balance. call_kw for the same reason as the paid-leave one:
 * there is no HTTP route, and the method takes an hr.employee id.
 *
 * Returns {enabled: false, ...} when comp off is switched off in the policy, so
 * `enabled` is checked before anything is shown -- a bare 0 would read as "you
 * have none" rather than "the feature is off here".
 */
const COMP_OFF_FIELDS = [
  'id', 'employee_id', 'date_earned', 'days', 'source', 'state', 'expiry_date',
  'days_used', 'days_left', 'days_lapsed', 'auto_created', 'note', 'company_id',
  'holiday_name', 'hours_worked', 'declared_at', 'declared_by', 'redemption_ids',
];

/**
 * One credit a comp-off leave draws on, as the preview route and my_requests
 * both send it. date_earned is a DATE-ONLY string and stays one.
 */
function toCompOffAllocation(a) {
  return {
    creditId: a.credit_id,
    dateEarned: a.date_earned || '',
    source: a.source || '',
    holidayName: a.holiday_name || '',
    expiryDate: a.expiry_date || '',
    days: Number(a.days) || 0,
  };
}

/**
 * The comp-off ledger, for managers. A null state means every state; an
 * employeeId narrows it to one person (the Leave Balances drill-down).
 *
 * days_used / days_left are computed, not stored, and the model fills credits
 * oldest first -- so a search_read is the only way to get the per-row split;
 * there is no domain on them.
 */
export async function fetchCompOffCredits({ state = null, employeeId = null } = {}) {
  const domain = [];
  if (state) domain.push(['state', '=', state]);
  if (employeeId) domain.push(['employee_id', '=', Number(employeeId)]);
  const fields = (await knownFields('hr.comp.off.credit', COMP_OFF_FIELDS)) || COMP_OFF_FIELDS;
  const rows = await callKw('hr.comp.off.credit', 'search_read', [domain, fields], {
    order: 'date_earned desc, id desc',
  });
  return rows || [];
}

export async function fetchCompOffCredit(id) {
  const fields = (await knownFields('hr.comp.off.credit', COMP_OFF_FIELDS)) || COMP_OFF_FIELDS;
  const rows = await callKw('hr.comp.off.credit', 'read', [[Number(id)], fields]);
  return rows?.[0] || null;
}

/**
 * A manual credit. auto_created is forced off: _sync_for_day deletes an
 * auto-created credit whenever the day stops qualifying, so a hand-added one
 * left as "automatic" would silently vanish on the employee's next check-in.
 */
export async function createCompOffCredit(values) {
  const id = await callKw('hr.comp.off.credit', 'create', [{ ...values, auto_created: false }]);
  return fetchCompOffCredit(id);
}

/** Raises on the server when part of the credit is already spent. */
export async function cancelCompOffCredit(id) {
  await callKw('hr.comp.off.credit', 'action_cancel', [[Number(id)]]);
}

export async function restoreCompOffCredit(id) {
  await callKw('hr.comp.off.credit', 'action_restore', [[Number(id)]]);
}

/** HR closes a declaration by hand when the check-out never came. */
export async function grantCompOffCredit(id) {
  await callKw('hr.comp.off.credit', 'action_grant', [[Number(id)]]);
}

const REDEMPTION_FIELDS = [
  'id', 'credit_id', 'leave_request_id', 'employee_id', 'days', 'request_state',
  'date_earned', 'credit_source', 'leave_from_date', 'leave_to_date',
];

/**
 * Which leave spent a credit, or which credits a leave spent. Lines are kept
 * after a reject or cancel, so `request_state` says whether one still counts.
 */
export async function fetchCompOffRedemptions({ creditId = null, requestId = null } = {}) {
  const domain = [];
  if (creditId) domain.push(['credit_id', '=', Number(creditId)]);
  if (requestId) domain.push(['leave_request_id', '=', Number(requestId)]);
  const fields = await knownFields('hr.comp.off.redemption', REDEMPTION_FIELDS);
  if (!fields) return [];
  const rows = await callKw('hr.comp.off.redemption', 'search_read', [domain, fields], {
    order: 'id',
  });
  return (rows || []).map((r) => ({
    id: r.id,
    creditId: Array.isArray(r.credit_id) ? r.credit_id[0] : r.credit_id,
    requestId: Array.isArray(r.leave_request_id) ? r.leave_request_id[0] : r.leave_request_id,
    requestName: Array.isArray(r.leave_request_id) ? r.leave_request_id[1] : '',
    days: Number(r.days) || 0,
    requestState: r.request_state || '',
    dateEarned: r.date_earned || '',
    source: r.credit_source || '',
    leaveFrom: r.leave_from_date || '',
    leaveTo: r.leave_to_date || '',
    active: ['pending', 'approved'].includes(r.request_state) && Number(r.days) > 0,
  }));
}

const LEAVE_BALANCE_FIELDS = [
  'id', 'name', 'department_id',
  'paid_leave_allowed', 'paid_leave_taken', 'paid_leave_remaining',
  'comp_off_earned', 'comp_off_used', 'comp_off_balance',
];

/**
 * Every employee's paid-leave and comp-off position for a year -- the Odoo
 * "Leave Balances" list. The six figures are computed off the balance_year
 * context, so the year must travel in the context, not the domain.
 */
export async function fetchLeaveBalances(year) {
  const rows = await callKw('hr.employee', 'search_read', [[], LEAVE_BALANCE_FIELDS], {
    context: { balance_year: Number(year) },
    order: 'name',
  });
  return rows || [];
}

export async function fetchCompOffBalance(employeeId) {
  const result = await callKw('hr.comp.off.credit', 'get_comp_off_balance', [employeeId]);
  if (!result || result.enabled !== true) return { enabled: false };
  return {
    enabled: true,
    earned: Number(result.earned) || 0,
    used: Number(result.used) || 0,
    balance: Number(result.balance) || 0,
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
export async function createLeaveRequest({ leaveType, fromDate, toDate, reason, isHalfDay = false }) {
  const result = await moduleCall('/leave/request/create', {
    leave_type: leaveType || 'casual',
    from_date: fromDate,
    // A single day sends no to_date at all, matching the field's own "leave
    // empty for single day leave" and keeping number_of_days on its 1-day path.
    // A half day is one date by definition, so it never sends one either.
    ...(!isHalfDay && toDate && toDate !== fromDate ? { to_date: toDate } : {}),
    ...(isHalfDay ? { is_half_day: true } : {}),
    reason,
  });
  // Not rowsOf(): `data` is an object {id, state} here, not an array.
  return { id: result?.data?.id, state: result?.data?.state || 'pending' };
}

/* ------------------------------------------------------------------ *
 * Compensatory off, employee side
 *
 * All four are this module's own /comp_off/* routes. None takes an employee
 * or user id: the server acts on the signed-in person only, so there is
 * nothing to spoof and nothing to pass.
 * ------------------------------------------------------------------ */

function toCompOffCredit(c) {
  if (!c) return null;
  return {
    id: c.id,
    dateEarned: c.date_earned || '',
    days: Number(c.days) || 0,
    source: c.source || '',
    holidayName: c.holiday_name || '',
    state: c.state,
    expiryDate: c.expiry_date || '',
    daysUsed: Number(c.days_used) || 0,
    daysLeft: Number(c.days_left) || 0,
    hoursWorked: Number(c.hours_worked) || 0,
    redemptions: (c.redemptions || []).map((r) => ({
      requestId: r.leave_request_id,
      days: Number(r.days) || 0,
      requestState: r.request_state,
      from: r.from_date || '',
      to: r.to_date || '',
    })),
  };
}

/**
 * Today's day-off state, which decides what Home draws: an ordinary day, a
 * weekly off or public holiday still waiting for "I am working today", or a
 * declared one where Check In is open.
 */
function toCompOffToday(r) {
  return {
    date: r.date,
    isWorkingDay: Boolean(r.is_working_day),
    kind: r.kind || 'working',               // 'working' | 'weekly_off' | 'public_holiday'
    holidayName: r.holiday_name || '',
    compOffEnabled: Boolean(r.comp_off_enabled),
    gateEnabled: Boolean(r.gate_enabled),
    checkInAllowed: r.check_in_allowed !== false,
    blockedMessage: r.blocked_message || '',
    canDeclare: Boolean(r.can_declare),
    canWithdraw: Boolean(r.can_withdraw),
    declaration: r.declaration ? toCompOffCredit(r.declaration) : null,
    fullDayHours: Number(r.full_day_hours) || 0,
  };
}

export async function fetchCompOffToday() {
  return toCompOffToday(await moduleCall('/comp_off/today_status', {}));
}

/** "I am working today". Idempotent on the server; returns the new today state. */
export async function declareWorkingToday(note = '') {
  const result = await moduleCall('/comp_off/declare', note ? { note } : {});
  return toCompOffToday(result.today || {});
}

/** "Not working after all" -- refused by the server once checked in. */
export async function withdrawWorkingToday() {
  const result = await moduleCall('/comp_off/withdraw', {});
  return toCompOffToday(result.today || {});
}

/**
 * What a comp-off leave over these dates would draw on. The same day count
 * and the same allocation the server makes on submit, so the apply sheet can
 * show "earned on" before anything is sent.
 */
export async function previewCompOffRedemption({ fromDate, toDate = null, isHalfDay = false }) {
  const result = await moduleCall('/comp_off/preview', {
    from_date: fromDate,
    ...(!isHalfDay && toDate && toDate !== fromDate ? { to_date: toDate } : {}),
    ...(isHalfDay ? { is_half_day: true } : {}),
  });
  return {
    enabled: Boolean(result.enabled),
    days: Number(result.number_of_days) || 0,
    balance: Number(result.balance) || 0,
    covered: Number(result.covered) || 0,
    shortfall: Number(result.shortfall) || 0,
    allocation: (result.allocation || []).map(toCompOffAllocation),
  };
}

/** My own credits, newest first, each with the leave that spent it. */
export async function fetchMyCompOffCredits({ state = null } = {}) {
  const result = await moduleCall('/comp_off/my_credits', state ? { state } : {});
  return (result.data || []).map(toCompOffCredit);
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
  // The comp-off balance rides in the same Promise.all and swallows its own
  // failure for the same reason the paid-leave one does: neither card is worth
  // taking the request list down for.
  const [requests, balance, compOff] = await Promise.all([
    fetchLeaveRequests({ stateFilter }),
    fetchLeaveBalance(employeeId, year).catch(() => null),
    fetchCompOffBalance(employeeId).catch(() => null),
  ]);
  return { employeeId, year, balance, compOff, requests };
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

  const totals = { present: 0, late: 0, absent: 0, leave: 0, half_day: 0, day_off: 0 };
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

/* ------------------------------------------------------------------ *
 * App Manual -- the Mobile app shelf of attendance.help.document.
 *
 * The same model holds the module's own guides (section 'manual', the
 * backend Help popup) and the PDFs this app lists (section 'app'). The
 * server filters by role in app_bundle()/get_manual(): admins see every
 * manual, HR and employees their own plus the Everyone ones, so nothing
 * here decides who may read what. Only admins may write.
 * ------------------------------------------------------------------ */

const MANUAL_MODEL = 'attendance.help.document';

/**
 * The screen's one load: this person's manuals, their role, and whether they
 * may upload. A server whose module predates app manuals has no app_bundle,
 * so that comes back as `available: false` rather than an error -- "no
 * manuals yet" is the honest answer to someone who came looking for one.
 */
export async function fetchManualBundle() {
  try {
    const res = await callKw(MANUAL_MODEL, 'app_bundle', []);
    return {
      available: true,
      canEdit: Boolean(res?.can_edit),
      role: res?.role || 'employee',
      manuals: Array.isArray(res?.manuals) ? res.manuals : [],
    };
  } catch (e) {
    return { available: false, canEdit: false, role: 'employee', manuals: [] };
  }
}

/** One manual's PDF as base64 ({ id, name, filename, data }), or null. */
export async function fetchManual(id) {
  const res = await callKw(MANUAL_MODEL, 'get_manual', [Number(id)]);
  return res || null;
}

/**
 * Admin: add (no id) or update (id) an app manual. `base64` is optional on an
 * edit -- leave it out to keep the current PDF and change only the title,
 * audience or order. Always on the app shelf: this screen never touches the
 * module's own guides.
 */
export async function saveManual(id, { name, description, audience, sequence, filename, base64 }) {
  const vals = { section: 'app' };
  if (name != null) vals.name = name;
  if (description != null) vals.description = description;
  if (audience != null) vals.audience = audience;
  if (sequence != null) vals.sequence = Number(sequence);
  if (base64) {
    vals.pdf_file = base64;
    vals.pdf_filename = filename || `${name || 'manual'}.pdf`;
  }
  if (id) {
    await callKw(MANUAL_MODEL, 'write', [[Number(id)], vals]);
    return Number(id);
  }
  vals.icon = '📱';
  return callKw(MANUAL_MODEL, 'create', [vals]);
}

/** Admin: remove an app manual. */
export async function deleteManual(id) {
  await callKw(MANUAL_MODEL, 'unlink', [[Number(id)]]);
}

/* ------------------------------------------------------------------ *
 * Notifications -- the bell feed, phone registration, and the admin's
 * per-event switches. All of it lives in hr.attendance.notification and its
 * two siblings on the server; a server whose module predates notifications
 * answers "no feed" rather than an error, so the bell simply stays empty.
 * ------------------------------------------------------------------ */

const NOTIFY_MODEL = 'hr.attendance.notification';

/** This user's notifications, newest first. */
export async function fetchNotifications(limit = 50, offset = 0) {
  try {
    return (await callKw(NOTIFY_MODEL, 'app_feed', [], { limit, offset })) || [];
  } catch (e) {
    return [];
  }
}

/** Unread count for the bell badge. 0 when the server has no feed. */
export async function countUnreadNotifications() {
  try {
    return Number(await callKw(NOTIFY_MODEL, 'unread_count', [])) || 0;
  } catch (e) {
    return 0;
  }
}

export async function markNotificationsRead(ids) {
  if (!ids?.length) return;
  await callKw(NOTIFY_MODEL, 'mark_read', [ids.map(Number)]);
}

export async function markAllNotificationsRead() {
  await callKw(NOTIFY_MODEL, 'mark_all_read', []);
}

/** A test to this user's own bell and phones. */
export async function sendTestNotification() {
  await callKw(NOTIFY_MODEL, 'action_send_test', []);
}

/** Remember this phone's Expo push token for the signed-in user. */
export async function registerPushDevice(token, platform, device, projectId) {
  return callKw('hr.attendance.push.device', 'register_device', [token], {
    platform,
    device: device || null,
    project_id: projectId || null,
  });
}

/** Forget this phone (sign-out), while the session is still valid. */
export async function unregisterPushDevice(token) {
  return callKw('hr.attendance.push.device', 'unregister_device', [token]);
}

/** Admin: every notification type with its two switches. */
export async function fetchNotifyEvents() {
  return (await callKw('hr.attendance.notify.event', 'app_list', [])) || [];
}

/** Admin: flip one type's switches ({ enabled?, push? }). */
export async function saveNotifyEvent(id, values) {
  await callKw('hr.attendance.notify.event', 'write', [[Number(id)], values]);
}

/** The employee explains their own late check-in. */
export async function submitLateReason(attendanceId, reason) {
  return callKw('hr.attendance', 'app_submit_late_reason', [Number(attendanceId), reason]);
}

/* ------------------------------------------------------------------ *
 * Profile extras -- the work, month, balance, attendance-setup and
 * role sections of the Profile tab.
 *
 * Kept apart from getMyDetails on purpose. An employee reading their own
 * res.users gets a superuser read ONLY if every requested field is on the
 * self-service allow-list; one field off it and the whole read fails. So the
 * work fields below are all allow-listed ones, in their own read, and
 * department / manager / coach come from hr.employee.public, which every
 * user may read. Each part settles on its own, so one refusal hides one
 * section, never the page. Nothing salary-bearing is requested.
 * ------------------------------------------------------------------ */

const PROFILE_USER_FIELDS = [
  'job_title', 'work_email', 'work_phone', 'mobile_phone', 'barcode',
  'work_location_id', 'employee_resource_calendar_id', 'company_id',
];
const m2oName = (v) => (Array.isArray(v) ? v[1] : '');
const text = (v) => (v === false || v === null || v === undefined ? '' : String(v));

export async function getProfileExtras({ uid, caps = {} }) {
  const settled = (p) => p.then((value) => value, () => null);

  const [userRow, publicRow, home, empId] = await Promise.all([
    settled(callKw('res.users', 'read', [[uid], PROFILE_USER_FIELDS]).then((r) => r?.[0] || null)),
    settled(
      callKw('hr.employee.public', 'search_read', [
        [['user_id', '=', uid]], ['department_id', 'parent_id', 'coach_id', 'job_id'],
      ], { limit: 1 }).then((r) => r?.[0] || null)
    ),
    settled(getHomeData(uid)),
    settled(getMyEmployeeId(uid)),
  ]);

  const manages = caps.leave || caps.wfh || caps.attendance;
  const [leave, compOff, device, approvals, wfhPending, absentToday] = await Promise.all([
    empId ? settled(fetchLeaveBalance(empId)) : null,
    empId ? settled(fetchCompOffBalance(empId)) : null,
    empId
      ? settled(
          callKw('employee.device', 'search_read', [
            [['employee_id', '=', empId]],
            ['device_id', 'device_name', 'device_type', 'active', 'last_used'],
          ], { limit: 1, order: 'last_used desc' }).then((r) => r?.[0] || null)
        )
      : null,
    manages && caps.leave ? settled(countLeaveApprovals()) : null,
    manages && caps.wfh ? settled(countPendingWfh()) : null,
    manages && caps.attendance ? settled(countAbsentToday()) : null,
  ]);

  const cfg = home?.config || null;
  const days = cfg
    ? ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        .filter((d) => cfg[`work_${d}`])
        .map((d) => d[0].toUpperCase() + d.slice(1, 3))
    : [];

  return {
    work: {
      employeeId: text(userRow?.barcode),
      jobTitle: text(userRow?.job_title) || m2oName(publicRow?.job_id),
      department: m2oName(publicRow?.department_id),
      manager: m2oName(publicRow?.parent_id),
      coach: m2oName(publicRow?.coach_id),
      workEmail: text(userRow?.work_email),
      workPhone: text(userRow?.work_phone),
      mobile: text(userRow?.mobile_phone),
      workLocation: m2oName(userRow?.work_location_id),
      workingHours: m2oName(userRow?.employee_resource_calendar_id),
      company: m2oName(userRow?.company_id),
    },
    month: home?.month || null,
    leave,
    compOff,
    setup: cfg
      ? {
          startHour: cfg.office_start_hour,
          endHour: cfg.office_end_hour,
          graceMinutes: Number(cfg.late_threshold_minutes) || 0,
          workingDays: days,
        }
      : null,
    device: device
      ? {
          name: text(device.device_name) || text(device.device_id),
          type: text(device.device_type),
          active: Boolean(device.active),
          lastUsed: text(device.last_used),
        }
      : null,
    // Undefined (not 0) when the user does not handle that queue, so the
    // screen shows only the rows that are theirs.
    queue: manages
      ? {
          leave: approvals ? approvals.pending : undefined,
          cancels: approvals ? approvals.cancels : undefined,
          wfh: typeof wfhPending === 'number' ? wfhPending : undefined,
          absent: typeof absentToday === 'number' ? absentToday : undefined,
        }
      : null,
  };
}
