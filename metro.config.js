// Metro must not watch the Odoo addon tree or the database dumps that live
// beside this app in the same folder. `_db_backup` alone holds multi-hundred-MB
// .dump files; leaving them in the watch set makes `expo start` crawl and can
// exhaust the file-watcher limit outright.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Inlined rather than pulling in escape-string-regexp: that package is ESM-only
// from v5 and cannot be require()'d from this CommonJS config.
const escapeRe = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

const blocked = ['odoo_modules', '_db_backup'].map(
  (dir) => new RegExp(`^${escapeRe(path.join(projectRoot, dir))}[\\\\/].*$`)
);

const existing = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
  ...blocked,
];

module.exports = config;
