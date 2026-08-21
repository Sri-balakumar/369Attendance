/**
 * Server-URL handling. The normalisation here mirrors what is already proven
 * against real Odoo servers in the sibling 369Application app: users type
 * "erp.company.com" or paste "1.2.3.4.8069", and both must become something
 * fetch() will accept.
 */

// True once the text is plausibly a host — used to decide when to start the
// debounced database lookup. Deliberately loose: it gates a network call, not
// the Continue button.
export function looksLikeUrl(value) {
  const v = String(value || '').trim();
  if (v.length < 4) return false;
  const withoutScheme = v.replace(/^https?:\/\//i, '');
  if (!withoutScheme) return false;
  const host = withoutScheme.split('/')[0];
  // host.tld, an IPv4 with or without a port, or localhost[:port]
  return (
    /^localhost(:\d+)?$/i.test(host) ||
    /^\d{1,3}(\.\d{1,3}){3}([.:]\d+)?$/.test(host) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host)
  );
}

/**
 * True for addresses that cannot have a public TLS certificate: localhost,
 * the private IPv4 ranges, and .local names. Defaulting those to https means
 * an on-premise Odoo on the office LAN never connects, which is the common
 * case for this app.
 */
function isLocalHost(host) {
  const h = String(host || '').toLowerCase().split(':')[0];
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.endsWith('.local') ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function normalizeUrl(value) {
  let v = String(value || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) {
    const host = v.split('/')[0];
    v = `${isLocalHost(host) ? 'http' : 'https'}://${v}`;
  }
  // "1.2.3.4.8069" is a mistyped port, not a hostname — repair it rather than
  // letting the request fail with an unhelpable DNS error.
  v = v.replace(/^(https?:\/\/\d{1,3}(?:\.\d{1,3}){3})\.(\d+)/i, '$1:$2');
  return v.replace(/\/+$/, '');
}

// "https://erp.company.com:8069/odoo" -> "erp.company.com:8069" for chips.
export function prettyHost(value) {
  return String(value || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '');
}
