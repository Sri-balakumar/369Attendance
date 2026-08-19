# 369 Attendance — mobile app

React Native (Expo) client for the `hr_attendance_369` Odoo suite that lives in
[odoo_modules/](odoo_modules/) beside it.

**This first pass is UI only.** Nothing talks to a server yet: the database list, the
login and the dashboard data all come from [src/services/mockOdoo.js](src/services/mockOdoo.js),
with realistic delays and failure paths. That file is the single seam — wiring the app to a
live Odoo server means replacing three function bodies there, and no screen code changes.

## Run it

```bash
npm install       # first time only
npx expo start
```

Then press `a` for an Android emulator, `w` for the browser, or scan the QR code with
**Expo Go** on your phone. No Odoo server is needed.

## The flow

```
Splash ──▶ Server URL ──▶ Login ──▶ Home
             (once)      (every launch)
```

**Server** is asked for exactly once. Type an address and the database list loads by itself
after a short pause — no connect button. Pick one, press Continue, and you never see this
screen again unless you tap **Change URL**.

**Login** is where almost every launch lands. It shows which server and database it will sign
in to, and carries the **Change URL** button — the only route back to the Server screen.

**Home** stays. Backgrounding the app, killing it, or reopening it days later comes straight
back here. There is no session timeout: only **Logout** ends the session.

| Action | Clears | Goes to |
|---|---|---|
| Logout (Home header) | the signed-in user | Login — server and database kept |
| Change URL (Login) | user **and** server | Server |

## Demo inputs

Because there is no server, the mock service branches on what you type:

| Input | What happens |
|---|---|
| any URL, e.g. `https://demo.odoo.local` | three databases to choose from |
| URL containing `single` | one database, auto-selected |
| URL containing `bad` | error card with Retry + manual database entry |
| URL containing `empty` | "no databases found" |
| any username + password | signs in |
| username `fail` | rejected, so the error state is reviewable |

Both light and dark themes follow the phone's appearance setting; the sun/moon button in the
Home header overrides it so you can review both without leaving the app.

## Layout

```
App.js                  providers + font loading
src/theme/              colour tokens, spacing/radii/shadows, useTheme()
src/components/         inputs, buttons, sheets, toasts, confirm dialog
src/state/              SessionContext — the two persisted keys and the routing rules
src/services/mockOdoo   THE SEAM: fetchDatabases / authenticate / getHomeData
src/screens/            Splash, Server, Login, home/
```

`metro.config.js` blocks `odoo_modules/` and `_db_backup/` from Metro's watch set — the dumps
in `_db_backup` are large enough to make startup crawl otherwise.

## Not built yet

Real `/web/database/list` and `/web/session/authenticate` calls, real check-in through
`hr.employee.attendance_manual`, and the Leave / WFH / Attendance-history / Profile screens.
The four quick-action tiles on Home are where those attach.
