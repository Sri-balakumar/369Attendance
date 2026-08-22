/**
 * One origin in front of Metro and Odoo, so the web build can actually log in.
 *
 * The web build cannot authenticate against Odoo directly: the browser will not
 * send the session_id cookie on a cross-site XHR (SameSite=Lax by default), and
 * fetch is forbidden from setting a Cookie header itself. On a device none of
 * this applies -- React Native has its own cookie jar -- so this is purely a
 * harness for driving the real app in a browser.
 *
 * Everything Odoo owns is proxied to :8069, everything else to Metro on :8081,
 * so to the page it is all http://localhost:8090.
 *
 * Usage: node tools/same-origin-proxy.mjs [proxyPort] [metroPort]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || 8090);
const ODOO = { host: 'localhost', port: 8069 };
// Metro's port is an argument: 8081 is often taken by another project on the
// same machine, and stealing it would kill someone else's dev server.
const METRO = { host: 'localhost', port: Number(process.argv[3] || 8081) };

// Prefixes Odoo owns. Everything else is the app bundle.
const ODOO_PREFIXES = ['/web/', '/leave/', '/wfh/', '/hr_attendance/', '/longpolling/', '/websocket'];
const isOdoo = (url) => ODOO_PREFIXES.some((p) => url === p.slice(0, -1) || url.startsWith(p));

const server = http.createServer((req, res) => {
  const target = isOdoo(req.url) ? ODOO : METRO;
  const headers = { ...req.headers, host: `${target.host}:${target.port}` };

  const upstream = http.request(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers },
    (up) => {
      const out = { ...up.headers };
      // Odoo scopes its cookie to its own host; rewriting the attributes keeps
      // it valid on the proxy origin so the session survives the round trip.
      if (out['set-cookie']) {
        out['set-cookie'] = [].concat(out['set-cookie']).map((c) =>
          c.replace(/;\s*Domain=[^;]+/i, '').replace(/;\s*Secure/i, '')
        );
      }
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    }
  );

  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`proxy error talking to ${target.host}:${target.port} -- ${e.message}`);
  });

  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`same-origin proxy on http://localhost:${PORT}`);
  console.log(`  ${ODOO_PREFIXES.join(', ')} -> Odoo :${ODOO.port}`);
  console.log(`  everything else            -> Metro :${METRO.port}`);
});
