# Session notes, 27–28 Sep 2026: end-to-end testing and fixes

Session: `369attendance-b1`, continuing *"Attendance module sync between odoo and app"*.
Live server: `369application` on this PC (Odoo 19, port 8069). Tablet: Samsung SM-T510 over adb.

---

## 1 Oct tablet test: Attendly app against live (`hr_attendance_369` 10.3.0)

- **Setup:**
  - The Expo Go app on the tablet was connected over USB with `adb reverse`, because the tablet's Wi-Fi dropped mid-test.
  - Server `127.0.0.1:8069`; Metro on `127.0.0.1:8082` in localhost mode.
  - Temporary users `e2e.employee`, `e2e.hrmanager` and `e2e.admin`, created without welcome emails, are all deleted again.
  - The WhatsApp roll call, daily summary and leave emails were off throughout.
- **Screenshots:** `screenshots/tablet-1001/` (A = login, B = employee, C = HR, D = admin).
- **Not repeated here:** what the 27–28 Sep pass already covered.

| Area | Check | Result |
|---|---|---|
| Launch | White Expo loader, then the Attendly intro ("Every presence counts.") on white, then Home | Pass |
| Login | Wrong password: "Invalid username or password." | Pass |
| Login | Keyboard open: the header keeps its size and Sign In stays visible | Pass |
| Login | Change server: confirm dialog, back to the Server step | Pass |
| Login | Unreachable server: "Cannot reach the server…" with Retry / Enter database manually | Pass |
| Login | Real server: 5 databases listed; Continue disabled until one is picked | Pass |
| Employee | Tabs Home · Profile only | Pass |
| Employee | Check In (late, after 10:00) then Check Out; "Done for today"; times and worked hours right | Pass |
| Employee | Leave: apply (one tap with keyboard open), the LOP banner after the month's paid day, Cancel request | Pass |
| Employee | WFH: request (one tap with keyboard open), Cancel request | Pass |
| Employee | My Attendance: month view; previous month; the next arrow stops at the current month | Pass |
| Employee | Profile (new): Employee badge, Work, month tiles, leave balance with pending, Attendance setup, Account, Log out confirm; no queue or System | Pass |
| Employee | Settings › App Manual: "needs upgrading" message (11.0.0 not live) | Pass (graceful) |
| Employee | Bell: "No notifications yet" | Pass (graceful) |
| HR | Tabs Home · HR · Profile; Approvals badges (leave 2, WFH 2); Today tiles and the Absent filter | Pass |
| HR | Leave: reject with a reason, approve (paid/unpaid recomputed 0/1 to 1/0 on approval) | Pass, but see bug 1 |
| HR | WFH: approve, and reject with a reason | Pass, but see bug 1 |
| HR | Cancellation: Keep leave with a reason, then Approve cancellation | Pass, but see bug 1 |
| HR | Profile: HR badge, Your queue counts, Absent today list | Pass, but see bug 2 |
| Admin | Tabs Home · Config · Profile; Profile System card (server, database, Attendly 1.0.0) | Pass |
| Admin | Late Records, Day Status, Absent Today, Monthly Summary (form only, not generated), Approved Leaves | Pass |
| Admin | Public Holidays, Auto-Approval, Payroll Runs, Payslips, Generate Report (form only), Past Reports | Pass |
| Admin | Config › Notifications | Fail: raw "404 Not Found" (bug 3) |

**Bugs found**
1. **The keyboard double tap is still there in every reason dialog** (Reject leave, Reject WFH, Keep leave; 3 of 3).
   - With the keyboard open, the first tap on the dialog's button only closes the keyboard, and a second tap is needed. Nothing is sent on the first tap.
   - The 28 Sep fix (`ScrollView keyboardShouldPersistTaps="handled"`, `src/components/PromptDialog.js:89`) is in place but doesn't help. Likely cause: the dialog jumps back to the centre as the keyboard closes, so the press is cancelled.
   - The Leave/WFH apply sheets and the login button do work with one tap.
2. **Profile › Your queue › "Cancellation requests" opens the leave list on the *Approved* chip.** It should open Cancellation. `src/screens/profile/MyDetailsScreen.js:236` passes `state:'approved'`; the HR tab uses `'cancel_requested'`.
3. **Config › Notifications shows a raw "404 Not Found: The requested URL was not found…"** while the server is on 10.3.0. App Manual shows a friendly "needs upgrading" message instead; this screen should do the same.
4. **Minor findings:**
   - **Home captions:** "Apply Leave · Casual · Sick · Earned", but there is no Earned type.
   - **Home Status tile:** shows "Present" / "On time" before any check-in, until the absent stamp runs.
   - **My Attendance:** the late time (e.g. "7:12") has no label.
   - **WFH day picker:** doesn't mark weekly offs or holidays (the leave picker does).
   - **Check In when the server is unreachable:** shows no spinner or error. The tap just does nothing; a request lost when the USB tunnel dropped.
   - **Late Records for an admin without the Attendances admin group:** shows "Nobody was late" rather than a permissions hint. The test admin hit this until the group was added.
   - **Expo Go only:** a red "expo-notifications … removed from Expo Go" developer banner. Push needs a development build anyway.

**Fixes (1 Oct evening). Tested on the tablet the same evening; see *1 Oct evening re-test* below.**
1. **Double tap:**
   - **The real cause:** the reason dialogs are rendered inside `AdminScreen`'s `ScrollView`, which used the default `keyboardShouldPersistTaps`. React Native lets that parent take the first tap to close the keyboard, even through a `Modal`, so the 28 Sep fix inside the dialog could never help.
   - **The fix:** `AdminScreen.js` uses `keyboardShouldPersistTaps="handled"`. This also fixes every admin form's Save button with the keyboard open.
   - The Leave screen's own Request cancellation dialog is outside its list, which is why it was never affected.
2. **Cancellation requests row:** now opens the Cancellation chip (`MyDetailsScreen.js`).
3. **Notifications:** an older server now gets the "needs upgrading" empty state, and Save / Send test say so in the toast. This uses `isMissingBackend()` in `odoo.js`, and `rpc()` now keeps Odoo's exception name on the error.
4. **Minor:**
   - the caption now reads "Casual · Sick · Annual";
   - before check-in, Late by shows "—", and Status shows "Not in yet" (or the stamped status, e.g. Absent);
   - My Attendance shows "Late 7:12", only on late days;
   - the WFH picker marks weekly offs and holidays (shared `hooks/useWorkCalendar.js`);
   - Late Records' empty text mentions the Attendances Administrator group;
   - a reply that stalls after its headers now ends in the 15 s error instead of a frozen Check In (the timer in `rpc()` now runs until the body is read).
5. **Back goes one screen:**
   - All chevrons and "save then go back" use `goBackOnce()` (`navigation/back.js`): one back per 600 ms app-wide, and only from the screen on top. A double tap, or a press of back during a save, pops only once.
   - Home: "Press back again to exit".
   - Sign in reached with Continue: back returns to the server step.
   - Leave/WFH sheets and the reason dialog ignore back while sending.
   - A notification tap reuses an open screen instead of stacking another Main.
6. **Haptics (`expo-haptics`, `utils/haptics.js`):**
   - A buzz on main buttons, Sign In / Continue and dialog confirms.
   - A light tick on tabs, pickers and switches.
   - Success, error and warning patterns through the toast, plus on a wrong password and an empty reason.
   - A **Settings › This device › Vibration on tap** switch, on by default.

### 1 Oct evening re-test (tablet, live, Expo Go)
- **Setup:**
  - Tablet over USB, but the app kept its saved Wi-Fi server `10.71.219.175:8069`.
  - Metro restarted on `127.0.0.1:8082` with `-c`, because the old one didn't see the new files.
  - Temporary users `e2e.employee`, `e2e.hrmanager`, and `e2e.admin` (with the Attendances Administrator group).
  - Created by script: one pending leave, one approved leave with a cancellation request, one pending WFH.
  - All deleted afterwards (users, employees, partners, requests, attendance, day status: 0 left).
- **Screenshots:** `screenshots/tablet-1001b/` (A = login, B = employee, C = HR, D = admin).
- **Haptics check:** each one was read from `adb shell dumpsys vibrator`. Expo Go's vibrations are listed there. This tablet (Android 11) has no `vibrator_manager`.

| Area | Check | Result |
|---|---|---|
| Login | Empty Sign In: shake, press buzz, then error pattern | Pass |
| Login | Sign in: success buzz | Pass |
| Employee | Caption "Casual · Sick · Annual" | Pass |
| Employee | Before check-in, stamped Absent: Status Absent, Late by "—" (was "On time"; fixed during the test) | Pass |
| Employee | Home: back shows "Press back again to exit"; a second back within 2 s exits to the launcher | Pass |
| Employee | Tab switch tick; back on the Profile tab returns to Home | Pass |
| Employee | Check In: press and success buzz; Late by 11:13; My Attendance "Late 11:13" | Pass |
| Employee | WFH picker: Sundays marked, Holiday / Weekly off legend; picking a day ticks | Pass |
| Employee | Back with the WFH sheet open closes only the sheet | Pass |
| Employee | Vibration switch off: switch and Check Out give 0 vibrations; on again: one tick | Pass |
| HR | **Reject leave, Keep leave, Reject WFH with the keyboard open: one tap each** (bug 1) | Pass |
| HR | After a decision: back exactly one screen, to the queue | Pass |
| HR | Double tap on the header back arrow: one screen (popped two before the 600 ms gap; fixed during the test) | Pass |
| HR | Profile › Your queue › Cancellation requests opens the Cancellation chip (bug 2) | Pass |
| HR | Log out: press buzz only, no error message (fixed during the test) | Pass |
| Admin | Config › Notifications: "Not available … needs upgrading" (bug 3) | Pass |
| Admin | Late Records with the Attendances Administrator group lists the late check-in | Pass |

**Found and fixed during the re-test:**
1. **Home "Late by":** showed "On time" for someone stamped Absent with no check-in. It now needs a check-in (`StatTiles.js`).
2. **Double tap on the back arrow** went back 2 screens: after the first pop, the screen underneath has its arrow in the same place. It's fixed with an app-wide 600 ms gap in `goBackOnce`.
3. **Log out flashed a red error message**, and with haptics also an error buzz.
   - **Cause:** Home reloaded with no session once the user was cleared, and Odoo returned `AccessError`.
   - **Fix:** `HomeScreen` skips the load when nobody is signed in. This was an older bug that the vibration made noticeable.

**Login keyboard fix (same evening):**
- **Before:** with the password field focused, the keyboard covered Sign In.
- **Cause:** the `KeyboardAvoidingView` was iOS-only and sat under the header, where it miscalculated its own position. With edge-to-edge, Android no longer shrinks the window for the keyboard.
- **Fix:**
  - `AuthScreen.js`: the avoider now wraps the whole screen with `padding`. On Android it's switched on only while the keyboard is up, because the close event left about 70 dp of padding behind.
  - `useKeyboardScrollToEnd.js`, used by `LoginForm` and `ServerForm`, scrolls the form to its end when the keyboard opens or an error line appears.
  - The video header isn't touched.
- **Tablet results** (screenshots `A11`–`A25`):

| Check | Result |
|---|---|
| Username or Password focused: Sign In and Change server visible above the keyboard | Pass |
| After a wrong password, the error line, Sign In and Change server are all visible | Pass |
| Header: same height and position in every shot; the video keeps playing (about 55% of sampled header pixels change in 1 s) | Pass |
| One tap on Sign In with the keyboard open: "Invalid username or password.", with press and error buzz | Pass |
| Keyboard closed: Sign In back in its original place, no gap at the bottom | Pass |

- **Not run on the tablet:** the server step's Continue gets the same fix, but checking it needs Change server.

**Seen, not changed:**
- **Clocks:** the tablet clock runs about 2 min ahead of the server (check-in at 19:15 on the tablet was recorded as 19:13).
- **Not re-tested:**
  - the Change-server back step, so as not to change the saved server;
  - the 15 s stalled-reply error;
  - the notification-tap screen reuse, which needs push.

**Not testable yet (needs `hr_attendance_369` 11.0.0 on live):**
- the bell list with real notifications and the Late reason screen;
- Config › Notifications switches and Send test;
- App Manual upload and open;
- phone push, which also needs an EAS development build.

Late check-ins currently aren't asked for a reason at all, because in this app version the request arrives as a notification.

**Live data:**
- No public holidays are set for 2026.
- The September run `PAY/2026/0001` is still Draft (1 employee, 0.00 net, because Administrator has no monthly wage).

## Remaining work

### WhatsApp group roll call (29 Sep): "@Employee present 9:30 AM" on first check-in
- [x] **New addon `odoo_modules/hr_attendance_369_whatsapp`.** On an employee's first check-in of the day, from any path (app Check In, KRA Start Workday through the bridge, WFH, backend), it posts one line to a chosen WhatsApp group, tagging them. It depends only on `hr_attendance_369` and ships switched off.
  - **Gateway:** the same Evolution API panel sales_automation uses, through its own small client. `whatsapp_gateway` can't be installed here because it and `whatsapp_neonize` both define `whatsapp.session`, and live has neonize for KRA.
  - **Menu:** Attendances → Attendance Status → Configuration → *WhatsApp Group*.
  - **Setup:** paste the setup key (`wa1_…`), then *Fetch from Panel*, *Choose Group* (Load Groups, tick one) and *Send Test*, then tick *Enabled*.
  - **The tag:** it takes the employee's Work Mobile, then Work Phone, then Private Phone, and adds `91` to a 10-digit number. It sends `@<digits>` in the text and `<digits>@s.whatsapp.net` in `mentioned`, which is what makes WhatsApp show the name. With no number, the message uses the bold `*Name*` instead.
  - **When it sends:** the check-in only marks the record `pending`. The cron *Attendance: post check-ins to WhatsApp group* then sends it: straight away, with a 5-minute safety run, 3 tries, and it gives up 2 h after the check-in. The attendance form shows *WhatsApp Group Post*: Sent / Failed / Skipped.
  - **Never posted:** check-ins more than 60 min old (HR back-fills), and any check-in that isn't the day's first.
- [x] **KRA (`C:\Projects\APK's\KRA_KPI`):** the "🟢 Workday started" group post is removed:
  - `kpi_work_session.py`, `kpi_wa_group_report.py` and `kpi_wa_group_event.py` (the event is off the settings list);
  - the app's `services/waGroup.js` and Maestro `42-config-wa-events.yaml`.

  The Workday-ended and task-event group posts are unchanged. `kra_kpi_module` is now 19.0.5.3.
- [x] **Tested on a scratch copy of live** with a fake Evolution gateway (24/24 checks). Install, upgrade, setup key, panel config, group list, and one post per first check-in all work. Sent text: `@919876543210 present 1:35 PM` with `mentioned`. Also checked:
  - no phone gives `*Name*`;
  - no resend;
  - back-fill not posted;
  - gateway down: failed after 3 tries, and the check-in is kept;
  - KRA Start Workday: exactly one attendance post, and nothing from KRA.

  Backup taken: `_db_backup/369application_before_wa_group_2026-09-29.dump`.
- [ ] **Deploy to live:**
  - Copy `hr_attendance_369_whatsapp` into the server addons folder, and `KRA_KPI/odoo_modules/kra_kpi_module` too.
  - Run `-u kra_kpi_module -i hr_attendance_369_whatsapp`.
- [ ] **Configure on live:** paste the setup key and choose the group. If *Load Groups* returns HTTP 400, the hosted panel is dropping the query string; paste the group address (`1203…@g.us`) by hand instead. Then Send Test and tick Enabled.
- [ ] **Employees:** fill in Work Mobile with the WhatsApp number, so the tag works.
- [ ] **One real check-in:** check that the tag shows as the person's name in the group.
- [ ] **KRA Maestro test 42** now expects *Workday ended* to be the enabled event on the test database.

- [x] **Upgrade live again** — done 28 Sep 17:50 (exit 0, no errors; backup `_db_backup/369application_before_joiner_fix_2026-09-28.dump`, old module in `_db_backup/addons_before_joiner_fix`). Live now has:
  - `models/leave_request.py`: comp-off leave no longer eats the paid-leave quota (`_paid_quota_left` excludes `comp_off`). Committed 29 Sep.
  - `models/payslip.py` + `models/hr_employee.py`: the new-joiner payroll fix below. Not committed yet.
  - The user manual from session `369attendance-ef` in the Help menu (`static/src/docs/*`, record `help_doc_suite`). Committed 29 Sep.
- [ ] **Set Administrator's joining date** (Employee form → Work Information → joining/contract start). Until then, September payroll shows 21 days as *Not on payroll (joining date not set)*.
- [x] **Fix the double tap in reason dialogs.** The 28 Sep fix (a `ScrollView` with `keyboardShouldPersistTaps="handled"` in `PromptDialog.js`) failed on the tablet on 1 Oct. It was re-fixed in `AdminScreen.js` on 1 Oct and passed on the tablet that evening (one tap each); see *1 Oct evening re-test* above.
- [x] **Fix payroll for new joiners** (code done 28 Sep, see *Testing* below for what was verified). Working days before the joining date or after the departure date are now "not on payroll": neither paid nor absent. They come off as their own deduction line, *Not on payroll (N days)*, at the daily rate, and `paid_days` excludes them. The joining date is `contract_date_start` (Employee form → Work Information); if it's empty, the day the employee record was created is used. **Caveat:** an employee record created after the person actually started should get its joining date set, or the days in between are deducted.
  - Verified on a copy of live (28 Sep, rolled back): an employee created today gets *Not on payroll (23 days)* and 3 paid days for September; one with joining date 15 Sep gets 12 not on payroll, 11 absent, 3 paid, net 3,000 of 26,000.
  - **Watch out:** Administrator's record was created on 25 Sep with no joining date, so September now shows 3 absent + 21 not on payroll instead of 23 absent. Set the joining date on the employee form to change that; the line says *joining date not set* while it's missing.
- [x] **The app in a browser** — checked 28 Sep with the Expo web build through `tools/same-origin-proxy.mjs` (app at `http://localhost:8090/`), driven in headless Chromium; tablet-sized captures in `screenshots/app-web/`:
  - HR tab: *Leave requests · 1*, Today board with **Absent 1**; the Absent tile lists *Administrator · auto-stamped · Absent* (`hr-02`, `hr-03`).
  - Reject a leave with a reason from the HR queue: dialog, reason typed, one press, back to "Nothing waiting" (`hr-05`–`hr-07`). The keyboard double-tap itself can't be reproduced on web (no soft keyboard); the fix is in the code and still wants one tablet press.
  - Admin: *Absent Today* lists Administrator ("1 person has not checked in"), *Day Status* shows the 28 Sep Absent row (`adm-01`, `adm-02`).
  - Admin: *Compensatory Off* → *Declared* chip → credit → *Grant as earned* → Available, 1 day, "Credit granted" (`adm-03`–`adm-06`).
  - Admin: Payroll run → *Generate again* → *Generate*; the mid-month test employee's payslip shows *Not on payroll (23 days; joining date not set) 23,000.00*, net 3,000, paid days 3 (`adm-09`–`adm-11`). The live draft run was regenerated in the process; the test employees' payslips were deleted with the test data.
  - Server screen: signal-wave ring while "Fetching databases…", then databases found; unreachable address → red cloud-offline icon with "The server did not answer within 15s" (`srv-02`–`srv-07`).
  - How to repeat: Metro (`npx expo start --port 8081`), `node tools/same-origin-proxy.mjs 8090 8081`, headless Chromium on 9222, then `node tools/odoo-web-drive.mjs 9222 tools/odoo-web-steps/app_*.json`. The `appLogin` step signs in through the proxy and seeds the app's storage keys, the same way `tools/test-web.mjs` does.
- [x] **Tablet only:** press *Keep leave* / *Reject* once with the soft keyboard open and see it go through. Passed on 1 Oct evening for Reject leave, Keep leave and Reject WFH.
- [ ] **Casual half-day leave:** decide whether it's needed. Only Comp-off has a *Half day* switch today.
- [x] **Odoo web screens after the upgrade** — checked 28 Sep in a real browser (headless Chromium driven over CDP, tablet-sized 1200×1920 captures in `screenshots/odoo-web/`), with temporary users that were deleted afterwards:
  - The leave form shows *Keep Leave* next to *Approve Cancellation* when a cancellation is requested (`02-hr-leave-form.png`). Keep Leave with a blank reason is refused: "Missing required fields" and the field turns red (`04-hr-keep-empty-refused.png`). With a reason, the wizard closes, the request is cleared (only *Cancel Leave* remains) and the reason is saved (`05-hr-after-keep.png`).
  - The Attendances menus for the HR Manager have no *Employee Details*; the admin's do (`06-hr-attendances-menu.png`, `08-admin-attendances-menu.png`, and the folded "+" menus in `07-hr-more-menu.png` / `09-admin-more-menu.png`).
  - Help → *Help & User Guide* lists the new *Attendance Suite – Complete User Manual* first (`10-hr-manual.png`).
  - Same checks also pass server-side (rendered view arch, menu visibility, wizard action).
  - How to repeat: start `%LOCALAPPDATA%\ms-playwright\chromium_headless_shell-1228\chrome-headless-shell-win64\chrome-headless-shell.exe --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp>`, then `node tools/odoo-web-drive.mjs 9222 tools/odoo-web-steps/<file>.json`. The step files expect the `e2e.hrmanager` / `e2e.admin` test users and a leave with id 14 that has a cancellation request; create them first and delete them after. Sign in with the driver's `login` step (it puts `?login=<user>` in the URL, or Odoo's remembered-users switch hides the form).
- [x] **Monday 28 Sep, after 10:00 IST** — confirmed on the server at 17:20 and 18:05: the cron stamped Administrator Absent for 28 Sep, and the reads the app makes for Absent Today and the HR *Today* board return that row for an HR user without a permission error.
- [x] **Grant a Declared comp-off credit** — confirmed on the server (rolled back): a Declared credit granted by an HR user becomes Available with 1 day, and the balance shows 1 earned.
- [x] **Payslip line on live** — confirmed on the server (rolled back, with a test wage of 26,000): Administrator's September slip shows *Loss of Pay* 3,000 and *Not on payroll (21 days; joining date not set)* 21,000.
- [ ] **Month end (after 30 Sep):**
  - Press Generate on `PAY/2026/0001` again, then Confirm.
  - Use **Mark paid** for the first time. It can't be undone and has never been tested.
- [ ] **Commit and push.** Nothing from 27–28 Sep is committed (the file list is below).
- [ ] **Delete the database backups at the very end**, as asked. They are in `_db_backup/`:
  - `369application_before_hr_tab_2026-09-27.dump` (taken today, before the live upgrade)
  - older ones: `…before_10.1.0.dump`, `…before_10.3.0.dump`, `…before_9.0.0_deploy.dump`, `…before_admin_actions_test.dump`
  - old module folders: `addons_before_10.1.0`, `addons_before_10.3.0`, `addons_before_hr_tab`

---

## Done this session

### Live server changes
- The September draft payroll run `PAY/2026/0001` was regenerated with the absence fix: 0 → 23 absent days and 26 → 3 paid days for Administrator. It's still a draft.
- **Late window ends** was set to **10:00** in Office Hours.
- **The module was upgraded on live** (`hr_attendance_369`, exit 0, 0 errors). It brought:
  - the HR tab and admin-only Config (app side)
  - the Keep Leave wizard in Odoo
  - the Employee Details menu limited to administrators (`groups="-hr.group_hr_manager,base.group_system"`, so HR Managers no longer inherit it)
  - Leave Policy without paid-leave carry-forward
  - the **paid-leave balance fix**: "used" now counts `paid_days`, not all days, so a 1 paid + 1 LOP leave shows Used 1 / Remaining 11. This applies in `leave_config.py` and `hr_employee.py`.

### App changes (not committed)
- **Navigation bar:** back, home and recent-apps icons are always dark, so they stay visible on the white strip when the tablet is in dark mode (`src/theme/ThemeProvider.js`, adds `expo-navigation-bar`).
- **Login step 2:** *Remember me* and *Forgot password?* are removed. The person icon is now a lock that pulses while signing in and opens (green, shackle lifts) on success (`src/screens/LoginScreen.js`). Tested on the tablet.
- **Login step 1:** the cloud icon shows signal waves while it searches for databases, turns green with a pop when they're found, and shakes (offline icon) when the server can't be reached (`src/screens/ServerScreen.js`).
- An Odoo web-login animation was tried and **reverted** at your request. Nothing of it remains.

### Tablet test results (live data, temporary accounts, all deleted afterwards)

| Area | Check | Result |
|---|---|---|
| Employee | LOP banner: fresh month shows none; 2 days gives "1 paid, 1 unpaid"; month used gives a red banner on open; Submit button shows the LOP count | Pass |
| Employee | "I'm working today" → check in → check out → ½ day comp-off earned | Pass |
| Employee | Comp-off leave (half day) uses the credit; balance 0.5 → 0 | Pass |
| Employee | My Attendance, My Details | Pass |
| Employee | Ask to cancel approved leave; blank reason refused ("HR sees this"); sees HR's Keep reason; asks again | Pass |
| HR Manager | HR tab only (Home / HR / Profile), no Config | Pass |
| HR Manager | Approve leave, Keep leave (returns to list), Approve cancellation (balance restored) | Pass |
| HR Manager | WFH row with badge; approve WFH; reject WFH with reason | Pass |
| HR Officer | HR tab with only Today, no permission errors | Pass |
| Admin | Full Config, including Employee details | Pass |
| Admin | Compensatory Off: add, cancel, restore credit | Pass |
| Admin | Leave Balances (shows the corrected Used/Left) | Pass |
| Admin | Leave Policy save (no paid carry-forward) | Pass |
| Admin | Field Settings, Salary Components, Statutory IDs open | Pass |
| Admin | Office Hours shows Late window 10:00 | Pass |
| Admin | Payroll Generate (trial run, rolled back) | Pass |

Screenshots: `screenshots/employee`, `screenshots/hrr`, `screenshots/admin`, `screenshots/retest`, `screenshots/final`, `screenshots/login`.

---

## Useful notes

- **Monthly Wage** is per employee in Odoo: Employee form → *Payroll* tab → *Attendance Deductions*. All absence, half-day and LOP deductions are taken from it. The app shows it on payslips but can't edit it.
- **The PC's Wi-Fi address keeps changing** (10.96.160.175 → 10.136.98.175 → 10.71.219.175). When the app says *"The server did not answer within 15s"*, run `ipconfig`, then tap *Change URL* in the app and enter the new address with `:8069`. Expo Go is opened with `exp://<pc-ip>:8081`.
- **The odoo shell can hang at exit on this PC.** Run it as `python.exe -u odoo-bin shell …` inside `timeout`; the work still commits.
- **Test copies restored from a dump have no filestore.** Delete `ir_attachment` rows with `url like '/web/assets/%'` so the asset bundles regenerate. Otherwise `web.assets_frontend_minimal.min.js` returns 500 and the login form stays hidden.

### How the upgrade was done
1. `pg_dump -Fc 369application` → `_db_backup/…dump`
2. Restore to a scratch database, then upgrade it with `run_odoo.py` (a private addons path) and check the log for errors.
3. Save the old module to `_db_backup/addons_before_…`
4. Stop the services `odoo-gevent-19.0` and `odoo-server-19.0`, then copy `odoo_modules/hr_attendance_369` into `C:\Program Files\Odoo 19.0.20260119\server\odoo\addons\`
5. Run `odoo-bin -d 369application -u hr_attendance_369 --stop-after-init`, then start both services.
6. Drop the scratch database.

### Uncommitted files (27–28 Sep, several sessions)
- **App:** `LoginScreen.js`, `ServerScreen.js`, `ThemeProvider.js`, `package.json` / `package-lock.json`, plus the HR tab work (`HrHomeScreen.js`, `MainTabs.js`, `BottomTabBar.js`, `RequestDetailScreen.js`, `RequestQueueScreen.js`, `PromptDialog.js`, `ConfigScreen.js`, `LeavePolicyScreen.js`, `SettingsScreen.js`, `guides.js`, `odoo.js`, `SessionContext.js`, `StatusRows.js`, `LeaveScreen.js`).
- **Module:** `leave_config.py`, `hr_employee.py`, `leave_request.py`, `menu.xml`, `leave_keep_wizard*`, the views, `ir.model.access.csv`, `guides.js`, the manifest, and the manual (`static/src/docs/`, `help_document_data.xml`).
- **Bridge module** (another session): `kra_kpi_attendance_bridge/*`.
