/**
 * Functional pass over the app in a real browser, against a real Odoo.
 *
 * Runs through tools/same-origin-proxy.mjs so the session cookie behaves the
 * way it does on a device. Drives the actual UI -- taps the real tiles, opens
 * the real sheet -- rather than calling into modules, and screenshots each step
 * so the result can be looked at rather than inferred.
 *
 * Usage: node tools/test-web.mjs [cdpPort] [outDir] [appOrigin]
 */
const PORT = process.argv[2] || '9222';
const OUT = process.argv[3] || '.shots';
const APP = process.argv[4] || 'http://localhost:8090/';

const fs = await import('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 30; i++) {
  try {
    const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {}
  await sleep(1000);
}
if (!target) { console.error('no page target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
  setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(method + ' timed out')); } }, 90000);
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result?.value;
};
const shot = async (n) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(data, 'base64'));
};
const waitFor = async (label, expr, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await ev(expr)) return true; } catch {}
    await sleep(800);
  }
  console.log(`    TIMEOUT: ${label}`);
  return false;
};
/** Tap by visible text, walking up to the nearest pressable ancestor. */
const tap = (text, exact = true) => ev(`
  (() => {
    const want = ${JSON.stringify(text)};
    const hit = [...document.querySelectorAll('div,span')].find(el =>
      el.children.length === 0 &&
      (${exact} ? el.textContent.trim() === want : el.textContent.includes(want)));
    if (!hit) return 'NOT FOUND: ' + want;
    let n = hit;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('tabindex') !== null) {
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
          n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
        return 'ok';
      }
    }
    return 'NO PRESSABLE ANCESTOR: ' + want;
  })()
`);
const text = () => ev('document.body.innerText');

/** Type into a React-controlled field. Setting .value directly is ignored by
 *  React, so go through the native setter and then fire a real input event. */
const type = (labelText, value) => ev(`
  (() => {
    const fields = [...document.querySelectorAll('input,textarea')];
    const f = fields.find(el => {
      const box = el.closest('div')?.parentElement?.textContent || '';
      return box.includes(${JSON.stringify(labelText)});
    }) || fields[fields.length - 1];
    if (!f) return 'NO FIELD';
    const proto = f.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(f, ${JSON.stringify(value)});
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()
`);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

await send('Page.enable'); await send('Runtime.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });

// ---- 1. real session, then boot to Home ---------------------------------
await send('Page.navigate', { url: APP });
await sleep(5000);
const auth = await ev(`
  (async () => {
    const r = await fetch('/web/session/authenticate', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc:'2.0', method:'call',
        params:{ db:'sales_test', login:'demo', password:'demo369' } }),
    });
    const b = await r.json();
    const u = b.result || {};
    localStorage.setItem('@369att:server', JSON.stringify({ url: location.origin, db: 'sales_test' }));
    localStorage.setItem('@369att:user', JSON.stringify({
      uid: u.uid, name: u.name, username: u.username, db: u.db, context: u.user_context || {} }));
    return JSON.stringify({ uid: u.uid, db: u.db });
  })()
`);
check('real login through the proxy', /"uid":5/.test(auth), auth);

await send('Page.reload', { ignoreCache: true });
await waitFor('home', "/Good (morning|afternoon|evening)/.test(document.body.innerText)");
// QuickActions are static and render immediately, so waiting on them races the
// data. Wait for the month strip, which only exists once getHomeData resolves.
await waitFor('home data', "/This month|Present/.test(document.body.innerText)");
await shot('10-home');
const home = await text();
check('Home renders with live data', /Marc Demo/.test(home) && /Quick actions/.test(home));
check('Home month tiles present', /Present/.test(home) && /Leave/.test(home));

// ---- 2. navigate to Leave ------------------------------------------------
check('tap Apply Leave tile', (await tap('Apply Leave')) === 'ok');
await waitFor('leave', "document.body.innerText.includes('Apply, track and cancel')");
await shot('11-leave-list');
const leave = await text();
check('Leave screen opens', /Apply, track and cancel/.test(leave));
check('balance strip shows real quota', /Paid leave/.test(leave) && /Remaining/.test(leave),
  (leave.match(/Paid leave[\s\S]{0,80}/) || [''])[0].replace(/\n/g, ' ').slice(0, 70));
check('request list shows the seeded row', /Casual Leave/.test(leave));
check('state chip rendered', /Pending/.test(leave));

// ---- 3. filter ------------------------------------------------------------
check('tap Rejected filter', (await tap('Rejected')) === 'ok');
await sleep(3500);
const filtered = await text();
check('empty state for a filter with no rows', /No rejected requests/i.test(filtered), '');
await shot('12-filter-empty');
await tap('Show all'); await sleep(3000);
check('Show all restores the list', /Casual Leave/.test(await text()));

// ---- 4. apply sheet + validation -----------------------------------------
check('open apply sheet', (await tap('Apply for leave', false)) === 'ok');
await waitFor('sheet', "document.body.innerText.includes('Leave type')");
await shot('13-apply-sheet');
const sheet = await text();
check('all six leave types offered', ['Casual','Sick','Annual','Personal','Emergency','Other']
  .every((t) => sheet.includes(t)));

// submit empty -> both validation messages
await tap('Submit request', false); await sleep(1800);
const invalid = await text();
check('validation blocks an empty submit',
  /Pick at least a start date/.test(invalid) && /Give a reason/.test(invalid));
await shot('14-validation');

// ---- 5. calendar ----------------------------------------------------------
check('open calendar', (await tap('Dates')) === 'ok');
await waitFor('calendar', "/Select dates/.test(document.body.innerText)");
const calVisible = await ev(`
  (() => {
    const h = [...document.querySelectorAll('div')]
      .find(d => d.children.length === 0 && /\\w+ 20\\d\\d/.test(d.textContent) && d.textContent.length < 20);
    if (!h) return 'no month header';
    const r = h.getBoundingClientRect();
    return JSON.stringify({ label: h.textContent.trim(), visible: r.top >= 0 && r.bottom <= innerHeight });
  })()
`);
check('month header is visible (was clipped off-screen)', /"visible":true/.test(calVisible), calVisible);
await shot('15-calendar');


// ---- 6. pick a date in the calendar --------------------------------------
const picked = await ev(`
  (() => {
    const cells = [...document.querySelectorAll('div')].filter(d =>
      d.children.length === 0 && /^\\d{1,2}$/.test(d.textContent.trim()));
    const target = cells.find(c => c.textContent.trim() === '27');
    if (!target) return 'day 27 not found';
    let n = target;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('tabindex') !== null) {
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
          n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
        return 'ok';
      }
    }
    return 'no pressable ancestor';
  })()
`);
check('tap a day in the calendar', picked === 'ok', picked);
await sleep(1500);
const afterPick = await text();
check('confirm button reflects the selection', /Use 27 Aug 2026/.test(afterPick),
  (afterPick.match(/Use [^\n]*/) || [''])[0]);
await shot('17-date-picked');

check('confirm the date', (await tap('Use 27 Aug 2026', false)) === 'ok');
await waitFor('back on form', "document.body.innerText.includes('Leave type')");
check('date carried back to the form', /27 Aug 2026/.test(await text()));

// ---- 7. real submit -------------------------------------------------------
check('type a reason', (await type('Reason', 'Web-driven functional test')) === 'ok');
await sleep(800);
await shot('18-form-filled');
check('submit', (await tap('Submit request', false)) === 'ok');
await waitFor('list refreshed', "!document.body.innerText.includes('Leave type')", 30000);
await sleep(3500);
const afterSubmit = await text();
check('new request appears in the list', /27 Aug 2026/.test(afterSubmit),
  (afterSubmit.match(/27 Aug 2026[^\n]*/) || [''])[0]);
await shot('19-after-submit');

// ---- 8. overlap -> field + banner ----------------------------------------
await tap('Apply for leave', false);
await waitFor('sheet again', "document.body.innerText.includes('Leave type')");
await tap('Dates');
await waitFor('calendar again', "/Select dates/.test(document.body.innerText)");
await ev(`
  (() => {
    const cells = [...document.querySelectorAll('div')].filter(d =>
      d.children.length === 0 && d.textContent.trim() === '27');
    let n = cells[0];
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('tabindex') !== null) {
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
          n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
        return 'ok';
      }
    }
  })()
`);
await sleep(1200);
await tap('Use 27 Aug 2026', false);
await waitFor('form', "document.body.innerText.includes('Leave type')");
await type('Reason', 'deliberate overlap');
await sleep(600);
await tap('Submit request', false);
await sleep(4000);
const overlap = await text();
check('overlap shows the short marker on the field',
  /These dates overlap an existing request/.test(overlap));
check('overlap shows the full server message in the banner',
  /already exists for overlapping dates/.test(overlap));
await shot('20-overlap');

// ================= WFH =================
// Appended to test-web.mjs. Kept in its own file only because writing it
// through a shell heredoc kept eating the backslashes in these regexes.

// Back to Home. The overlap sheet may still be open, so close it first.
await tap('Close', false);
await sleep(1000);
await ev('history.back()');
await waitFor('home again', "/Good (morning|afternoon|evening)/.test(document.body.innerText)");
await waitFor('home data again', "/This month|Present/.test(document.body.innerText)");
await shot('30-home-wfh-badge');
const homeWfh = await text();
check('WFH badge on the check-in card', /WFH/.test(homeWfh),
  (homeWfh.match(/Not checked in[^\n]*/) || [''])[0]);

check('tap Work From Home tile', (await tap('Work From Home')) === 'ok');
await waitFor('wfh screen', "document.body.innerText.includes('Request a day, track approvals')");
await shot('31-wfh-list');
const wfh = await text();
check('WFH screen opens', /Request a day, track approvals/.test(wfh));
check('today banner shows for an approved WFH day', /working from home today/i.test(wfh));
check('approved request rendered', /Approved/.test(wfh));
check('pending request rendered', /Pending/.test(wfh));
check('WFH filters present',
  ['All', 'Pending', 'Approved', 'Done', 'Rejected'].every((f) => wfh.includes(f)));

check('tap Rejected filter (wfh)', (await tap('Rejected')) === 'ok');
await sleep(3000);
check('wfh empty state', /No rejected requests/i.test(await text()));
await tap('Show all');
await sleep(2500);

check('open WFH sheet', (await tap('Request a WFH day', false)) === 'ok');
await waitFor('wfh sheet', "document.body.innerText.includes('Work from home')");
await shot('32-wfh-sheet');
const wsheet = (await text()).replace(/\n/g, ' ');
check('sheet explains there is no separate WFH button',
  /no separate\s*WFH button/i.test(wsheet));
// The WFH form must NOT carry leave's type chips -- different feature, and the
// route accepts no leave_type at all.
check('no leave-type chips on the WFH form',
  !/Casual/.test(wsheet) && !/Emergency/.test(wsheet));

await tap('Submit request', false);
await sleep(1500);
const winvalid = await text();
check('wfh validation blocks an empty submit',
  /Pick the day/.test(winvalid) && /Give a reason/.test(winvalid));
await shot('33-wfh-validation');

ws.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('  failed: ' + failed.map((f) => f.name).join('; ')); process.exit(1); }
process.exit(0);
