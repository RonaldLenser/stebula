// HTTP routes for exports, findings, and experiments. Kept out of server.js so the server stays small.
// Every route here is behind the server's access check (server.js). Long runs are jobs: they stop when the
// browser disconnects or the person cancels, and they record their final state.
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { readRecords } from '../lib/records.js';
import { EXPORTS, buildCsv } from './exports.js';
import { createFinding, testFinding, reviseFinding, generateHypotheses, verifyLocks, evaluate, STATUS_TEXT } from './findings.js';
import { catalog, aggregateStats } from './metrics.js';
import { HUMAN_AREAS } from './human.js';
import { runExperiment, estimateCalls, CONDITIONS } from './experiments.js';
import { runLessonExperiment, estimateLessonCalls, LESSON_CONDITIONS, DEFAULT_LESSON_CONDITIONS, BudgetError } from './lesson.js';
import { makeLessonDouble } from './lesson-double.js';
import { sseFrame } from '../talk/sse.js';
import { errorInfo } from '../lib/http-errors.js';
import { validAgentId } from '../talk/session.js';

const RUN_ID = /^[lx][a-z0-9]{4,24}$/;
const clampInt = (x, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(x)) || d));

export function makeResearchRoutes({ dataDir, talk, recorder, llm, live, send, readBody, jobs, registry, revision, model, maxLiveCalls = 120 }) {
  const loadMems = async () => ({ A: await talk.load('A'), B: await talk.load('B') });
  const view = reg => ({ registry: reg, locksOk: verifyLocks(reg).length === 0, tampered: verifyLocks(reg), evaluated: Object.fromEntries(reg.findings.map(f => [`${f.id}@${f.version}`, evaluate(f)])), statusText: STATUS_TEXT, catalog: catalog(), humanAreas: HUMAN_AREAS, conditions: CONDITIONS, lessonConditions: LESSON_CONDITIONS, live });

  async function listRuns(kind) {
    let ids = [];
    try { ids = (await readdir(path.join(dataDir, 'experiments'))).filter(id => RUN_ID.test(id)).sort().reverse(); } catch { return []; }
    const out = [];
    for (const id of ids) {
      try {
        const r = JSON.parse(await readFile(path.join(dataDir, 'experiments', id, 'result.json'), 'utf8'));
        if ((kind === 'lesson') !== (r.kind === 'lesson')) continue;
        out.push({ runId: r.runId, at: r.at, status: r.status, mode: r.mode || 'live', kind: r.kind || 'isolation', params: r.params, usage: r.usage, exclusions: r.exclusions?.length ?? 0, conditions: Object.keys(r.conditions || {}) });
      } catch { /* a run that never finished has no result file */ }
    }
    return out;
  }
  async function readRun(id) {
    if (!RUN_ID.test(String(id))) return null; // the id is part of a path: only the generated shape is accepted
    try { return JSON.parse(await readFile(path.join(dataDir, 'experiments', id, 'result.json'), 'utf8')); } catch { return null; }
  }
  const sse = (res, job) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(sseFrame('job', { id: job.id, label: job.label }));
    return (stage, data) => { if (!res.writableEnded) res.write(sseFrame(stage, data)); };
  };

  return async function handle(req, res, url, { authorize }) {
    const p = url.pathname;
    const exp = /^\/api\/export\/(\w+)\.csv$/.exec(p);
    const mine = exp || p === '/api/export' || p.startsWith('/api/findings') || p.startsWith('/api/experiment') || p.startsWith('/api/lesson');
    if (!mine) return false;
    if (!authorize()) return true;

    if (exp && req.method === 'GET') {
      if (!EXPORTS[exp[1]]) { send(res, 404, { error: 'Unknown export' }); return true; }
      await recorder.flush();
      const health = recorder.health();
      const csv = '﻿' + buildCsv(exp[1], await readRecords(dataDir));
      await mkdir(path.join(dataDir, 'exports'), { recursive: true });
      await writeFile(path.join(dataDir, 'exports', `${exp[1]}-${new Date().toISOString().slice(0, 10)}.csv`), csv);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="stebula-${exp[1]}.csv"`, 'cache-control': 'no-store', 'x-record-complete': String(health.ok) });
      res.end(csv);
      return true;
    }
    if (p === '/api/export' && req.method === 'GET') { send(res, 200, { exports: Object.entries(EXPORTS).map(([name, e]) => ({ name, about: e.about })), recorder: recorder.health() }); return true; }

    try {
      if (p === '/api/findings' && req.method === 'GET') {
        send(res, 200, { ...(await registry.update(reg => view(reg))), stats: aggregateStats(await loadMems()), experiment: (await listRuns('isolation'))[0] ? await readRun((await listRuns('isolation'))[0].runId) : null, recorder: recorder.health() });
        return true;
      }
      if (p === '/api/experiment/runs' && req.method === 'GET') { send(res, 200, { runs: await listRuns('isolation') }); return true; }
      if (p === '/api/lesson/runs' && req.method === 'GET') { send(res, 200, { runs: await listRuns('lesson') }); return true; }
      if (p === '/api/lesson/run' && req.method === 'GET') {
        const r = await readRun(url.searchParams.get('id'));
        send(res, r ? 200 : 404, r || { error: 'No such run.' });
        return true;
      }
      if (p === '/api/lesson/estimate' && req.method === 'GET') {
        const conditions = (url.searchParams.get('conditions') || DEFAULT_LESSON_CONDITIONS.join(',')).split(',').filter(c => LESSON_CONDITIONS[c]);
        const tasks = clampInt(url.searchParams.get('tasks'), 1, 60, 8);
        send(res, 200, { tasks, conditions, calls: estimateLessonCalls({ tasks, conditions }), maxLiveCalls, live });
        return true;
      }
      if (p === '/api/experiment/estimate' && req.method === 'GET') {
        const conditions = (url.searchParams.get('conditions') || Object.keys(CONDITIONS).join(',')).split(',').filter(c => CONDITIONS[c]);
        const steps = clampInt(url.searchParams.get('steps'), 1, 20, 6), every = clampInt(url.searchParams.get('every'), 1, 10, 3);
        send(res, 200, { conditions, steps, every, calls: estimateCalls({ conditions, steps, every }), maxLiveCalls });
        return true;
      }
      if (req.method !== 'POST') { send(res, 405, { error: 'Use POST' }); return true; }
      const body = JSON.parse((await readBody(req)) || '{}');

      if (p === '/api/findings/create') { send(res, 200, { finding: await registry.update(reg => createFinding(reg, { ...body, origin: 'person', suggestedBy: [] })) }); return true; }
      if (p === '/api/findings/test') {
        const mems = await loadMems();
        const f = await registry.update(reg => { const r = testFinding(reg, body.id, mems); recorder.log('finding', null, { event: 'tested', id: r.id, version: r.version, result: r.results.at(-1), status: r.status }); return r; });
        send(res, 200, { finding: f });
        return true;
      }
      if (p === '/api/findings/revise') {
        const f = await registry.update(reg => { const r = reviseFinding(reg, body.id, body.changes || {}); recorder.log('finding', null, { event: 'revised', id: r.id, version: r.version, supersedes: r.supersedes }); return r; });
        send(res, 200, { finding: f });
        return true;
      }
      if (p === '/api/findings/generate') {
        if (!llm) { send(res, 400, { error: 'This needs a live model. Add ANTHROPIC_API_KEY to .env and restart.' }); return true; }
        const job = jobs.begin('generate hypotheses', res);
        try {
          const mems = await loadMems(), records = await readRecords(dataDir);
          const out = await registry.update(async reg => {
            const g = await generateHypotheses(reg, recorder.wrapLLM(llm, 'research'), { mems, records, signal: job.signal });
            for (const f of g.created) recorder.log('finding', null, { event: 'proposed', id: f.id, version: f.version, statement: f.statement, prediction: f.prediction, metric: f.metric, suggestedBy: f.suggestedBy });
            return g;
          });
          job.end();
          send(res, 200, { created: out.created.length, rejected: out.rejected });
        } catch (e) { job.end('failed'); throw e; }
        return true;
      }

      // ---- experiments: long jobs streamed as server-sent events ----
      if (p === '/api/experiment') {
        if (!llm) { send(res, 400, { error: 'This needs a live model. Add ANTHROPIC_API_KEY to .env and restart.' }); return true; }
        const conditions = (Array.isArray(body.conditions) ? body.conditions : Object.keys(CONDITIONS)).filter(c => CONDITIONS[c]);
        const steps = clampInt(body.steps, 1, 20, 6), every = clampInt(body.every, 1, 10, 3);
        const estimate = estimateCalls({ conditions, steps, every });
        const budget = Number(body.budget) || maxLiveCalls;
        if (budget > maxLiveCalls) { send(res, 400, { error: `The budget ${budget} is above this server's cap of ${maxLiveCalls}. Raise LIVE_MAX_CALLS in .env on purpose to allow it.`, kind: 'budget' }); return true; }
        if (estimate > budget) { send(res, 400, { error: `This run needs about ${estimate} model calls before retries, and the budget is ${budget}. Lower the steps or conditions, or raise the budget on purpose.`, kind: 'budget', estimate }); return true; }
        const job = jobs.begin('isolation experiment', res);
        const emit = sse(res, job);
        try {
          await runExperiment(cond => recorder.wrapLLM(llm, `exp-${cond}`), { dataDir, conditions, steps, every, memory: body.memory === 'off' ? 'off' : 'on', signal: job.signal, mode: 'live', model, revision, registry, record: (t, pl) => recorder.log(t, null, pl), emit });
          job.end();
        } catch (e) { job.end('failed'); emit('error', errorInfo(e).body); }
        res.end();
        return true;
      }
      if (p === '/api/lesson') {
        const scripted = body.mode === 'scripted';
        if (!scripted && !llm) { send(res, 400, { error: 'This needs a live model. Add ANTHROPIC_API_KEY to .env, or run the scripted double.' }); return true; }
        const conditions = (Array.isArray(body.conditions) ? body.conditions : DEFAULT_LESSON_CONDITIONS).filter(c => LESSON_CONDITIONS[c]);
        const tasks = clampInt(body.tasks, 1, 60, 8), seed = clampInt(body.seed, 1, 100000, 1);
        const budget = scripted ? Infinity : Number(body.budget);
        if (!scripted && (!Number.isFinite(budget) || budget <= 0)) { send(res, 400, { error: 'A live run needs an explicit call budget.', kind: 'budget', estimate: estimateLessonCalls({ tasks, conditions }) }); return true; }
        if (!scripted && budget > maxLiveCalls) { send(res, 400, { error: `The budget ${budget} is above this server's cap of ${maxLiveCalls}. Raise LIVE_MAX_CALLS in .env on purpose to allow it.`, kind: 'budget' }); return true; }
        const job = jobs.begin('lesson experiment', res);
        const emit = sse(res, job);
        try {
          const model_ = scripted ? makeLessonDouble({ seed }) : recorder.wrapLLM(llm, 'exp-lesson');
          await runLessonExperiment(model_, { dataDir, tasks, seed, conditions, maxCalls: budget, mode: scripted ? 'scripted-double' : 'live', model: scripted ? 'scripted-double' : model, revision, signal: job.signal, registry: scripted ? null : registry, record: (t, pl) => recorder.log(t, null, { ...pl, scripted }), emit });
          job.end();
        } catch (e) { job.end('failed'); emit('error', errorInfo(e).body); }
        res.end();
        return true;
      }
    } catch (e) { const { status, body } = errorInfo(e); send(res, status, body); return true; }
    send(res, 404, { error: 'Unknown route' });
    return true;
  };
}

export { BudgetError, validAgentId };
