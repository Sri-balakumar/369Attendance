/**
 * Drive the app on a real Android device over adb, by touch.
 *
 * The browser harness (test-web.mjs) cannot reach anything native, so this one
 * reads the screen with `uiautomator dump`, taps by visible text with
 * `input tap`, and pulls screenshots into .shots/device/. Nothing is mocked:
 * every step is a real touch on the real app against the real Odoo.
 *
 * Traps this encodes (see SESSION.md §7): uiautomator returns a STALE dump if
 * the file already exists, so it is deleted first; Git Bash rewrites /sdcard
 * paths unless MSYS_NO_PATHCONV=1; and screenshots are captured on-device and
 * pulled, never redirected through a Windows shell.
 *
 * Usage (one command per call, so a run can be steered from a shell):
 *   node tools/test-device.mjs dump                 -- visible texts
 *   node tools/test-device.mjs tap "Leave Balances" -- tap by text (substring)
 *   node tools/test-device.mjs tapx "Add" [n]       -- exact text, nth match
 *   node tools/test-device.mjs wait "Comp off" [ms] -- poll until text appears
 *   node tools/test-device.mjs gone "Loading" [ms]  -- poll until text is gone
 *   node tools/test-device.mjs type "hello world"   -- type into focused input
 *   node tools/test-device.mjs clear                -- select all + delete
 *   node tools/test-device.mjs back
 *   node tools/test-device.mjs shot 03-balances
 *   node tools/test-device.mjs swipe up|down
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

process.env.MSYS_NO_PATHCONV = '1';
const OUT = 'screenshots';
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 1 << 26 });
const sh = (cmd) => adb('shell', cmd);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const unesc = (s) =>
  s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#10;/g, '\n');

/** Every node with a text or content-desc, with its centre. */
function dump() {
  // uiautomator refuses to dump while the window is mid-transition (a reload,
  // a navigation animation); the file is then absent. Wait it out.
  let xml = '';
  for (let i = 0; i < 8 && !xml; i++) {
    try {
      xml = sh('rm -f /sdcard/u.xml; uiautomator dump /sdcard/u.xml >/dev/null 2>&1; cat /sdcard/u.xml');
    } catch {
      execFileSync('adb', ['shell', 'sleep 1']);
    }
  }
  const nodes = [];
  const re = /<node [^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, text, desc, x1, y1, x2, y2] = m;
    const label = unesc(text || desc);
    if (!label) continue;
    const w = +x2 - +x1, h = +y2 - +y1;
    if (w <= 0 || h <= 0) continue;
    nodes.push({ label, x: (+x1 + +x2) >> 1, y: (+y1 + +y2) >> 1, w, h });
  }
  return nodes;
}

const find = (text, exact, nth = 0) =>
  dump().filter((n) => (exact ? n.label === text : n.label.includes(text)))[nth] || null;

async function waitFor(text, ms = 20000, want = true) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = Boolean(find(text, false));
    if (hit === want) return true;
    await sleep(700);
  }
  return false;
}

function shot(name) {
  fs.mkdirSync(OUT, { recursive: true });
  sh('screencap -p /sdcard/s.png');
  adb('pull', '/sdcard/s.png', `${OUT}/${name}.png`);
  return `${OUT}/${name}.png`;
}

const [, , cmd, a1, a2] = process.argv;
let ok = true;
switch (cmd) {
  case 'dump':
    console.log(dump().map((n) => n.label).join('\n'));
    break;
  case 'tap':
  case 'tapx': {
    const n = find(a1, cmd === 'tapx', Number(a2) || 0);
    if (!n) { console.log(`FAIL: no "${a1}" on screen`); ok = false; break; }
    sh(`input tap ${n.x} ${n.y}`);
    console.log(`tapped "${n.label}" @${n.x},${n.y}`);
    break;
  }
  case 'wait':
    ok = await waitFor(a1, Number(a2) || 20000, true);
    console.log(ok ? `seen "${a1}"` : `FAIL: never saw "${a1}"`);
    break;
  case 'gone':
    ok = await waitFor(a1, Number(a2) || 20000, false);
    console.log(ok ? `gone "${a1}"` : `FAIL: still showing "${a1}"`);
    break;
  case 'type':
    sh(`input text '${a1.replace(/'/g, '').replace(/ /g, '%s')}'`);
    break;
  case 'clear':
    // Ctrl+A (meta 4096) then DEL.
    sh('input keyevent --longpress KEYCODE_MOVE_END; input keyevent KEYCODE_MOVE_END');
    for (let i = 0; i < (Number(a1) || 40); i++) sh('input keyevent KEYCODE_DEL');
    break;
  case 'back':
    sh('input keyevent 4');
    break;
  case 'swipe': {
    const size = sh('wm size').match(/(\d+)x(\d+)/);
    const W = +size[1], H = +size[2];
    if (a1 === 'down') sh(`input swipe ${W >> 1} ${H * 0.35 | 0} ${W >> 1} ${H * 0.8 | 0} 400`);
    else sh(`input swipe ${W >> 1} ${H * 0.8 | 0} ${W >> 1} ${H * 0.35 | 0} 400`);
    break;
  }
  case 'shot':
    console.log(shot(a1 || 'shot'));
    break;
  default:
    console.log('unknown command');
    ok = false;
}
process.exit(ok ? 0 : 1);
