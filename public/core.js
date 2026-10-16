// Shared helpers for the interface: DOM shortcuts, safe HTML, API calls with an optional access token,
// streaming with cancellation, and the colour theme. Nothing here holds application state.
import { parseSse } from '/src/talk/sse.js';

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Missing data, a true zero, and a failure look different. null/undefined/NaN is "No data", never a 0.
export const isNum = x => typeof x === 'number' && Number.isFinite(x);
export const fmt = (x, d = 2) => (isNum(x) ? x.toFixed(d) : '<span class="nodata">No data</span>');
export const sign = x => (!isNum(x) ? '' : x > 0 ? `+${x.toFixed(2)}` : x < 0 ? x.toFixed(2) : '0');
export const pct = x => (isNum(x) ? `${Math.round(x * 100)}%` : '<span class="nodata">No data</span>');
export const when = t => String(t || '').slice(0, 16).replace('T', ' ');

const safe = (fn, d) => { try { return fn(); } catch { return d; } };
export const pref = (k, d) => safe(() => JSON.parse(localStorage.getItem(`stebula.${k}`) ?? localStorage.getItem(`threshold.${k}`)) ?? d, d);
export const setPref = (k, v) => safe(() => localStorage.setItem(`stebula.${k}`, JSON.stringify(v)));

// ---- API ----
export class ApiError extends Error {
  constructor(message, info = {}, status = 0) { super(message); this.name = 'ApiError'; this.info = info; this.status = status; }
}
const headers = extra => { const t = safe(() => localStorage.getItem('stebula.token'), ''); return { ...(t ? { authorization: `Bearer ${t}` } : {}), ...extra }; };
async function failure(r) { const j = await r.json().catch(() => ({})); return new ApiError(j.error || `Request failed (${r.status})`, j, r.status); }

// A server that needs an access token answers 401. Ask once, remember it for this browser, and retry.
const askToken = () => { const t = typeof prompt === 'function' ? prompt('This server needs an access token (STEBULA_TOKEN). Enter it:') : null; if (t) safe(() => localStorage.setItem('stebula.token', t.trim())); return Boolean(t); };
export async function api(path, body, { signal } = {}, retried = false) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body), signal });
  if (r.status === 401 && !retried && askToken()) return api(path, body, { signal }, true);
  if (!r.ok) throw await failure(r);
  return r.json();
}

// POST that answers with server-sent events. onEvent(stage, data) runs for every event. An "error" event or a
// dropped connection becomes an ApiError after the stream ends; an abort rejects with name "AbortError".
export async function stream(path, body, onEvent, { signal } = {}, retried = false) {
  const r = await fetch(path, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify(body), signal });
  if (r.status === 401 && !retried && askToken()) return stream(path, body, onEvent, { signal }, true);
  if (!r.ok) throw await failure(r);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', failed = null, finished = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const p = parseSse(buf + dec.decode(value, { stream: true }));
    buf = p.rest;
    for (const { stage, data } of p.events) {
      if (stage === 'error') { failed = data; continue; }
      if (stage === 'done' || stage === 'finished' || stage === 'cancelled' || stage === 'stopped') finished = true;
      await onEvent(stage, data);
    }
  }
  if (failed) throw new ApiError(failed.error || 'The request failed.', failed, 502);
  return { finished };
}

// ---- config and theme ----
export const config = { value: null };
export async function loadConfig() { try { config.value = await api('/api/config'); } catch { config.value = { live: false, model: null }; } return config.value; }

const THEMES = ['auto', 'light', 'dark'];
export function applyTheme(p) {
  const dark = p === 'dark' || (p === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('#themeBtn'); if (b) b.textContent = `Theme: ${p}`;
}
export function initTheme() {
  let p = safe(() => localStorage.getItem('stebula.theme'), 'auto') || 'auto';
  applyTheme(p);
  $('#themeBtn').onclick = () => { p = THEMES[(THEMES.indexOf(p) + 1) % THEMES.length]; safe(() => localStorage.setItem('stebula.theme', p)); applyTheme(p); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => p === 'auto' && applyTheme(p));
}

// Roving tab behaviour for tablists: arrow keys move between tabs.
export function tabKeys(list) {
  list.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = $$('[role=tab]', list), i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[n].focus(); tabs[n].click();
  });
}

// Minimal markdown for the documents in docs/: headings, lists, code, bold, links. Escapes everything first.
export function markdown(md) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
  const out = []; let list = null, para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } if (list) { out.push(`</${list}>`); list = null; } };
  for (const line of String(md).replace(/\r/g, '').split('\n')) {
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(line))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = /^\s*(?:[-*]|\d+\.)\s+(.*)/.exec(line))) { const t = /^\s*\d/.test(line) ? 'ol' : 'ul'; if (list !== t) { flush(); out.push(`<${t} class="list">`); list = t; } out.push(`<li>${inline(m[1])}</li>`); }
    else if (!line.trim()) flush();
    else if (/^\|/.test(line)) { /* tables are left to the downloadable file */ }
    else { if (list) flush(); para.push(line.trim()); }
  }
  flush();
  return out.join('\n');
}
