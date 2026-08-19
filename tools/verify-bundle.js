/**
 * The three-part bundle check.
 *
 * `expo export` compiles modules but never EVALUATES them, so a module-scope
 * ReferenceError passes the build and then dies at launch. That has shipped
 * twice here, both times a theme value used inside a module-level
 * StyleSheet.create, where nothing destructured from useTheme() is in scope.
 *
 * So: parse everything, then actually RUN everything against stubbed native
 * modules, and only then export. Part 2 is the one that earns its keep --
 * do not drop it because part 3 passed.
 *
 * Usage: npm run verify        (part 3 is run separately, see README of this file)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parser = require('@babel/parser');
const babel = require('@babel/core');

const ROOT = process.cwd();
const ENTRIES = ['App.js', 'index.js'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = [
  ...ENTRIES.filter((f) => fs.existsSync(path.join(ROOT, f))).map((f) => path.join(ROOT, f)),
  ...walk(path.join(ROOT, 'src')),
];
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

/* ---------------------------------------------------------------- *
 * Part 1 -- parse
 * ---------------------------------------------------------------- */
let failed = 0;
console.log(`\n[1/3] Parsing ${files.length} files`);
for (const f of files) {
  try {
    parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
  } catch (e) {
    console.log(`  PARSE FAIL  ${rel(f)}:${e.loc ? e.loc.line : '?'}  ${e.message}`);
    failed++;
  }
}
if (failed) { console.log(`\n${failed} file(s) failed to parse.`); process.exit(1); }
console.log('  all parsed');

/* ---------------------------------------------------------------- *
 * Part 2 -- execute, with native deps stubbed
 * ---------------------------------------------------------------- */
console.log(`\n[2/3] Executing modules with stubbed native deps`);

// A Proxy that tolerates any property access, call, or JSX use. Anything the
// app reads off a native module returns another stub rather than undefined,
// so evaluation reaches the module-scope code we actually want to test.
const makeStub = (name) => {
  const fn = function () { return makeStub(name + '()'); };
  fn.displayName = name;
  return new Proxy(fn, {
    get(t, prop) {
      if (prop === 'default') return makeStub(name + '.default');
      if (prop === '__esModule') return true;
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => name;
      if (prop === Symbol.iterator) return function* () {};
      if (prop in t) return t[prop];
      return makeStub(`${name}.${String(prop)}`);
    },
    apply() { return makeStub(name + '()'); },
    construct() { return makeStub('new ' + name); },
  });
};

// react-native needs REAL behaviour in the few places module scope depends on
// it. StyleSheet.create especially: if it were a stub that swallowed its
// argument, the object literal would never be evaluated and part 2 would catch
// nothing -- which is the entire point of this pass.
const reactNativeStub = new Proxy({
  StyleSheet: {
    create: (o) => { JSON.stringify(Object.keys(o)); return o; },
    absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    absoluteFill: 0,
    hairlineWidth: 1,
    flatten: (s) => s,
  },
  Platform: { OS: 'android', select: (o) => (o && ('android' in o ? o.android : o.default)), Version: 34 },
  Dimensions: { get: () => ({ width: 412, height: 915, scale: 2.625, fontScale: 1 }) },
  Appearance: { getColorScheme: () => 'light', addChangeListener: () => ({ remove() {} }) },
  BackHandler: { addEventListener: () => ({ remove() {} }) },
  Animated: makeStub('Animated'),
  Easing: makeStub('Easing'),
  I18nManager: { isRTL: false },
  PixelRatio: { get: () => 2.625, roundToNearestPixel: (n) => n },
}, {
  get(t, prop) {
    if (prop in t) return t[prop];
    if (prop === '__esModule') return true;
    return makeStub(`RN.${String(prop)}`);
  },
});

const STUBS = {
  'react-native': reactNativeStub,
  react: new Proxy({
    createElement: () => null,
    Fragment: 'Fragment',
    forwardRef: (f) => f,
    memo: (f) => f,
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(),
    useRef: (v) => ({ current: v }), useContext: () => ({}),
  }, { get(t, p) { return p in t ? t[p] : (p === '__esModule' ? true : makeStub('React.' + String(p))); } }),
};

const cache = new Map();
function resolve(from, request) {
  if (!request.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), request);
  for (const cand of [base, base + '.js', path.join(base, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function load(file, stack = []) {
  if (cache.has(file)) return cache.get(file);
  if (stack.includes(file)) return {};              // circular import: hand back a partial
  const module = { exports: {} };
  cache.set(file, module.exports);

  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false, configFile: false,
    presets: [['babel-preset-expo', { jsxRuntime: 'classic' }]],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;

  const req = (request) => {
    const target = resolve(file, request);
    if (target) return load(target, [...stack, file]);
    if (STUBS[request]) return STUBS[request];
    return makeStub(request);
  };

  const sandbox = {
    module, exports: module.exports, require: req,
    console, process, setTimeout, clearTimeout, setInterval, clearInterval,
    __DEV__: true, global: {}, Intl,
  };
  sandbox.global = sandbox;
  vm.runInNewContext(code, vm.createContext(sandbox), { filename: file });
  cache.set(file, module.exports);
  return module.exports;
}

let evaluated = 0, execFailed = 0;
for (const f of files) {
  try { load(f); evaluated++; }
  catch (e) {
    console.log(`  EXEC FAIL   ${rel(f)}`);
    console.log(`              ${e.name}: ${e.message}`);
    const line = (e.stack || '').split('\n').find((l) => l.includes(rel(f).split('/').pop()));
    if (line) console.log(`              ${line.trim()}`);
    execFailed++;
  }
}
console.log(`  ${evaluated} module(s) evaluated, ${execFailed} failed`);
if (execFailed) process.exit(1);

console.log(`\n[3/3] Run the export separately, capturing the REAL exit code:`);
console.log(`  npx expo export --platform android --output-dir dist > export.log 2>&1; echo "EXIT:$?"`);
console.log(`  (never pipe it -- $? after a pipeline is the LAST command's status,`);
console.log(`   which is how a failing export previously read as green)\n`);
console.log('Parts 1 and 2 passed.');
