// HTTP routes for exports, findings, and experiments. Kept out of server.js so the server stays small.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readRecords } from '../lib/records.js';
import { EXPORTS, buildCsv } from './exports.js';
import { loadRegistry, saveRegistry, ensureDefaultFindings, createFinding, testFinding, reviseFinding, generateHypotheses, verifyLocks, evaluate } from './findings.js';
import { catalog, aggregateStats } from './metrics.js';
import { HUMAN_AREAS } from './human.js';
import { runExperiment, CONDITIONS } from './experiments.js';
import { sseFrame } from '../talk/sse.js';

export function makeResearchRoutes({ dataDir, talk, recorder, llm, live, send, readBody }) {
  const registryFile = path.join(dataDir, 'findings.json');
  let chain = Promise.resolve();
  // Read-modify-write of findings.json, one at a time.
  const withRegistry = fn => {
    const run = chain.then(async () => { const reg = await loadRegistry(registryFile); ensureDefaultFindings(reg); const out = await fn(reg); await saveRegistry(registryFile, reg); return out; });
    chain = run.catch(() => {});
    return run;
  };
  const loadMems = async () => ({ A: await talk.load('A'), B: await talk.load('B') });
  const view = reg => ({ registry: reg, locksOk: verifyLocks(reg).length === 0, tampered: verifyLocks(reg), evaluated: Object.fromEntries(reg.findings.map(f => [`${f.id}@${f.version}`, evaluate(f)])), catalog: catalog(), humanAreas: HUMAN_AREAS, conditions: CONDITIONS, live });

  async function latestExperiment() {
    try {
      const ids = (await readdir(path.join(dataDir, 'experiments'))).sort();
      for (const id of ids.reverse()) { try { return JSON.parse(await readFile(path.join(dataDir, 'experiments', id, 'result.json'), 'utf8')); } catch { /* run not finished */ } }
    } catch { /* none yet */ }
    return null;
  }

  return async function handle(req, res, url) {
    const p = url.pathname;
    const exp = /^\/api\/export\/(\w+)\.csv$/.exec(p);
    if (exp && req.method === 'GET') {
      if (!EXPORTS[exp[1]]) { send(res, 404, { error: 'Unknown export' }); return true; }
      await recorder.flush();
      const csv = '﻿' + buildCsv(exp[1], await readRecords(dataDir));
      await mkdir(path.join(dataDir, 'exports'), { recursive: true });
      await writeFile(path.join(dataDir, 'exports', `${exp[1]}-${new Date().toISOString().slice(0, 10)}.csv`), csv);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="stebula-${exp[1]}.csv"`, 'cache-control': 'no-store' });
      res.end(csv);
      return true;
    }
    if (p === '/api/export' && req.method === 'GET') { send(res, 200, { exports: Object.entries(EXPORTS).map(([name, e]) => ({ name, about: e.about })) }); return true; }
    if (!p.startsWith('/api/findings') && !p.startsWith('/api/experiment')) return false;
    if (p === '/api/findings' && req.method === 'GET') {
      send(res, 200, { ...(await withRegistry(reg => view(reg))), stats: aggregateStats(await loadMems()), experiment: await latestExperiment() });
      return true;
    }
    if (req.method !== 'POST') { send(res, 405, { error: 'Use POST' }); return true; }
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!llm && (p === '/api/findings/generate' || p === '/api/experiment')) { send(res, 400, { error: 'This needs a live model. Add ANTHROPIC_API_KEY to .env and restart.' }); return true; }
    try {
      if (p === '/api/findings/generate') {
        const out = await withRegistry(async reg => {
          const g = await generateHypotheses(reg, recorder.wrapLLM(llm, 'research'), { mems: await loadMems(), records: await readRecords(dataDir) });
          for (const f of g.created) recorder.log('finding', null, { event: 'proposed', id: f.id, version: f.version, statement: f.statement, prediction: f.prediction, metric: f.metric, suggestedBy: f.suggestedBy });
          return g;
        });
        send(res, 200, { created: out.created.length, rejected: out.rejected });
        return true;
      }
      if (p === '/api/findings/test') {
        const f = await withRegistry(async reg => { const r = testFinding(reg, body.id, await loadMems()); recorder.log('finding', null, { event: 'tested', id: r.id, version: r.version, result: r.results.at(-1), status: r.status }); return r; });
        send(res, 200, { finding: f });
        return true;
      }
      if (p === '/api/findings/revise') {
        const f = await withRegistry(reg => { const r = reviseFinding(reg, body.id, body.changes || {}); recorder.log('finding', null, { event: 'revised', id: r.id, version: r.version, supersedes: r.supersedes }); return r; });
        send(res, 200, { finding: f });
        return true;
      }
      if (p === '/api/findings/create') {
        const f = await withRegistry(reg => createFinding(reg, { ...body, origin: 'model', suggestedBy: [] }));
        send(res, 200, { finding: f });
        return true;
      }
      if (p === '/api/experiment') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
        const emit = (stage, data) => res.write(sseFrame(stage, data));
        try {
          await runExperiment(cond => recorder.wrapLLM(llm, `exp-${cond}`), {
            dataDir, conditions: body.conditions, steps: Math.min(20, Math.max(1, Number(body.steps) || 6)), every: Math.min(10, Math.max(1, Number(body.every) || 3)),
            record: (t, pl) => recorder.log(t, null, pl), emit, registryFile,
          });
        } catch (e) { emit('error', { error: e.message }); }
        res.end();
        return true;
      }
    } catch (e) { send(res, 400, { error: e.message }); return true; }
    send(res, 404, { error: 'Unknown route' });
    return true;
  };
}
