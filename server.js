// Tiny no-dependency server: serves the app and proxies LLM calls so the API key stays server-side.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './scripts/env.js';
import { makeNodeLLM } from './src/agents/transport-node.js';
import { rename } from 'node:fs/promises';
import { sseFrame } from './src/talk/sse.js';
import { digestText, runBaseline } from './src/talk/digest.js';
import { makeTalkStore, talkTurn, talkAudit, talkSelfTest, talkReflect, needsReflection, freshTalkMemory } from './src/talk/session.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 5173);
const LIVE = Boolean(process.env.ANTHROPIC_API_KEY);
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
const llm = LIVE ? makeNodeLLM() : null;
const VERSION = process.env.STEBULA_VERSION || 'dev';
const DATA = path.join(ROOT, 'data');
const talk = makeTalkStore(DATA);
const NO_KEY = 'Talk needs a live model. Add ANTHROPIC_API_KEY to .env and restart. Scripted mocks cannot hold a conversation.';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const ALLOWED = [path.join(ROOT, 'public'), path.join(ROOT, 'src')];

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
async function readBody(req, limit = 300_000) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('Request body too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/config') return send(res, 200, { live: LIVE, model: LIVE ? MODEL : null });
    if (url.pathname === '/api/version') return send(res, 200, { version: VERSION });
    if (url.pathname === '/api/llm' && req.method === 'POST') {
      if (!llm) return send(res, 400, { error: 'No ANTHROPIC_API_KEY in .env. Use mock mode or add a key and restart.' });
      const { system, user } = JSON.parse(await readBody(req));
      return send(res, 200, { text: await llm({ system, user }) });
    }
    if (url.pathname.startsWith('/api/talk/')) {
      const route = url.pathname.slice(10);
      if (route === 'state' && req.method === 'GET') { const mem = await talk.load(url.searchParams.get('agent') || 'A'); return send(res, 200, { live: LIVE, mem, needsReflection: needsReflection(mem) }); }
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const agent = body.agent || 'A';
      if (route === 'reset') {
        const file = path.join(DATA, `talk-${agent}.json`);
        await rename(file, path.join(DATA, `talk-${agent}-backup-${Date.now()}.json`)).catch(() => {});
        const mem = freshTalkMemory(agent); await talk.save(mem);
        return send(res, 200, { mem });
      }
      if (!llm) return send(res, 400, { error: NO_KEY });
      if (route === 'message') {
        if (!String(body.text || '').trim()) return send(res, 400, { error: 'Empty message.' });
        return send(res, 200, await talkTurn(talk, llm, agent, body.text));
      }
      if (route === 'stream') { // same turn as /message, but each stage is sent as a server-sent event while it happens
        if (!String(body.text || '').trim()) return send(res, 400, { error: 'Empty message.' });
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const emit = (stage, data) => res.write(sseFrame(stage, data));
        try { await talkTurn(talk, llm, agent, body.text, emit); } catch (e) { emit('error', { error: e.message }); }
        return res.end();
      }
      if (route === 'digest') { // read a text to the agent; every passage streams the same stages as a Talk turn
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const emit = (stage, data) => res.write(sseFrame(stage, data));
        try { await digestText(talk, llm, agent, body, emit); } catch (e) { emit('error', { error: e.message }); }
        return res.end();
      }
      if (route === 'baseline') return send(res, 200, await runBaseline(talk, llm, agent));
      if (route === 'audit') return send(res, 200, await talkAudit(talk, llm, agent));
      if (route === 'selftest') return send(res, 200, await talkSelfTest(talk, llm, agent, body.statement));
      if (route === 'reflect') return send(res, 200, await talkReflect(talk, llm, agent, body.trigger === 'return' ? 'return' : 'manual'));
      return send(res, 404, { error: 'Unknown talk route' });
    }
    let rel = url.pathname === '/' ? '/public/index.html' : url.pathname;
    if (!rel.startsWith('/src/') && !rel.startsWith('/public/')) rel = '/public' + rel;
    const file = path.normalize(path.join(ROOT, decodeURIComponent(rel)));
    if (!ALLOWED.some(dir => file.startsWith(dir + path.sep))) return send(res, 403, 'Forbidden', 'text/plain');
    send(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain');
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`STEBULA at http://localhost:${PORT}  (${LIVE ? `live mode available: ${MODEL}` : 'mock mode only: no API key in .env'})`));
