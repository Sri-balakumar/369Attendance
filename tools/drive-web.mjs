/**
 * Drive the Expo web build over the Chrome DevTools Protocol and screenshot it.
 *
 * No Playwright/Puppeteer in this project and no network to install them, so
 * this talks CDP directly over Node 22's built-in WebSocket. Edge must already
 * be running with --remote-debugging-port.
 *
 * Usage: node tools/drive-web.mjs <port> <outDir>
 */
const PORT = process.argv[2] || '9222';
const OUT = process.argv[3] || '.shots';
const APP = 'http://localhost:8081/';

const fs = await import('node:fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- attach to the page target -------------------------------------------
let target;
for (let i = 0; i < 30; i++) {
  try {
    const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {}
  await sleep(1000);
}
if (!target) { console.error('no debuggable page target'); process.exit(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(method + ' timed out')); } }, 60000);
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval threw');
  return r.result?.value;
};

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, 'base64'));
  console.log(`  shot: ${name}.png`);
};

/** Wait until a predicate over document.body.innerText holds. Fixed sleeps
 *  race the bundle on a cold Metro start; this does not. */
const waitFor = async (label, testExpr, timeoutMs = 90000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evaluate(testExpr)) { console.log(`  ready: ${label}`); return true; } } catch {}
    await sleep(1000);
  }
  console.log(`  TIMEOUT waiting for ${label}`);
  return false;
};

await send('Page.enable');
await send('Runtime.enable');
// Metro runs with CI=1 here (reloads disabled), so the page will happily serve
// a stale bundle and every result becomes ambiguous. Always bypass the cache.
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

// ---- boot straight to Home by seeding storage ----------------------------
// AsyncStorage is localStorage on web, so the session the app would normally
// build through Server -> Login can be planted directly. This is about seeing
// the Leave SCREEN; the login flow itself is already covered elsewhere.
await send('Page.navigate', { url: APP });
await sleep(6000);
await evaluate(`
  localStorage.setItem('@369att:server', JSON.stringify({url:'http://localhost:8069', db:'sales_test'}));
  localStorage.setItem('@369att:user', JSON.stringify({uid:5, name:'Marc Demo', username:'demo', db:'sales_test', context:{}}));
  true;
`);
await send('Page.reload', { ignoreCache: true });
await waitFor('home', "/Good (morning|afternoon|evening)/.test(document.body.innerText)");
await waitFor('quick actions', "document.body.innerText.includes('Apply Leave')");
await shot('02-home');

// ---- find and press the Apply Leave tile ---------------------------------
// RNW renders real DOM, so the tile is findable by its label text. Walk up to
// the pressable ancestor, because the text node itself has no handler.
const tapped = await evaluate(`
  (() => {
    const hit = [...document.querySelectorAll('div,span')]
      .find(el => el.textContent.trim() === 'Apply Leave' && el.children.length === 0);
    if (!hit) return 'tile not found';
    let n = hit;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (n.getAttribute && (n.getAttribute('tabindex') !== null || n.className?.toString().includes('css-'))) {
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
          n.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true, view:window})));
        return 'tapped: ' + n.tagName;
      }
    }
    return 'no pressable ancestor';
  })()
`);
console.log('  tile:', tapped);
await waitFor('leave screen', "document.body.innerText.includes('Apply, track and cancel')");
await shot('03-leave');

// ---- report what actually rendered ---------------------------------------
const seen = await evaluate(`
  (() => {
    const t = document.body.innerText;
    return {
      heading: t.split('\\n').slice(0,6).join(' | '),
      hasLeave: /Leave/.test(t),
      hasFilters: ['All','Pending','Approved','Rejected','Cancelled'].filter(f => t.includes(f)),
      hasApplyBtn: /Apply for leave/i.test(t),
      balance: /Paid leave|quota|balance/i.test(t),
    };
  })()
`);
console.log('  rendered:', JSON.stringify(seen));

// ---- open the apply sheet ------------------------------------------------
const opened = await evaluate(`
  (() => {
    const hit = [...document.querySelectorAll('div,span')]
      .find(el => /Apply for leave/i.test(el.textContent) && el.children.length === 0);
    if (!hit) return 'button not found';
    let n = hit;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('tabindex') !== null) {
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
          n.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true, view:window})));
        return 'opened';
      }
    }
    return 'no pressable ancestor';
  })()
`);
console.log('  apply sheet:', opened);
await waitFor('sheet', "document.body.innerText.includes('Leave type')");
await shot('04-apply-sheet');

// ---- open the calendar ---------------------------------------------------
const cal = await evaluate(`
  (() => {
    const hit = [...document.querySelectorAll('div,span')]
      .find(el => el.textContent.trim() === 'Dates' && el.children.length === 0);
    if (!hit) return 'dates field not found';
    let n = hit;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) {
      if (n.getAttribute && n.getAttribute('tabindex') !== null) {
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t =>
          n.dispatchEvent(new MouseEvent(t, {bubbles:true, cancelable:true, view:window})));
        return 'opened';
      }
    }
    return 'no pressable ancestor';
  })()
`);
console.log('  calendar:', cal);
await waitFor('calendar', "/Select dates/.test(document.body.innerText)");
await shot('05-calendar');

console.log('done');
ws.close();
process.exit(0);
