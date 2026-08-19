# 369 Attendance — session notes

_Last updated: 21 August 2026_

Two things live in this folder:

| | Path | State |
|---|---|---|
| **Odoo 19 addon** | `odoo_modules/hr_attendance_369` | installed on **`sales_test` only**, v**19.0.8.2.0** |
| **Expo / React Native app** | repo root (`App.js`, `src/`) | Expo SDK **54**, talks to real Odoo |

> The addon is **not** installed on `369application`, `369test`, `SPA`, `grocery_shop` or `tool_managament`. Every upgrade this session went to `sales_test`.

---

## 1. Odoo addon — what was added

### Employee Details (configurable, per-company or per-person)
Every field ships but stays **off until an admin ticks it on**, because this company runs no PF, ESI or HRA.

- **Field Settings** (`Attendances ▸ Employee Details ▸ Field Settings`) — one list, grouped into **Everyone** and **Per employee**. A person's record **replaces** the defaults for them; it is not merged. No record → they follow Everyone.
- **Salary Components** and **Statutory ID Types** — admin-defined master lists, shipped inactive. Statutory types carry an editable validation regex, so tightening Aadhaar needs no code change.
- **Self-service** — employees maintain their own statutory IDs, qualifications, previous employment, blood group, emergency contacts from *My Profile*. Salary is invisible to them by four independent locks.

### Payroll
- **Payroll Runs** → pick a month, Generate, one payslip per employee, `draft → confirmed → paid`, PDF per payslip.
- Loss of Pay comes **automatically from attendance**; earnings show in full with a single LOP deduction line.
- Net rounded to the rupee, plus **net in words** (Indian lakh/crore) and a leave summary.
- Confirming is **blocked** when component earnings disagree with `monthly_wage`, naming the employees — paying one figure while deducting against another is the worst outcome.

### Security fixes (v19.0.8.1.0)
Two live data leaks, **verified by exploiting them as a plain employee, then verified closed**:

| As an ordinary employee | Before | After |
|---|---|---|
| Colleagues' day status + `deduction_amount` | 20+ rows | `[]` |
| Colleagues' `wage`, `total_deduction`, `final_amount` | every employee | own row only |
| Own data | worked | still works |

Eight `ir.rule` records added, plus `employee.device` — which granted `base.group_user` **write** with no rule, so an employee could have repointed a colleague's device row at their own handset.

### Security fixes (v19.0.8.2.0)
Two more live leaks in the leave API, again **verified by exploiting them as a plain employee (`demo`,
uid 5, `base.group_user` only), then verified closed**:

| As an ordinary employee | Before | After |
|---|---|---|
| `my_requests` with `user_id=2` — a colleague's last 50 requests incl. `reason` | full payload | `You can only act on your own leave requests.` |
| `create` with `user_id=2` — file leave **as** another employee | row created, `create_uid=5` | refused |
| Own create / list / filter / cancel | worked | still works |

The fix is `_resolve_user_id()` plus **dropping `sudo()`** from the create and the list, so the existing
`leave_request_rule_employee` becomes the boundary — a boundary nobody can forget to re-apply in a later
route. Nothing in the ACL or rules XML changed; they were already correct. The `hr.employee` lookup keeps
its `sudo()` (no `base.group_user` ACL row exists for that model in 19).

Proof the rule alone suffices: the same helper called via `call_kw` — no controller, no sudo — returns `[]`
for a colleague both before and after.

A manager passing `user_id` still works, gated on `group_leave_manager`; verified by granting group 85,
confirming access opens, then revoking and confirming it closes. **Note the group cache is per-process —
a group change needs an Odoo restart before HTTP reflects it.**

---

## 2. Mobile app — what was done

- **Expo SDK 57 → 54** (RN 0.86 → 0.81, React 19.2 → 19.1). `expo-doctor` 18/18.
- **Real Odoo connection** — `src/services/odoo.js` replaced the mock: database list, login with session cookie, and now attendance.
- **Re-skin** to slate + amber with sharp corners (radii 4/8/12), deliberately unlike the blue-and-round house style. Always opens **light**.
- **Phase 1 complete** — Home's check-in/out, month tiles and recent activity are live data.
- **Phase 2 complete** — Leave. A pushed `Leave` route: paid-balance card, request list with state chips,
  server-side state filter, cancel with a state-aware confirm, and an apply sheet with a hand-rolled
  month-grid range calendar (`src/components/DateRangeCalendar.js` — no new dependency, SDK 54 untouched).
- `npm run verify` now runs the three-part bundle check (`tools/verify-bundle.js`). See §5.

---

## 3. Hard-won API facts

Everything here was found by calling the live server, not by reading code. Several contradict what the source suggests.

### Check in / check out
```
POST /hr_attendance/systray_check_in_out     type=jsonrpc, auth=user
```
It **toggles**, takes the employee from the session, and routes through this module's `_attendance_action_change` override that injects `skip_late_reason_required` — so a late check-in is never blocked.

Things that do **not** work:
- `hr.employee.attendance_manual` — does not exist in Odoo 19.
- `_attendance_action_change` — private, `call_kw` refuses it.
- Creating `hr.attendance` directly — `AccessError`; the stock rule gives employees read-only on their own records (`perm_create=0`).
- `hr.attendance.late.config.get_config_for_employee()` — `AccessError`. Touching `hr.employee` pulls `version_id`, HR-officer-only in 19 via the `hr.version` delegation. **Read the config model directly instead.**
- `check_in_office_time` / `check_out_office_time` — denied for the same reason. All 14 attendance fields were tested individually; only these two fail.

**After checking out, the module forbids checking in again the same day.** The button must go inert, not offer check-in.

### Odoo datetimes are naive UTC
`'2026-08-21 12:07:31'` — no zone marker. `new Date()` reads it as **local**, so on a +05:30 phone every time renders 5½ hours early. Converted at the service boundary by `odooUtcToIso()` in `src/utils/time.js`.

Worse, **the timezone varies per endpoint** with nothing in the payload to tell them apart:
- **user-local**: `/wfh/today_status`, `/wfh/checkin`, `/wfh/checkout`, `/wfh/request/list`
- **UTC**: `my_requests`, `pending`, `today_dashboard`

### Session capture — why a correct URL can 404 after login
**Odoo 19's `/web/session/authenticate` does not return `session_id`.** The key is absent from the payload;
only the `Set-Cookie` header carries it. And `set-cookie` is a *forbidden response header*, so neither
React Native's fetch nor Node's exposes it to JS — verified both ways.

So the app captures no session id of its own and depends entirely on the platform's native cookie jar. When
that jar does not carry the cookie, the request arrives unauthenticated, this server hosts **7 databases**,
and Odoo cannot infer which one is meant. It answers with an HTML **`404 No database is selected`** — which
the app used to report as *"That address answered, but it is not an Odoo server."* That is the app blaming
a perfectly correct URL for a session problem, and it sends people off re-typing an address that was right.

Fixed by sending **`X-Odoo-Database`** on every call (Odoo suggests this on that very 404 page). Same request,
no session:

| | Without the header | With it |
|---|---|---|
| HTTP | 404 + HTML | 200 + JSON-RPC |
| App shows | "not an Odoo server" | `Your session has expired. Please sign in again.` |

`rpc()` also now recognises `SessionExpiredException` by `error.data.name` and clears the stored id, and
`__DEV__` logging prints `cookie: sent | NONE` per request plus the whole non-JSON body — which is what makes
this diagnosable at all. **A 404 from an `auth='user'` route means no session, never a bad address.**

### Module REST envelope quirks
- the flag is **`status`**, not `success`; errors carry `message`, no code
- list key differs: leave → **`data`**, WFH → **`requests`**, dashboard → **`wfh_employees`**
- filter differs: leave → **`state_filter`**, WFH → **`state`**
- **HTTP 200 even on failure** — `response.ok` proves nothing

### Leave (verified against the live server, Phase 2)
Routes are **`/leave/request/my_requests`** and **`/leave/request/cancel`** — earlier notes here said
`/my_requests` and `/cancel`, which do not exist.

- States are `draft` / `pending` / `approved` / `rejected` / **`cancelled`** (British spelling). Not Odoo's
  stock `confirm`/`validate`/`refuse`.
- Leave types are a **Selection field, not a model**: `sick`, `casual`, `annual`, `personal`, `emergency`,
  `other`. Payloads carry `leave_type_label` already.
- `create` runs create + `action_submit()` in one call, so a request lands in `pending`, never `draft`.
- `my_requests` is capped at **50 rows**, `from_date desc`, with no `count` key — so filtering must be
  server-side via `state_filter`, or older rows silently vanish.
- **`to_date` comes back as `""`, never null**, for a single-day leave. `number_of_days` is a Float.
- Cancel is allowed from `draft`, `pending` **and `approved`**. It returns no state key — re-read the list.
- **No quota check on create.** Exceeding the balance never blocks, so the app is the only place that can
  warn. No half-day and no attachments over HTTP.
- Balance is `call_kw` on `hr.leave.config.get_employee_leave_balance(employee_id, year)` — an **hr.employee**
  id, not a res.users id. Returns exactly `{has_quota: false}` when off; every other key is absent.
  It needs **no** `sudo()`: a single dot-read of `company_id` does not expand to hr.employee's private
  prefetch group (reading the *full* record does raise `AccessError` — that is the distinction).

Exact error strings the app maps back onto fields:
`From date is required` · `Reason is required` · `To Date cannot be before From Date.` ·
`A leave request already exists for overlapping dates. Existing request: {display_name}`

### Not reachable by employees
**Payslips.** No `base.group_user` ACL row, no record rule, no route — a hard `AccessError`. Showing them in the app needs an ACL row, an `[('employee_id.user_id','=',user.id)]` rule and a route.

---

## 4. Running things

**Phone must use the LAN address**, not `localhost`:
```
10.90.130.175:8069
```
Odoo listens there; the app adds `http://` automatically for private ranges.

**Upgrade the addon**
```
"C:\Program Files\Odoo 19.0.20260119\python\python.exe" ^
  "C:\Program Files\Odoo 19.0.20260119\server\odoo-bin" ^
  -u hr_attendance_369 -d sales_test ^
  --db_host localhost --db_user openpg --db_password openpgpwd ^
  --stop-after-init --no-http
```
The addon is loaded from `C:\Program Files\Odoo 19.0.20260119\server\odoo\addons\hr_attendance_369`, so **copy this folder there before upgrading** — Odoo's own addons dir wins over `--addons-path`.

A `metro.config.js` change needs a **full Metro restart**, not a reload:
```
npx expo start -c
```

---

## 5. Verification that actually catches things

**Bundling is not running.** `expo export` compiles modules but never evaluates them, so a module-scope `ReferenceError` passes the build and dies at launch. That happened twice — `fontSize` and `radii` used inside a module-level `StyleSheet.create`, where only hook-destructured values were in scope.

Use all three — **`npm run verify`** does 1 and 2 (`tools/verify-bundle.js`):
1. Babel-parse every file
2. **Execute** every module with stubbed native deps (catches the above)
3. `expo export` capturing the **real** exit code — not a piped command's:
   `npx expo export --platform android --output-dir dist > export.log 2>&1; echo "EXIT:$?"`

Step 2 only works because the `react-native` stub gives `StyleSheet.create` a **real** identity function —
a stub that swallowed its argument would never evaluate the object literal, and would catch nothing.
This was proved by planting the exact bug as a canary: it passed step 1 and died in step 2 with
`ReferenceError: fontSize is not defined`.

For Odoo work: `curl` each endpoint **before** wiring a screen. That is what caught all four blockers above.

---

## 6. State right now

- `sales_test` — addon v**19.0.8.2.0**, 21 employees, one draft payroll run `PAY/2026/0008`, no payslips generated
- Field Settings — company record in **Per employee** mode with every section off, so nobody sees extra fields yet
- Salary components active: **Basic**, **Special Allowance**
- App — bundles clean, **35 modules evaluate**, `expo export` exits 0. Home and Leave on live data.
- `hr_leave_request` and `hr_leave_config` are **empty** — all Phase 2 test data was removed afterwards.
  With no config row the balance returns `{has_quota: false}` for everyone, so the balance card shows its
  "no paid-leave quota is configured" state. Both branches were proven by creating a policy row and deleting it.
- **`demo`'s password is now `demo369`** (set for the security testing; the original hash is not recoverable).

**Backups**: `_db_backup/sales_test_before_8.2.0.dump` (taken before this session's addon change), `_db_backup/sales_test_before_7.3.0.dump`, and `_db_backup/js_backup/` holds pre-change copies of `package.json`, the theme files, `security_rules.xml` and the whole `src/` tree before the polish pass.

---

## 7. Next

**Phase 2 — Leave. Done.** See §1 and §3. Not yet exercised on a physical device: the Leave screen's
appearance, the dark-mode pass, and Android hardware back (Home's `hardwareBackPress` handler was rescoped
to `useFocusEffect` — unconditional it wins the race on *every* screen pushed above Home and leaves back
dead there).

**Phase 3 — Work From Home.** `/wfh/request/*` plus `/wfh/today_status`. Mirror the real state machine; `checked_out` is **not** terminal.

**Phase 4 — Attendance history**, and repoint the fourth Quick Action tile from *Reports* to **My Details** — Reports reads the salary-bearing report models, My Details is the surface employees actually own.

Also open, worth deciding separately:
- `monthly_wage` duplicates Odoo 19's stock `wage` (`hr.version`); both now show on the Payroll page
- The Monthly Report has two defects payslips deliberately avoid — leave is selected by **start date only**, so a leave crossing a month boundary is charged to the wrong month, and `present_days + paid_leave_days` can count one day twice
- `/leave/request/report` and `/wfh/request/list` still have **no group check and run `sudo()`** — any
  authenticated user gets company-wide data. Deliberately deferred to Phase 3 (which touches WFH anyway);
  both were re-probed as `demo` after the v8.2.0 fix and confirmed **still open, by decision, not regression**.
  `/report` needs care: adding a group check could break existing backend callers.
