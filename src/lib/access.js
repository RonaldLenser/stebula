// Who may use the live (paid, data-changing) parts of the server.
//  - Default: bound to 127.0.0.1, so only this computer can reach it. Host and Origin headers are checked so a web
//    page on another site cannot drive a local server through the browser.
//  - If HOST is set to a network address, a STEBULA_TOKEN is required for every /api call except the public ones.
//  - STEBULA_PUBLIC=1 serves the app for replay only: no live calls, no stored conversations, no exports.
import { timingSafeEqual } from 'node:crypto';

export const isLoopback = host => /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/i.test(String(host || ''));
const hostOnly = h => String(h || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function makeAccess({ host = '127.0.0.1', token = '', publicMode = false, allowedHosts = [] } = {}) {
  const loopback = isLoopback(host);
  const allowed = new Set(['localhost', '127.0.0.1', '::1', ...allowedHosts.map(h => h.toLowerCase())]);
  return {
    host, loopback, publicMode, tokenRequired: Boolean(token) || (!loopback && !publicMode),
    // Browsers always send Host. A rebinding attack arrives with a foreign Host name.
    hostOk(req) { return !loopback || allowed.has(hostOnly(req.headers.host).toLowerCase()); },
    // A cross-site request carries an Origin that differs from the server's own address.
    originOk(req) { const o = req.headers.origin; if (!o) return true; try { return new URL(o).host === req.headers.host; } catch { return false; } },
    // null when allowed, otherwise { status, message }.
    deny(req) {
      if (publicMode) return { status: 403, message: 'This is a public replay server. Live conversation, readings, and experiments are turned off.' };
      if (!loopback && !token) return { status: 403, message: 'This server is reachable from the network but STEBULA_TOKEN is not set, so live operations are off. Set a token in .env, or bind to 127.0.0.1.' };
      if (token) {
        const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-stebula-token'] || '';
        if (!given || !safeEq(given, token)) return { status: 401, message: 'A access token is required.'.replace('A access', 'An access') };
      }
      return null;
    },
  };
}
