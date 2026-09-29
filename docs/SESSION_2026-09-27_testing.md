# Session notes, 27–28 Sep 2026: end-to-end testing and fixes

Session: `369attendance-b1`, continuing *"Attendance module sync between odoo and app"*.
Live server: `369application` on this PC (Odoo 19, port 8069). Tablet: Samsung SM-T510 over adb.

---

## Remaining work

- [ ] **Upgrade live again** (needs approval). It ships three uncommitted module changes together:
  - `models/leave_request.py`: comp-off leave no longer eats the paid-leave quota (`_paid_quota_left` now excludes `comp_off`).
  - The user manual from session `369attendance-ef`: `static/src/docs/*` plus the `help_doc_suite` record in `data/help_document_data.xml`.
  - Follow the same steps as today: back up → upgrade a copy → upgrade live (see *How the upgrade was done*).
- [ ] **Fix the double tap in reason dialogs.** With the keyboard open, the first tap on *Keep leave* or *Reject* only closes the keyboard, so HR must tap twice. It probably needs `keyboardShouldPersistTaps="handled"` in `src/components/PromptDialog.js`.
- [ ] **Fix payroll for new joiners.** Days before an employee existed are counted as Absent. Test accounts created on 27 Sep got 23 absent days for September. Mid-month joiners would lose pay for days before they joined.
- [ ] **Casual half-day leave:** decide whether it's needed. Only Comp-off has a *Half day* switch today.
- [ ] **Check the Odoo web screens after the upgrade:**
  - The leave form shows *Keep Leave*, and Keep Leave with no reason is refused.
  - The *Employee Details* menu is hidden for an HR Manager. The server side is confirmed (menu group = Administrator only); it hasn't been looked at in the browser.
- [ ] **Monday 28 Sep, after 10:00 IST:**
  - Anyone with no check-in shows as Absent on Absent Today and Day Status.
  - The HR tab *Today* tiles show real people, and tapping a tile lists names.
- [ ] **Grant a Declared comp-off credit** (Admin → Compensatory Off). Not tested, because no Declared credit existed.
- [ ] **Login step 1 cloud animation:** watch the *searching* waves and the *offline* shake on the tablet. Only the green "done" state was captured.
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
