// A tiny browser driver for checking the real interface. It starts headless Chrome or Edge and talks to it over the
// DevTools protocol with Node's built-in WebSocket, so the project needs no dependency. Used by scripts/ui-check.js.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
export const findChrome = () => CANDIDATES.find(p => existsSync(p)) || null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function launch({ width = 1366, height = 850, mobile = false, dark = false } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('No Chrome or Edge found. Set CHROME to the browser executable.');
  const dir = await mkdtemp(join(tmpdir(), 'chrome-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', `--window-size=${width},${height}`, ...(dark ? ['--force-dark-mode'] : []), 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch { /* starting */ } await sleep(250); }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(), errors = [], listeners = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    for (const l of listeners) l(m);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (dark) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const page = {
    errors,
    evaluate,
    async goto(url) { await send('Page.navigate', { url }); await sleep(300); await page.waitFor('document.readyState === "complete"', 15000); },
    async waitFor(cond, timeout = 8000, label = cond) {
      const t0 = Date.now();
      for (;;) { try { if (await evaluate(`Boolean(${cond})`)) return true; } catch { /* page still loading */ } if (Date.now() - t0 > timeout) throw new Error(`Timed out waiting for: ${label}`); await sleep(100); }
    },
    q: (sel, prop = 'textContent') => evaluate(`document.querySelector(${JSON.stringify(sel)})?.${prop} ?? null`),
    exists: sel => evaluate(`Boolean(document.querySelector(${JSON.stringify(sel)}))`),
    count: sel => evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`),
    visible: sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })()`),
    click: sel => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('No element ${sel.replace(/'/g, '')}'); e.scrollIntoView({block:'center'}); e.click(); return true; })()`),
    // Real mouse click at the element's centre, so layout problems (an element covered by another) show up.
    async mouse(sel) {
      const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(${JSON.stringify(sel)}) !== null }; })()`);
      if (!box) throw new Error(`No element ${sel}`);
      if (!box.hit) throw new Error(`Element ${sel} is covered by something else at its centre`);
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    },
    async type(sel, text) { await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event('input', {bubbles:true})); })()`); },
    async key(key, { shift = false } = {}) {
      const codes = { Tab: 9, Enter: 13, Escape: 27, ArrowRight: 39, ArrowLeft: 37, ' ': 32 };
      const base = { key, code: key, windowsVirtualKeyCode: codes[key] || key.charCodeAt(0), modifiers: shift ? 8 : 0 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key === 'Enter' ? '\r' : key.length === 1 ? key : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async screenshot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(file, Buffer.from(r.data, 'base64')); return file; },
    async close() { try { ws.close(); } catch { /* closed */ } proc.kill(); await sleep(300); await rm(dir, { recursive: true, force: true }).catch(() => {}); },
  };
  return page;
}
