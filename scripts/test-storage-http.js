// Audit regression tests, part 2: stored state, the research record, access control, and the real HTTP server.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { makeTalkStore, freshTalkMemory, talkTurn, assertAgentId, validAgentId, CorruptMemoryError } from '../src/talk/session.js';
import { writeFileAtomic } from '../src/lib/atomic.js';
import { makeRegistry, createFinding, CorruptRegistryError, verifyLocks } from '../src/research/findings.js';
import { makeAccess } from '../src/lib/access.js';
import { makeJobs } from '../src/lib/jobs.js';
import { parseSse } from '../src/talk/sse.js';

const tmp = async fn => { const d = await mkdtemp(join(tmpdir(), 'st-')); try { return await fn(d); } finally { await rm(d, { recursive: true, force: true }); } };

// ---- agent id validation at the storage boundary, and path containment ----
for (const bad of ['../x', '..\\x', 'A/B', 'a b', '', 'x'.repeat(40), null, undefined, 7, '.', 'A\0']) { assert.equal(validAgentId(bad), false, `rejects ${JSON.stringify(bad)}`); assert.throws(() => assertAgentId(bad)); }
assert(validAgentId('A') && validAgentId('agent_2'));
await tmp(async d => {
  const store = makeTalkStore(d);
  await assert.rejects(() => store.load('../escape'), /Invalid agent id|Unknown agent/);
  await assert.rejects(() => store.save({ ...freshTalkMemory('A'), agent: '../../escape' }), /Invalid agent id/);
  await assert.rejects(() => store.reset('..'), /Invalid agent id/);
  assert.deepEqual(await readdir(d), [], 'nothing was written for a rejected id');
});

// ---- atomic replacement ----
await tmp(async d => {
  const f = join(d, 'x.json');
  await writeFileAtomic(f, '{"a":1}'); await writeFileAtomic(f, '{"a":2}');
  assert.equal(await readFile(f, 'utf8'), '{"a":2}');
  assert.deepEqual((await readdir(d)).filter(n => n.endsWith('.tmp')), [], 'no temp files are left behind');
  await mkdir(join(d, 'dir'));
  await assert.rejects(() => writeFileAtomic(join(d, 'dir'), 'x'), 'a failed replace is an error');
  assert.deepEqual((await readdir(d)).filter(n => n.endsWith('.tmp')), [], 'a failed replace cleans up its temp file');
});

// ---- corruption is explicit; only a missing file means fresh ----
await tmp(async d => {
  const store = makeTalkStore(d);
  assert.equal((await store.load('A')).turns, 0, 'a genuinely missing file starts fresh');
  await writeFile(join(d, 'talk-A.json'), '{"turns": 5, "archive": [');   // a torn write
  await assert.rejects(() => store.load('A'), e => e instanceof CorruptMemoryError && e.status === 409);
  assert.equal(await readFile(join(d, 'talk-A.json'), 'utf8'), '{"turns": 5, "archive": [', 'the damaged file was not replaced');
  await assert.rejects(() => talkTurn(store, async () => '{}', 'A', 'hi'), CorruptMemoryError, 'a turn cannot silently overwrite damaged memory');
  const { mem, backup } = await store.reset('A', { keepDamaged: true });
  assert.equal(mem.turns, 0); assert(/damaged/.test(backup));
  assert.equal(await readFile(join(d, backup), 'utf8'), '{"turns": 5, "archive": [', 'the damaged file is kept for recovery');
});

// ---- reset and conversation are serialized per agent ----
await tmp(async d => {
  const store = makeTalkStore(d);
  const THINK = JSON.stringify({ thoughts: ['perception', 'memory', 'self-monitor', 'evaluation', 'initiative'].map(module => ({ module, text: `t ${module}`, relevance: 0.5 })) });
  let release; const gate = new Promise(r => (release = r));
  const llm = async ({ stage }) => { if (stage === 'speak') await gate; return stage === 'think' ? THINK : JSON.stringify({ reply: 'Hello.', self_model: null, person_model: null, change_note: 'no change', claims: [], candidate_updates: [] }); };
  const turn = talkTurn(store, llm, 'A', 'hi', () => {}, () => {});
  await new Promise(r => setTimeout(r, 30));
  let resetDone = false;
  const reset = store.reset('A').then(r => { resetDone = true; return r; });
  await new Promise(r => setTimeout(r, 60));
  assert.equal(resetDone, false, 'reset waits for the conversation turn already in progress');
  release(); await turn; const r = await reset;
  const backups = (await readdir(d)).filter(n => /backup/.test(n));
  assert.equal(backups.length, 1);
  assert.equal(JSON.parse(await readFile(join(d, backups[0]), 'utf8')).turns, 1, 'the finished turn was archived, not lost');
  assert.equal((await store.load('A')).turns, 0); assert.equal(r.mem.turns, 0);
});

// ---- one registry writer: concurrent updates, corruption, lock refusal ----
await tmp(async d => {
  const file = join(d, 'findings.json'), registry = makeRegistry(file);
  const mk = i => registry.update(reg => createFinding(reg, { statement: `s${i}`, metric: { name: 'custom' }, prediction: { text: 'p' }, refutedIf: 'r', design: 'd' }));
  const made = await Promise.all(Array.from({ length: 12 }, (_, i) => mk(i)));
  assert.equal(new Set(made.map(f => f.id)).size, 12, 'concurrent writers never reuse an id');
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(onDisk.findings.filter(f => !f.origin || f.origin !== 'code').length, 12, 'every concurrent write survived');
  await assert.rejects(() => registry.update(reg => { reg.findings[0].prediction.text = 'edited after the fact'; }), /lock/, 'a change that breaks a lock is refused');
  assert.deepEqual(verifyLocks(JSON.parse(await readFile(file, 'utf8'))), [], 'and not saved');
  await writeFile(file, '{"findings": [');
  await assert.rejects(() => registry.update(() => 1), CorruptRegistryError);
  assert.equal(await readFile(file, 'utf8'), '{"findings": [', 'a damaged registry is never silently replaced');
});

// ---- jobs: cancel, abort all, idle ----
{
  const jobs = makeJobs();
  const a = jobs.begin('a'), b = jobs.begin('b');
  assert.equal(jobs.count(), 2);
  assert.equal(jobs.cancel(a.id), true); assert(a.signal.aborted && !b.signal.aborted);
  jobs.abortAll(); assert(b.signal.aborted);
  a.end(); b.end(); assert.equal(await jobs.idle(100), true);
}

// ---- access control ----
{
  const req = (headers = {}) => ({ headers });
  const local = makeAccess({ host: '127.0.0.1' });
  assert.equal(local.deny(req()), null); assert(local.hostOk(req({ host: 'localhost:5173' })));
  assert.equal(local.hostOk(req({ host: 'evil.example' })), false, 'a foreign Host name (DNS rebinding) is refused on loopback');
  assert.equal(local.originOk(req({ origin: 'http://evil.example', host: 'localhost:5173' })), false, 'a cross-site Origin is refused');
  assert.equal(local.originOk(req({ origin: 'http://localhost:5173', host: 'localhost:5173' })), true);
  assert.equal(makeAccess({ host: '0.0.0.0' }).deny(req()).status, 403, 'network-reachable without a token: live operations are off');
  const tok = makeAccess({ host: '0.0.0.0', token: 's3cret' });
  assert.equal(tok.deny(req()).status, 401); assert.equal(tok.deny(req({ authorization: 'Bearer nope' })).status, 401);
  assert.equal(tok.deny(req({ authorization: 'Bearer s3cret' })), null); assert.equal(tok.deny(req({ 'x-stebula-token': 's3cret' })), null);
  assert.equal(makeAccess({ host: '127.0.0.1', publicMode: true }).deny(req()).status, 403, 'public replay mode has no live operations');
}

// ---- the real server over HTTP ----
async function withServer(env, fn) {
  const d = await mkdtemp(join(tmpdir(), 'srv-'));
  const port = 5300 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), STEBULA_DATA: d, ANTHROPIC_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
  await new Promise((res, rej) => { child.stdout.on('data', b => /STEBULA at/.test(String(b)) && res()); child.once('exit', c => rej(new Error(`server exited ${c}`))); setTimeout(() => rej(new Error('server did not start')), 8000); });
  try { return await fn(`http://127.0.0.1:${port}`, d, child); }
  finally { child.send('shutdown'); await new Promise(r => { child.once('exit', r); setTimeout(() => { child.kill(); r(); }, 4000); }); await rm(d, { recursive: true, force: true }); }
}
await withServer({}, async (base, d) => {
  const j = async (path, init) => { const r = await fetch(base + path, init); return { status: r.status, body: await r.json().catch(() => null) }; };
  const post = (path, body, headers = {}) => j(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await j('/api/config')).body.loopback, true);
  assert.equal((await j('/api/talk/state?agent=..%2Fx')).status, 400, 'a bad agent id is refused at the route');
  assert.equal((await post('/api/talk/reset', { agent: '../../x' })).status, 400);
  assert.equal((await post('/api/talk/reset', { agent: 'A' }, { origin: 'http://evil.example' })).status, 403, 'cross-site POST refused');
  const rebinding = await new Promise(res => { const u = new URL(base); const r = http.request({ host: u.hostname, port: u.port, path: '/api/config', headers: { host: 'evil.example' } }, x => { x.resume(); res(x.statusCode); }); r.end(); });
  assert.equal(rebinding, 421, 'a foreign Host header (DNS rebinding) is refused by the running server');
  assert.equal((await j('/api/health')).body.recorder.ok, true);
  assert.equal((await j('/../../etc/passwd')).status === 200, false, 'path traversal does not serve files');
  assert.equal((await post('/api/talk/message', { agent: 'A', text: 'hi' })).status, 400, 'no key: a clear message, no model call');
  // a damaged memory file is reported, not replaced
  await writeFile(join(d, 'talk-A.json'), '{"torn":');
  const st = await j('/api/talk/state?agent=A');
  assert.equal(st.status, 409); assert.equal(st.body.kind, 'corrupt');
  const rs = await post('/api/talk/reset', { agent: 'A', keepDamaged: true });
  assert.equal(rs.status, 200); assert((await readdir(d)).some(n => /damaged/.test(n)));
  // a scripted lesson run streams, finishes, and is recorded; the replay endpoint returns the trial prompts
  const run = await fetch(base + '/api/lesson', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'scripted', tasks: 2 }) });
  const { events } = parseSse(await run.text());
  assert.equal(events.filter(e => e.stage === 'trial').length, 6); assert(events.some(e => e.stage === 'finished'));
  const listed = (await j('/api/lesson/runs')).body.runs; assert.equal(listed.length, 1); assert.equal(listed[0].mode, 'scripted-double');
  const full = (await j(`/api/lesson/run?id=${listed[0].runId}`)).body;
  assert.equal(full.trials.length, 6); assert(full.trials[0].prompts[0].system && full.protocol.hash);
  assert.equal((await j('/api/lesson/run?id=../../secret')).status, 404, 'a run id is validated before it touches the filesystem');
  assert.equal((await post('/api/lesson', { mode: 'live', tasks: 2 })).status, 400, 'live runs need a model and an explicit budget');
});
await withServer({ STEBULA_PUBLIC: '1' }, async base => {
  assert.equal((await fetch(base + '/api/config').then(r => r.json())).public, true);
  assert.equal((await fetch(base + '/api/talk/state?agent=A')).status, 403, 'public mode serves no stored conversation');
  assert.equal((await fetch(base + '/api/talk/message', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/lesson', { method: 'POST', body: '{}' })).status, 403, 'public mode has no live or scripted runs');
  assert.equal((await fetch(base + '/api/export/turns.csv')).status, 403);
});
await withServer({ STEBULA_TOKEN: 'tok123' }, async base => {
  assert.equal((await fetch(base + '/api/talk/state?agent=A')).status, 401, 'a token is required when one is set');
  assert.equal((await fetch(base + '/api/talk/state?agent=A', { headers: { authorization: 'Bearer tok123' } })).status, 200);
});

console.log('storage, access and HTTP ok');
