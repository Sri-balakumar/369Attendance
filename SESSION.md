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

### Monthly Report: two payroll defects (v19.0.8.6.0)

**Leave was selected by start date only.** The query filtered `from_date` inside the month, so a leave
crossing a boundary was charged entirely to the month it began in and vanished from the next one. Now selects
leaves that **overlap** the month (allowing for `to_date` being empty, which means a single day), and counts
only the days that fall inside it.

Apportionment follows the quota's own semantics: paid days are consumed **chronologically**, so the leave is
walked in order and the first `paid_days` are the paid ones. Splitting proportionally would divide a
part-paid leave wrongly across a boundary. The deduction is apportioned by unpaid days, which is exact
because the deduction *is* unpaid days x daily rate.

Proven on a 30 Aug -> 3 Sep leave (5 days, 1 paid / 4 unpaid):

| Month | paid | unpaid | days |
|---|---|---|---|
| August (30–31) | 1.0 | 1.0 | 2 |
| September (1–3) | 0.0 | 3.0 | 3 |
| **total** | **1.0** | **4.0** | **5** |

**`present_days + paid_leave_days` double-counted.** A day that was both a present day and a paid-leave day
earned twice. The overlap is now netted off `earned_days`, while both totals keep their own true values
because both are reported in their own right. Proven with wage 27000 (daily 1080):

| Attendance | final |
|---|---|
| **on** the paid-leave day | **1080** — netted |
| on a different day | **2160** — both correctly earned |

### WFH: stray rows on a rejected create (v19.0.8.5.0)
Identical to the leave bug, and worse. `/wfh/request/create` caught the duplicate-date constraint and
returned `status: False` without rolling back, so the row was still committed. Leave's ghost landed in
`draft`; this route sets `state` directly to **`pending`**, so the phantom went straight into a manager's
approval queue for a request the employee had just been told was refused. Fixed with `cr.rollback()`;
demonstrated before and after.

### The sudo() leak class, closed (v19.0.8.4.0)
The last two ungated `sudo()` routes were gated. **Demonstrated open first**, as `demo` (a plain
`base.group_user`): `/wfh/request/list` returned Mitchell Admin's WFH row — `reason`, `rejection_reason`,
check-in times, 13 fields — to an employee with no manager rights at all. `/leave/request/report` did the
same for leave. Both now answer `Only ... managers/admins can ...`; both still work for a manager (proven by
granting `group_wfh_manager` + `group_leave_manager`, confirming access, revoking, confirming refusal).

SESSION.md previously warned that gating `/report` "could break existing backend callers". **It has none** —
grepped across the addon's `.py`/`.js`/`.xml`/`.html` and the whole app. Neither route was called by anything.

A scan of both controllers now reports **zero ungated sudo routes**. Note `/leave/request/create` keeps one
deliberate `sudo()` — the `hr.employee` lookup, which has no `base.group_user` ACL in Odoo 19 — while the
`hr.leave.request` create itself is non-sudo so the record rule stays the boundary.

### Stray drafts on a rejected create (v19.0.8.3.0)
A create that FAILED still committed a row. `create()` and `action_submit()` share one `try`, the overlap
constraint fires on flush, and the controller caught it and returned `status: False` **without rolling back** —
so Odoo committed the row when the HTTP response succeeded. The ghost landed in `draft`, and because the
overlap check counts drafts, it then **blocked the very dates the person had just been refused**. Fixed with
`request.env.cr.rollback()` in the create handler; verified by re-running the overlap and confirming nothing
survives.

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

### Sessions, and why a correct URL can 404 after login

**Odoo 19's `/web/session/authenticate` does not return `session_id`.** The key is absent from the payload;
only the `Set-Cookie` header carries it. And `set-cookie` is a *forbidden response header*, so neither React
Native's fetch nor Node's exposes it to JS — verified both ways.

So the app never holds a session id. **React Native's native cookie jar is what makes the app work at all**,
attaching `session_id` automatically under `credentials: 'include'`, invisibly to JS. The transport log line
`cookie: none from app` therefore does NOT mean no cookie was sent.

Odoo resolves the database in `http.py:1779-1795`, in this order:

1. the session's own `db`, if it still passes `db_filter`
2. else the `X-Odoo-Database` header
3. else, **only if exactly one database exists**, that one

This server has **7 databases**, so step 3 never fires. A session whose `db` is stale or filtered out reaches
none of the three and Odoo answers with an HTML **`404 No database is selected`** — which the app used to
report as *"That address answered, but it is not an Odoo server."* That is the app blaming a correct URL for
a stale-session problem. `rpc()` now recognises that page by its wording and says so plainly.

> **Do not "fix" this with the `X-Odoo-Database` header.** It looks right, and Odoo suggests it on that very
> 404 page, but step 1 above wins whenever a session exists — and if the header names a *different* database
> than the session, Odoo raises **`403 Cannot use both the session_id cookie and the x-odoo-database header`**.
> On a device the jar attaches the cookie on its own, so this 403 hit **every call including login**. Tried,
> reverted, guarded in `rpc()`. Verified: header matching the session db → 200; header disagreeing → 403.

**The real cure for a post-login 404 is a clean session**, not a header — clear app storage / reinstall, or
sign out so a fresh cookie is issued. `rpc()` also detects `SessionExpiredException` by `error.data.name` and
clears the stored id so the next attempt starts clean.

**A 404 from an `auth='user'` route means the session, never the address.**

### Two datetime converters, chosen per endpoint

The WFH API is inconsistent **within itself**, and nothing in the payload distinguishes the two:

| Endpoint | Produced by | Meaning |
|---|---|---|
| `/wfh/today_status` | `convert_to_user_tz()` | already the **user's** zone |
| `/wfh/request/my_requests` | `str(field)` | raw **UTC**, like everything else |

Both arrive as `'2026-08-22 14:30:00'` with no marker. `odooUtcToIso()` appends `Z`; `odooLocalToIso()`
(added for this) only swaps the space for `T`. Using the wrong one is a silent **five-and-a-half hour**
error here — measured, not assumed. Pick by endpoint, never by inspecting the value.

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
10.96.160.175:8069
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

- `sales_test` — addon v**19.0.8.6.0**, 21 employees, one draft payroll run `PAY/2026/0008`, no payslips generated
- Field Settings — company record in **Per employee** mode with every section off, so nobody sees extra fields yet
- Salary components active: **Basic**, **Special Allowance**
- App — bundles clean, **35 modules evaluate**, `expo export` exits 0. Home and Leave on live data.
- `hr_leave_config` has **one row, paid leave ENABLED** (12/yr, 1/month, unpaid deduction on) and
  `hr_leave_request` holds **one pending request** (id 23, Marc Demo, 3 Nov) — both left deliberately so the
  balance card and the list show real data on a device instead of their empty states. Delete them to get the
  `{has_quota: false}` branch back; both branches are proven.
- **`demo`'s password is now `demo369`** (set for the security testing; the original hash is not recoverable).

**Backups**: `_db_backup/sales_test_before_8.2.0.dump` (taken before this session's addon change), `_db_backup/sales_test_before_7.3.0.dump`, and `_db_backup/js_backup/` holds pre-change copies of `package.json`, the theme files, `security_rules.xml` and the whole `src/` tree before the polish pass.

---

## 7. Next

**Phase 2 — Leave. Done, and verified against the live server.** See §1 and §3.

Proven as `demo` (a plain `base.group_user`) on `sales_test`: own create / list / filter / cancel all work;
the non-sudo create files against the right employee, so the record rule — not `sudo()` — is the boundary;
spoofing `user_id` is refused as an id, as a string and as garbage; both balance branches return; the overlap
error maps onto the dates field plus the banner; and a rejected create now leaves nothing behind. The manager
path was exercised by granting `group_leave_manager` to `demo`, confirming the same probes succeed, then
revoking and confirming they refuse again.

**Cross-process gotcha:** group changes made from `odoo-bin shell` do NOT reach the running server —
`has_group` is ormcached per process and the shell never signals the registry. Restart the service after any
grant/revoke or the manager tests fail for the wrong reason.

**Still not exercised on a physical device**: the Leave screen's appearance, the dark-mode pass, and Android
hardware back (Home's `hardwareBackPress` handler was rescoped to `useFocusEffect` — unconditional it wins
the race on *every* screen pushed above Home and leaves back dead there). Sign out first: a stale session in
the platform cookie jar is what produces the post-login 404 described in §3.

**Phase 3 — Work From Home. Done, and verified in a browser against live Odoo.**

Screen, request card, apply sheet and constants, plus the Home integration. The envelope differs from leave
at every turn — list key `requests` not `data`, filter param `state` not `state_filter`,
`request_id`/`state` at the top level rather than nested under `data`, a single `request_date` rather than a
range, and eight states rather than five. `checked_out` is **not** terminal.

Per the module's own docstring, WFH does **not** get its own check-in control: there is one attendance
button, and an approved day only badges it and skips the geo-fence. Home shows a "WFH" chip beside the
status chip; the check-in stays where it was.

**Verified by `npm run test:web`** — 38 checks driving the real UI in Edge over CDP against real data,
covering both Leave and WFH: login, lists, filters and their empty states, validation, the calendar, an
end-to-end leave submit, the overlap landing on both field and banner, the WFH badge, the today banner and
the WFH sheet.

**Phase 4 — Attendance history and My Details. Done, and verified in a browser.**

Attendance history pages a month at a time off `hr.attendance.day.status` — the same graded ladder Home uses,
never `hr.employee.report`, which carries wage and final_amount. `deduction_amount` is on the day-status model
too and is deliberately not read. Forward paging stops at the current month.

The fourth tile is now **My Details** rather than Reports, so the salary-bearing report models are no longer
offered at all.

**My Details reads `res.users`, not `hr.employee`** — and that distinction is the whole story. An employee
cannot read their own `hr.employee` record: there is no `base.group_user` ACL row in Odoo 19 and the
`hr.employee.public` fallback refuses everything interesting. Verified field by field: `name`,
`work_email`, `department_id` and `work_phone` come back; `blood_group`, `emergency_contact`,
`confirmation_date`, `notice_period_days`, `monthly_wage` and the rest all raise `AccessError`.

The addon already solves this the way core hr does — `SELF_READABLE_FIELDS` / `SELF_WRITEABLE_FIELDS`
allow-lists on `res.users` plus related fields carrying `related_sudo=False` (load-bearing: the default would
read as superuser and bypass the very checks that confine an employee to their own record). One read returns
both the values and the visibility switches, so a section an admin has not enabled is absent rather than
empty. **A new `/employee/details` route was written for this and then deleted** — it duplicated the existing
mechanism and used a blanket `sudo()` that undid `related_sudo=False`. Reuse the allow-lists.

Salary cannot appear here even by mistake: those fields are outside the allow-list.

Also open, worth deciding separately:
- `monthly_wage` duplicates Odoo 19's stock `wage` (`hr.version`); both now show on the Payroll page
- ~~The Monthly Report has two defects~~ — **both fixed in v19.0.8.6.0**, see §1. Boundary-crossing leave now
  splits across months by chronological quota consumption, and a day that is both present and paid leave is
  no longer earned twice.
- ~~`/leave/request/report` and `/wfh/request/list` run `sudo()` ungated~~ — **closed in v19.0.8.4.0.**
  Both were demonstrated open as `demo` first, then gated and re-probed. The old warning that gating
  `/report` "could break existing backend callers" was wrong: it has none.
