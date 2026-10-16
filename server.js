// Tiny no-dependency server: serves the app and proxies model calls so the API key stays server-side.
// Defaults to 127.0.0.1 (this computer only). See src/lib/access.js for the rules on exposing it.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './scripts/env.js';
import { makeNodeLLM } from './src/agents/transport-node.js';
import { makeFakeLLM } from './src/dev/fake-llm.js';
import { sseFrame } from './src/talk/sse.js';
import { digestText, runBaseline } from './src/talk/digest.js';
import { makeRecorder } from './src/lib/records.js';
import { makeResearchRoutes } from './src/research/routes.js';
import { makeRegistry } from './src/research/findings.js';
import { makeJobs } from './src/lib/jobs.js';
import { makeAccess } from './src/lib/access.js';
import { errorInfo } from './src/lib/http-errors.js';
import { codeRevision } from './src/lib/revision.js';
import { PERSONAS } from './src/agents/prompts.js';
import { makeTalkStore, talkTurn, talkAudit, talkSelfTest, talkReflect, needsReflection, validAgentId, ValidationError } from './src/talk/session.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(ROOT, '.env'));
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
// STEBULA_FAKE_LLM=1 swaps in a scripted stand-in for the model so the interface can be tested without a key. It is labelled everywhere.
const FAKE = process.env.STEBULA_FAKE_LLM === '1';
const LIVE = FAKE || Boolean(process.env.ANTHROPIC_API_KEY);
const MODEL = FAKE ? 'scripted-test-model' : process.env.MODEL || 'claude-sonnet-5-5';
const llm = FAKE ? makeFakeLLM() : LIVE ? makeNodeLLM() : null;
const VERSION = process.env.STEBULA_VERSION || 'dev';
const REVISION = codeRevision(ROOT);
const DATA = process.env.STEBULA_DATA || path.join(ROOT, 'data');
const access = makeAccess({ host: HOST, token: process.env.STEBULA_TOKEN || '', publicMode: process.env.STEBULA_PUBLIC === '1', allowedHosts: (process.env.STEBULA_ALLOWED_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean) });
const talk = makeTalkStore(DATA);
const recorder = makeRecorder(DATA, { revision: REVISION.commit });
const jobs = makeJobs();
const registry = makeRegistry(path.join(DATA, 'findings.json'));
const NO_KEY = 'Talk needs a live model. Add ANTHROPIC_API_KEY to .env and restart. Scripted mocks cannot hold a conversation.';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
const ALLOWED = [path.join(ROOT, 'public'), path.join(ROOT, 'src'), path.join(ROOT, 'docs')];
const PUBLIC_API = new Set(['/api/config', '/api/version', '/api/example', '/api/health']);

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
async function readBody(req, limit = 300_000) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('Request body too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}
const sendError = (res, e) => { const { status, body } = errorInfo(e); if (res.headersSent) { res.end(); return; } send(res, status, body); };
const startSse = (res, job) => { res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' }); res.write(sseFrame('job', { id: job.id, label: job.label })); };
const agentOf = raw => {
  const agent = raw ?? 'A';
  if (!validAgentId(agent) || !PERSONAS[agent]) throw new ValidationError('Unknown agent. Use A or B.');
  return agent;
};

const research = makeResearchRoutes({ dataDir: DATA, talk, recorder, llm, live: LIVE, send, readBody, jobs, registry, revision: REVISION, model: LIVE ? MODEL : null, maxLiveCalls: Number(process.env.LIVE_MAX_CALLS) || 120 });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!access.hostOk(req)) return send(res, 421, { error: 'Unexpected Host header.' });
    if (req.method === 'POST' && !access.originOk(req)) return send(res, 403, { error: 'Cross-site request refused.' });
    const isApi = url.pathname.startsWith('/api/');
    const authorize = () => { const d = access.deny(req); if (d) { send(res, d.status, { error: d.message, kind: 'access' }); return false; } return true; };

    if (url.pathname === '/api/config') return send(res, 200, { live: LIVE && !access.publicMode, model: LIVE ? MODEL : null, fake: FAKE, public: access.publicMode, tokenRequired: access.tokenRequired, loopback: access.loopback });
    if (url.pathname === '/api/version') return send(res, 200, { version: VERSION, revision: REVISION });
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, recorder: access.publicMode ? null : recorder.health(), active: jobs.count() });
    if (url.pathname === '/api/example') { try { return send(res, 200, await readFile(path.join(ROOT, 'examples', 'observe-example.json'))); } catch { return send(res, 404, { error: 'No recorded example is bundled.' }); } }
    if (isApi && !PUBLIC_API.has(url.pathname) && !authorize()) return;

    if (url.pathname === '/api/jobs') {
      if (req.method === 'POST') return send(res, 200, { cancelled: jobs.cancel(JSON.parse((await readBody(req)) || '{}').id) });
      return send(res, 200, { jobs: jobs.list() });
    }
    if (url.pathname === '/api/llm' && req.method === 'POST') {
      if (!llm) return send(res, 400, { error: 'No ANTHROPIC_API_KEY in .env. Use mock mode or add a key and restart.' });
      const { system, user } = JSON.parse(await readBody(req));
      if (typeof system !== 'string' || typeof user !== 'string') throw new ValidationError('system and user must be strings.');
      const job = jobs.begin('browser model call', res);
      try { const text = await llm({ system, user, signal: job.signal }); job.end(); return send(res, 200, { text }); } catch (e) { job.end('failed'); throw e; }
    }
    if (await research(req, res, url, { authorize })) return;

    if (url.pathname.startsWith('/api/talk/')) {
      const route = url.pathname.slice(10);
      if (route === 'state' && req.method === 'GET') {
        const mem = await talk.load(agentOf(url.searchParams.get('agent')));
        return send(res, 200, { live: LIVE, mem, needsReflection: needsReflection(mem), recorder: recorder.health() });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
      const body = JSON.parse((await readBody(req)) || '{}');
      const agent = agentOf(body.agent);
      if (route === 'reset') {
        const { mem, backup } = await talk.reset(agent, { keepDamaged: Boolean(body.keepDamaged) });
        recorder.log('reset', agent, { backup });
        return send(res, 200, { mem, backup });
      }
      if (!llm) return send(res, 400, { error: NO_KEY });
      const job = jobs.begin(`talk ${route}`, res), { signal } = job;
      const rllm = recorder.wrapLLM(llm, agent), rec = recorder.for(agent);
      const emitTo = out => (stage, data) => { rec('stage', { stage, data }); out?.(stage, data); };
      const opts = { signal, memory: body.memory === 'off' ? 'off' : 'on' };
      const run = async fn => { try { const out = await fn(); job.end(); return out; } catch (e) { job.end(signal.aborted ? 'cancelled' : 'failed'); throw e; } };
      if (route === 'message') {
        if (!String(body.text || '').trim()) { job.end(); return send(res, 400, { error: 'Empty message.' }); }
        return send(res, 200, await run(() => talkTurn(talk, rllm, agent, body.text, emitTo(), rec, { ...opts, input: body.input })));
      }
      if (route === 'stream') { // same turn as /message, but each stage is sent as a server-sent event while it happens
        if (!String(body.text || '').trim()) { job.end(); return send(res, 400, { error: 'Empty message.' }); }
        startSse(res, job);
        const emit = emitTo((stage, data) => { if (!res.writableEnded) res.write(sseFrame(stage, data)); });
        try { await run(() => talkTurn(talk, rllm, agent, body.text, emit, rec, { ...opts, input: body.input })); } catch (e) { emit('error', errorInfo(e).body); }
        return res.end();
      }
      if (route === 'digest') { // read a text to the agent; every passage streams the same stages as a Talk turn
        startSse(res, job);
        const emit = emitTo((stage, data) => { if (!res.writableEnded) res.write(sseFrame(stage, data)); });
        try { await run(() => digestText(talk, rllm, agent, body, emit, rec, opts)); } catch (e) { emit('error', errorInfo(e).body); }
        return res.end();
      }
      if (route === 'baseline') return send(res, 200, await run(() => runBaseline(talk, rllm, agent, rec, { signal })));
      if (route === 'audit') return send(res, 200, await run(() => talkAudit(talk, rllm, agent, rec, opts)));
      if (route === 'selftest') return send(res, 200, await run(() => talkSelfTest(talk, rllm, agent, body.statement, rec, opts)));
      if (route === 'reflect') return send(res, 200, await run(() => talkReflect(talk, rllm, agent, body.trigger === 'return' ? 'return' : 'manual', rec, opts)));
      job.end();
      return send(res, 404, { error: 'Unknown talk route' });
    }
    let rel;
    try { rel = decodeURIComponent(url.pathname === '/' ? '/public/index.html' : url.pathname); } catch { return send(res, 400, 'Bad path', 'text/plain'); }
    if (!rel.startsWith('/src/') && !rel.startsWith('/public/') && !rel.startsWith('/docs/')) rel = '/public' + rel;
    const file = path.normalize(path.join(ROOT, rel));
    if (!ALLOWED.some(dir => file.startsWith(dir + path.sep))) return send(res, 403, 'Forbidden', 'text/plain');
    if (file.startsWith(path.join(ROOT, 'docs') + path.sep) && path.extname(file) !== '.md') return send(res, 403, 'Forbidden', 'text/plain');
    send(res, 200, await readFile(file), MIME[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT') return send(res, 404, 'Not found', 'text/plain');
    sendError(res, e);
  }
});

// Graceful shutdown: stop taking requests, cancel running work (so no more paid calls are made), flush the record.
let closing = false;
async function shutdown(why) {
  if (closing) return; closing = true;
  console.log(`[server] shutting down (${why}). ${jobs.count()} job(s) running.`);
  server.close();
  jobs.abortAll();
  await jobs.idle(8000);
  await recorder.flush().catch(() => {});
  const h = recorder.health();
  console.log(`[server] record flushed. ${h.written} line(s) written, ${h.pending} pending${h.ok ? '' : ', with at least one failed write earlier'}.`);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// The launcher (scripts/run.js) talks to us over IPC: Windows cannot deliver SIGTERM to a child gracefully.
process.on('message', m => {
  if (m === 'shutdown') shutdown('requested by launcher');
  else if (m?.type === 'activity') process.send?.({ type: 'activity', active: jobs.count(), jobs: jobs.list() });
});

server.listen(PORT, HOST, () => console.log(`STEBULA at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}  (${access.publicMode ? 'public replay only' : LIVE ? `live mode available: ${MODEL}` : 'mock mode only: no API key in .env'}) revision ${REVISION.commit.slice(0, 7)}${REVISION.dirty ? '+uncommitted' : ''}`));
