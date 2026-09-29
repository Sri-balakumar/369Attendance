// Drive a Chromium over CDP with a list of steps from a JSON file.
// usage: node webdrive.mjs <port> <steps.json>
// step: {goto}, {wait}, {waitFor: selector, timeout?}, {waitText: text, timeout?},
//       {click: selector}, {clickText: text}, {type: [selector, text]}, {eval: js},
//       {shot: path}, {log: js}
import fs from 'node:fs';
const [port, file] = process.argv.slice(2);
const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://localhost:${port}/json/list`)).json();
let target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
if (!target) {
  target = await (await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' })).json();
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (js) => {
  const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
};
await send('Page.enable'); await send('Runtime.enable');
// Default to the Galaxy Tab A (SM-T510): 800x1280 CSS px at 1.5x = 1200x1920 images, like adb screencap.
const W = Number(process.env.VIEW_W || 800), H = Number(process.env.VIEW_H || 1280), DPR = Number(process.env.DPR || 1.5);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: process.env.MOBILE !== '0' });
await send('Emulation.setTouchEmulationEnabled', { enabled: false });

const waitUntil = async (js, timeout, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evaluate(js)) return; await sleep(250); }
  throw new Error('timeout waiting for ' + what);
};
const q = (s) => JSON.stringify(s);
// Visible element whose own text contains `text` (buttons, links, menu items).
const byText = (text) => `([...document.querySelectorAll('button, a, .dropdown-item, .o_menu_sections a, .o-dropdown-item, span, div')].find(e => e.offsetParent !== null && e.children.length < 3 && (e.innerText || '').trim().startsWith(${q(text)})) || [...document.querySelectorAll('button, a, [role=menuitem], .dropdown-toggle')].find(e => e.offsetParent !== null && (e.innerText || '').trim() === ${q(text)}))`;

for (const step of steps) {
  const key = Object.keys(step)[0];
  try {
    // ---- React Native Web (the app's web build through the same-origin proxy) ----
    if (key === 'appLogin') {
      // Same trick as tools/test-web.mjs: a real Odoo session through the
      // proxy, then the app's own storage keys, then reload straight to Home.
      const [user, pass, db, origin] = step.appLogin;
      const base = origin || 'http://localhost:8090';
      await send('Page.navigate', { url: base + '/' }); await sleep(4000);
      const r = await evaluate(`(async () => {
        const r = await fetch('/web/session/authenticate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: ${q(db || '369application')}, login: ${q(user)}, password: ${q(pass)} } }) });
        const b = await r.json(); const u = b.result || {};
        if (!u.uid) return 'AUTH FAILED ' + JSON.stringify(b.error && b.error.data && b.error.data.message);
        localStorage.setItem('@369att:server', JSON.stringify({ url: location.origin, db: ${q(db || '369application')} }));
        localStorage.setItem('@369att:user', JSON.stringify({ uid: u.uid, name: u.name, username: u.username, db: u.db, context: u.user_context || {} }));
        return 'uid ' + u.uid;
      })()`);
      console.log('APP_LOGIN', user, r);
      if (!/^uid /.test(r)) throw new Error(r);
      await send('Page.reload', { ignoreCache: true }); await sleep(3000);
      await waitUntil(`/Good (morning|afternoon|evening)/.test(document.body.innerText)`, 60000, 'app home');
      await sleep(2500);
    }
    else if (key === 'appLogout') {
      await evaluate(`(async () => { try { await fetch('/web/session/destroy', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","method":"call","params":{}}' }); } catch (e) {} localStorage.clear(); return true; })()`);
      await sleep(500);
    }
    else if (key === 'tap' || key === 'tapPart') {
      // Visible leaf text, then the nearest pressable (tabindex) ancestor, with
      // the pointer/mouse sequence React Native Web's Pressable listens for.
      const want = step[key], exact = key === 'tap', nth = step.nth || 0;
      const r = await evaluate(`(() => {
        const hits = [...document.querySelectorAll('div,span')].filter(el => el.children.length === 0 &&
          (${exact} ? el.textContent.trim() === ${q(want)} : el.textContent.includes(${q(want)})))
          .filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
        const hit = hits[${nth}];
        if (!hit) return 'NOT FOUND (visible): ' + ${q(want)};
        let n = hit;
        for (let i = 0; i < 10 && n; i++, n = n.parentElement) {
          if (n.getAttribute && (n.getAttribute('tabindex') !== null || n.getAttribute('role') === 'button')) {
            ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
            return 'ok';
          }
        }
        hit.click(); return 'clicked text (no pressable ancestor)';
      })()`);
      if (!/^ok|^clicked/.test(r)) throw new Error(r);
    }
    else if (key === 'rntype') {
      // A React-controlled field: native value setter + real input event.
      const [label, value] = step.rntype;
      const r = await evaluate(`(() => {
        const fields = [...document.querySelectorAll('input,textarea')].filter(f => { const b = f.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
        let f = fields.find(el => ((el.closest('div') || {}).parentElement || {}).textContent?.includes(${q(label)}));
        if (!f && ${q(label)} === 'password') f = fields.find(el => el.type === 'password');
        if (!f && /^\\d+$/.test(${q(label)})) f = fields[Number(${q(label)})];
        if (!f) return 'NO FIELD ' + ${q(label)};
        f.focus();
        const proto = f.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(f, ${q(value)});
        f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok';
      })()`);
      if (r !== 'ok') throw new Error(r);
    }
    else if (key === 'press') {
      // Pointer/mouse sequence on a selector match (icon-only buttons, e.g. [aria-label="Back"]).
      const r = await evaluate(`(() => { const els = [...document.querySelectorAll(${q(step.press)})].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }); const n = els[${step.nth || 0}]; if (!n) return 'NOT FOUND ' + ${q(step.press)};
        ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => n.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); return 'ok'; })()`);
      if (r !== 'ok') throw new Error(r);
    }
    else if (key === 'waitBody') await waitUntil(`document.body.innerText.includes(${q(step.waitBody)})`, step.timeout || 30000, 'body text ' + step.waitBody);
    else if (key === 'waitGone') await waitUntil(`!document.body.innerText.includes(${q(step.waitGone)})`, step.timeout || 30000, 'body text gone ' + step.waitGone);
    else if (key === 'body') console.log('BODY', JSON.stringify((await evaluate(`document.body.innerText`)).replace(/\n+/g, ' | ').slice(0, step.body || 600)));
    else if (key === 'login') {
      // Odoo's website login page re-renders shortly after load and can wipe
      // typed values, so verify the fields before submitting and retry.
      const [user, pass, url] = step.login;
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        // `login=` in the URL makes Odoo render the plain form instead of its
        // remembered-users switch, which hides the form and resets the fields.
        await send('Page.navigate', { url: (url || 'http://localhost:8069/web/login?db=369application') + '&login=' + encodeURIComponent(user) });
        await sleep(2500);
        await evaluate(`(() => { try { localStorage.clear(); } catch (e) {} return true; })()`);
        await waitUntil(`!!document.querySelector('form.oe_login_form input[name=login]')`, 20000, 'login form');
        await sleep(1500);
        for (const [sel, text] of [['input[name=login]', user], ['input[name=password]', pass]]) {
          await evaluate(`(() => { const e = document.querySelector(${q(sel)}); e.focus(); e.value = ''; return true; })()`);
          await send('Input.insertText', { text });
          await evaluate(`(() => { const e = document.querySelector(${q(sel)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        }
        await sleep(300);
        const vals = await evaluate(`[document.querySelector('input[name=login]').value, document.querySelector('input[name=password]').value.length]`);
        if (vals[0] !== user || vals[1] !== pass.length) { console.log('LOGIN retry: fields were reset', JSON.stringify(vals), 'formHidden=' + await evaluate(`document.querySelector('form.oe_login_form').classList.contains('d-none')`)); continue; }
        await evaluate(`(() => { document.querySelector('form.oe_login_form button[type=submit]').click(); return true; })()`);
        const t0 = Date.now();
        while (Date.now() - t0 < 60000) {
          const st = await evaluate(`({client: !!document.querySelector('.o_web_client .o_main_navbar'), login: !!document.querySelector('form.oe_login_form'), err: (document.querySelector('.alert-danger') || {}).innerText || ''})`).catch(() => null);
          if (st && st.client) { done = true; break; }
          if (st && st.login && st.err) { console.log('LOGIN_ERR', st.err); break; }
          await sleep(500);
        }
      }
      if (!done) throw new Error('login failed for ' + user);
      await sleep(2000);
    }
    else if (key === 'goto') { await send('Page.navigate', { url: step.goto }); await sleep(1500); await waitUntil(`document.readyState === 'complete'`, 30000, 'load'); }
    else if (key === 'wait') await sleep(step.wait);
    else if (key === 'waitFor') await waitUntil(`!!document.querySelector(${q(step.waitFor)})`, step.timeout || 20000, step.waitFor);
    else if (key === 'waitText') await waitUntil(`!!(${byText(step.waitText)})`, step.timeout || 20000, 'text ' + step.waitText);
    else if (key === 'click') await evaluate(`(() => { const e = document.querySelector(${q(step.click)}); if (!e) throw new Error('no ' + ${q(step.click)}); e.click(); return true; })()`);
    else if (key === 'clickText') await evaluate(`(() => { const e = ${byText(step.clickText)}; if (!e) throw new Error('no text ' + ${q(step.clickText)}); e.click(); return true; })()`);
    else if (key === 'type') {
      const [sel, text] = step.type;
      await evaluate(`(() => { const e = document.querySelector(${q(sel)}); if (!e) throw new Error('no ' + ${q(sel)}); e.focus(); e.value = ''; return true; })()`);
      await send('Input.insertText', { text });
      await evaluate(`(() => { const e = document.querySelector(${q(sel)}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    }
    else if (key === 'eval') await evaluate(step.eval);
    else if (key === 'log') console.log('LOG', JSON.stringify(await evaluate(step.log)));
    else if (key === 'shot') { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(step.shot, Buffer.from(r.data, 'base64')); console.log('SHOT', step.shot); }
    else throw new Error('unknown step ' + key);
  } catch (e) {
    console.log('FAIL at step', JSON.stringify(step), '->', e.message);
    if (step.shot === undefined) { try { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('fail.png', Buffer.from(r.data, 'base64')); } catch {} }
    if (!step.optional) process.exit(1);
  }
}
ws.close();
