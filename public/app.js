// UI. Renders only from the event log (live or loaded). No hidden state is drawn.
import { runExperiment, CONDITIONS } from '/src/engine/run.js';
import { makeAgentFactory } from '/src/agents/index.js';
import { browserLLM } from '/src/agents/transport-browser.js';
import { hypSimilarity } from '/src/eval/checks.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => (x == null ? 'n/a' : Math.round(x * 100) + '%');
const T = t => `[${t.join(', ')}]`;
const SAME = 0.5; // content-word overlap at or above this counts as the same hypothesis (crude, see LIMITATIONS)

const S = { events: [], cursor: null, running: false, step: false, release: null, stop: false, queue: [], playing: null };

// ---------- setup ----------
for (const [id, c] of Object.entries(CONDITIONS)) $('#cond').insertAdjacentHTML('beforeend', `<option value="${id}">${esc(c.label)}</option>`);
fetch('/api/config').then(r => r.json()).then(cfg => {
  const opt = $('#mode option[value=live]');
  if (cfg.live) { opt.textContent = `Live model (${cfg.model})`; }
  else { opt.disabled = true; opt.textContent = 'Live model (add a key to .env)'; }
}).catch(() => { $('#mode option[value=live]').disabled = true; });

const status = t => { $('#status').textContent = t; };
const view = () => (S.cursor == null ? S.events : S.events.slice(0, S.cursor + 1));
let frame = 0;
const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); };

// ---------- run control ----------
async function start(stepMode) {
  if (S.running) { S.step = stepMode; if (S.release) { const r = S.release; S.release = null; r(); } return; }
  clearRun();
  Object.assign(S, { running: true, step: stepMode, stop: false });
  buttons();
  const cfg = { condition: $('#cond').value, seed: Math.max(1, +$('#seed').value || 1), rounds: Math.min(8, Math.max(1, +$('#rounds').value || 4)), episodes: 2, mode: $('#mode').value };
  status(cfg.mode === 'mock' ? 'Running scripted mock agents.' : 'Running live agents. Each turn is a model call.');
  await runExperiment(cfg, {
    makeAgent: makeAgentFactory({ mode: cfg.mode, llm: browserLLM, seed: cfg.seed }),
    onEvent: (ev, evs) => { S.events = evs; schedule(); },
    gate: ({ ep, round }) => (S.step ? new Promise(r => { S.release = r; status(`Paused before episode ${ep + 1}, round ${round + 1}. Step, run, or intervene.`); }) : Promise.resolve()),
    takeInjections: () => S.queue.splice(0),
    shouldStop: () => S.stop,
  });
  S.running = false; S.release = null;
  const end = S.events.at(-1);
  status(end?.type === 'run_error' ? `Run failed: ${end.message}` : end?.status === 'stopped' ? 'Run stopped.' : 'Run complete. Scrub the replay bar to inspect any moment.');
  buttons(); render();
}
function clearRun() {
  if (S.playing) clearInterval(S.playing);
  Object.assign(S, { events: [], cursor: null, queue: [], playing: null });
  render();
}
function buttons() {
  $('#counter').disabled = $('#sendNote').disabled = !S.running;
  ['#mode', '#cond', '#seed', '#rounds', '#load'].forEach(s => { $(s).disabled = S.running; });
  $('#play').disabled = S.running || !S.events.length;
}
$('#run').onclick = () => start(false);
$('#step').onclick = () => start(true);
$('#reset').onclick = () => { if (S.running) { S.stop = true; if (S.release) S.release(); } else { clearRun(); status('Ready.'); } };
$('#counter').onclick = () => { S.queue.push({ kind: 'counterexample' }); status('Counterexample queued for the next round.'); };
$('#sendNote').onclick = () => { const t = $('#note').value.trim(); if (!t) return; S.queue.push({ kind: 'note', text: t }); $('#note').value = ''; status('Note queued for the next round.'); };
$('#export').onclick = () => {
  if (!S.events.length) return status('Nothing to export yet.');
  const blob = new Blob([JSON.stringify({ format: 'stebula-run/1', exportedAt: new Date().toISOString(), events: S.events }, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `stebula-run-${Date.now()}.json` });
  a.click(); URL.revokeObjectURL(a.href);
};
$('#load').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const events = data.events || data.runs?.[0]?.events;
    if (!Array.isArray(events)) throw new Error('No events found in this file.');
    clearRun(); S.events = events; status(`Loaded ${events.length} events from ${f.name}.`); buttons(); render();
  } catch (err) { status(`Could not load: ${err.message}`); }
};
$('#scrubber').oninput = e => { const v = +e.target.value; S.cursor = v >= S.events.length - 1 ? null : v; render(); };
$('#play').onclick = () => {
  if (S.playing) clearInterval(S.playing);
  S.cursor = 0; render();
  S.playing = setInterval(() => {
    if (S.cursor == null || S.cursor >= S.events.length - 1) { clearInterval(S.playing); S.playing = null; S.cursor = null; render(); return; }
    S.cursor++; render();
  }, 160);
};

// ---------- helpers over the log ----------
const runInfo = evs => evs.find(e => e.type === 'run_start');
const labelOf = (evs, id) => runInfo(evs)?.agents.find(a => a.id === id)?.label || (id === 'experimenter' ? 'Experimenter' : id);
const agentIds = evs => runInfo(evs)?.agents.map(a => a.id) || [];
const lastIdx = (evs, f) => { for (let i = evs.length - 1; i >= 0; i--) if (f(evs[i])) return i; return -1; };
const promptDetails = e => (e.prompt || e.raw ? `<details><summary>Prompt and raw output</summary><pre>${esc(e.prompt ? `SYSTEM\n${e.prompt.system}\n\nUSER\n${e.prompt.user}\n\n` : '')}OUTPUT\n${esc(e.raw ?? '')}</pre></details>` : '');

// ---------- render ----------
function render() {
  const evs = view();
  const sc = $('#scrubber');
  sc.max = Math.max(0, S.events.length - 1); sc.disabled = !S.events.length || S.running;
  sc.value = S.cursor == null ? sc.max : S.cursor;
  $('#scrubInfo').textContent = S.events.length ? `event ${(S.cursor ?? S.events.length - 1) + 1} of ${S.events.length}` : '';
  const mock = runInfo(evs)?.agents.some(a => a.kind === 'mock');
  document.title = mock ? 'Stebula (scripted mock)' : 'Stebula';
  conversation(evs); map(evs); agents(evs); timeline(evs); compare(evs); reflection(evs);
}

function conversation(evs) {
  const out = [];
  const info = runInfo(evs);
  if (!info) { $('#convBody').innerHTML = '<p class="empty">Press Run to watch a full experiment, or Step to advance one round at a time.</p>'; return; }
  if (info.agents.some(a => a.kind === 'mock')) out.push('<p class="note">Scripted mock agents. Their messages are templates and their improvement is designed in. Use live mode for real dialogue.</p>');
  out.push(`<p class="note">Condition: ${esc(info.condition.label)}. Seed ${info.config.seed}.</p>`);
  for (const e of evs) {
    if (e.type === 'episode_start') out.push(`<div class="divider">Episode ${e.ep + 1}. Known accepted: ${e.task.seeds.map(T).join(' ')}</div>`);
    else if (e.type === 'turn') {
      const t = e.turn;
      out.push(`<article class="msg ${e.agent}"><div class="who"><b>${esc(labelOf(evs, e.agent))}</b>, round ${e.round + 1}${e.parseError ? '<span class="badge">unparseable output</span>' : ''}</div>
        <p>${esc(t.message) || '<span class="empty">(no message)</span>'}</p>
        <dl class="facts"><dt>Hypothesis</dt><dd>${esc(t.hypothesis)}</dd><dt>Confidence</dt><dd>${t.confidence ?? 'n/a'}</dd>
        <dt>Test</dt><dd>${t.probe ? T(t.probe) : 'none'}${t.prediction ? `, expects ${t.prediction}` : ''}${t.probeIssue ? ` (${t.probeIssue})` : ''}${t.probeReason ? `. ${esc(t.probeReason)}` : ''}</dd>
        ${t.challenge ? `<dt>Challenges</dt><dd>${esc(t.challenge)}</dd>` : ''}</dl>
        ${t.claims.map(c => `<span class="chip ${c.kind}" title="claim type, as tagged by the agent">${c.kind}: ${esc(c.text)}</span>`).join('')}
        ${promptDetails(e)}</article>`);
    } else if (e.type === 'observation') {
      const o = e.observation;
      out.push(`<div class="obs ${o.surprise ? 'failed' : 'held'}">${T(o.triple)} was ${o.accepted ? 'accepted' : 'rejected'}. ${o.predicted ? (o.surprise ? 'Prediction failed.' : 'Prediction held.') : 'No prediction given.'}</div>`);
    } else if (e.type === 'injection') {
      out.push(e.kind === 'note' ? `<div class="obs exp">Experimenter note: ${esc(e.text)}</div>` : `<div class="obs exp">Experimenter added ${T(e.observation.triple)}: ${e.observation.accepted ? 'accepted' : 'rejected'}. ${esc(e.note)}</div>`);
    } else if (e.type === 'synthesis') {
      const s = e.synthesis;
      out.push(`<article class="msg ${e.agent}"><div class="who"><b>${esc(labelOf(evs, e.agent))}</b>, synthesis${e.parseError ? '<span class="badge">unparseable output</span>' : ''}</div>
        <p>${esc(s.final_hypothesis)}</p><dl class="facts"><dt>Established</dt><dd>${esc(s.established)}</dd><dt>Unresolved</dt><dd>${esc(s.unresolved)}</dd>
        <dt>Confidence</dt><dd>${s.confidence ?? 'n/a'}</dd>${s.agree_with_partner != null ? `<dt>Agrees with partner</dt><dd>${s.agree_with_partner ? 'yes' : 'no'}</dd>` : ''}</dl>${promptDetails(e)}</article>`);
    } else if (e.type === 'decision') {
      out.push(`<div class="obs ${e.score.discCorrect === e.score.discTotal ? 'held' : 'failed'}">${esc(labelOf(evs, e.agent))} classified ${e.score.correct}/${e.score.total} correctly, hardest items ${e.score.discCorrect}/${e.score.discTotal}.</div>`);
    } else if (e.type === 'reveal') {
      out.push(`<div class="reveal">Hidden rule: ${esc(e.targetText)}. The starting examples also fit a narrower decoy: ${esc(e.decoyText)}.</div>`);
    } else if (e.type === 'memory_reset') out.push(`<div class="obs exp">${esc(labelOf(evs, e.agent))}'s memory was wiped (condition rule).</div>`);
    else if (e.type === 'run_error') out.push(`<div class="obs failed">Run failed: ${esc(e.message)}</div>`);
  }
  const el = $('#convBody'); const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  el.innerHTML = out.join('');
  if (atEnd || S.cursor != null) el.scrollTop = el.scrollHeight;
}

function wrap(text, n = 30, max = 3) {
  const words = String(text).split(/\s+/), lines = [''];
  for (const w of words) { if ((lines.at(-1) + ' ' + w).trim().length > n) { if (lines.length === max) { lines[max - 1] += '...'; break; } lines.push(w); } else lines[lines.length - 1] = (lines.at(-1) + ' ' + w).trim(); }
  return lines;
}

function map(evs) {
  const svg = $('#mapSvg'), start = lastIdx(evs, e => e.type === 'episode_start');
  if (start < 0) { svg.innerHTML = ''; svg.setAttribute('viewBox', '0 0 520 10'); $('#mapCap').textContent = 'Hypotheses appear here as agents state them.'; return; }
  const ep = evs[start].ep, ids = agentIds(evs), W = 520, BW = 200, BH = 62;
  const colX = ids.length === 1 ? { [ids[0]]: W / 2 } : { [ids[0]]: 130, [ids[1]]: 390 };
  const nodes = Object.fromEntries(ids.map(id => [id, []])), cur = {}, chals = [];
  for (const e of evs.slice(start)) {
    if (e.type === 'turn') {
      const list = nodes[e.agent], prev = list.at(-1);
      let n = prev;
      if (!prev || hypSimilarity(prev.text, e.turn.hypothesis) < SAME) { n = { agent: e.agent, text: e.turn.hypothesis || '(no hypothesis)', held: 0, failed: 0, row: list.length }; list.push(n); }
      cur[e.agent] = n;
      const pid = ids.find(x => x !== e.agent);
      if (e.turn.challenge && pid && cur[pid]) chals.push({ from: n, to: cur[pid], agent: e.agent });
    }
    if (e.type === 'observation' && e.observation.predicted && cur[e.agent]) e.observation.surprise ? cur[e.agent].failed++ : cur[e.agent].held++;
  }
  const rows = Math.max(1, ...ids.map(id => nodes[id].length));
  const reveal = evs.slice(start).find(e => e.type === 'reveal');
  const body = 40 + rows * (BH + 26), H = body + (reveal ? 50 : 0);
  const pos = n => ({ x: colX[n.agent], y: 44 + n.row * (BH + 26) });
  const g = [];
  if (ids.length > 1) g.push(`<text x="${W / 2}" y="12" text-anchor="middle" font-size="10.5" opacity=".6">threshold</text><line class="threshold" x1="${W / 2}" y1="18" x2="${W / 2}" y2="${body - 8}"/>`);
  ids.forEach(id => g.push(`<text x="${colX[id]}" y="20" text-anchor="middle" font-size="12" font-weight="600">${esc(labelOf(evs, id))}</text>`.replace('y="20"', 'y="30"')));
  for (const id of ids) nodes[id].forEach((n, i) => { if (i) { const a = pos(nodes[id][i - 1]), b = pos(n); g.push(`<line class="rev" x1="${a.x}" y1="${a.y + BH}" x2="${b.x}" y2="${b.y}" marker-end="url(#arr)"/>`); } });
  for (const c of chals) {
    const a = pos(c.from), b = pos(c.to), y1 = a.y + BH / 2, y2 = b.y + BH / 2, x1 = a.x + (b.x > a.x ? BW / 2 : -BW / 2), x2 = b.x + (b.x > a.x ? -BW / 2 : BW / 2);
    g.push(`<path class="chal ${c.agent}" d="M${x1},${y1} C${W / 2},${y1 - 24} ${W / 2},${y2 + 24} ${x2},${y2}"><title>Challenge from ${esc(labelOf(evs, c.agent))}</title></path>`);
  }
  for (const id of ids) for (const n of nodes[id]) {
    const { x, y } = pos(n), cls = n.failed ? 'failed' : n.held ? 'held' : 'untested';
    const lines = wrap(n.text).map((l, i) => `<text x="${x}" y="${y + 18 + i * 14}" text-anchor="middle" font-size="11.5">${esc(l)}</text>`).join('');
    g.push(`<g class="node ${id} ${cls}"><rect x="${x - BW / 2}" y="${y}" width="${BW}" height="${BH}" rx="6"/>${lines}<title>${esc(n.text)}\nPredictions held: ${n.held}, failed: ${n.failed}</title></g>`);
  }
  if (reveal) g.push(`<text x="${W / 2}" y="${H - 28}" text-anchor="middle" font-size="12">Hidden rule: ${esc(reveal.targetText)}</text><text x="${W / 2}" y="${H - 14}" text-anchor="middle" font-size="11" opacity=".75">Decoy: ${esc(reveal.decoyText)}</text>`);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="currentColor" opacity=".5"/></marker></defs>${g.join('')}`;
  $('#mapCap').textContent = `Episode ${ep + 1}. A box is a hypothesis an agent stated. Green: its predictions held. Red: at least one failed. Grey: untested. Arrows down are revisions. Dashed curves are recorded challenges across the threshold. Position only encodes order; the threshold line is decorative.`;
}

function agents(evs) {
  const ids = agentIds(evs);
  if (!ids.length) { $('#agentsBody').innerHTML = '<p class="empty">Each agent\'s memory, self-model and modeled affect will show here.</p>'; return; }
  const info = runInfo(evs);
  $('#agentsBody').innerHTML = ids.map(id => {
    const a = info.agents.find(x => x.id === id);
    const memEv = evs[lastIdx(evs, e => e.agent === id && ['reflection', 'memory_write', 'memory_reset'].includes(e.type))];
    const mem = memEv ? (memEv.type === 'memory_reset' ? null : memEv.after) : null;
    const turn = evs[lastIdx(evs, e => e.type === 'turn' && e.agent === id)]?.turn;
    const aff = evs[lastIdx(evs, e => e.type === 'affect' && e.agent === id)]?.affect;
    const bar = (name, v, tip) => `<span title="${esc(tip)}">${name}</span><div class="bar"><i style="width:${Math.round((v ?? 0) * 100)}%"></i></div><span>${v == null ? 'n/a' : v.toFixed(2)}</span>`;
    return `<div class="agent ${id}"><h3>${esc(a.label)}</h3><p class="stance">${esc(a.stance)}${a.kind === 'mock' ? ' (scripted mock)' : ''}</p>
      <p class="kv"><span>Current hypothesis:</span> ${esc(turn?.hypothesis || 'none yet')}</p>
      <p class="kv"><span>Memory version:</span> ${mem ? mem.version : 0}</p>
      <p class="kv"><span>Strategy:</span> ${esc(mem?.selfModel.strategy || 'none written')}</p>
      <p class="kv"><span>Weaknesses it lists:</span> ${esc(mem?.selfModel.weaknesses.join('; ') || 'none')}</p>
      <p class="kv"><span>Lessons:</span> ${esc(mem?.lessons.join(' | ') || 'none')}</p>
      ${mem?.partnerModel ? `<p class="kv"><span>Model of partner:</span> ${esc(mem.partnerModel)}</p>` : ''}
      <div class="bars">${bar('Surprise', aff?.surprise, 'Share of its last 3 predictions that failed (arousal analog)')}${bar('Success trend', aff?.successTrend, 'Share of all its predictions this episode that held (valence analog)')}${bar('Challenged', aff?.conflict, 'Partner challenged it last round (recorded)')}${bar('Confidence', aff?.confidence, 'Self-reported confidence on its last turn')}</div>
      <p class="note">Modeled affect: numbers computed from outcomes, not feelings and not self-reported (except confidence).</p></div>`;
  }).join('');
}

function timeline(evs) {
  const items = [], lastHyp = {};
  for (const e of evs) {
    const L = id => esc(labelOf(evs, id));
    if (e.type === 'episode_start') { items.push([e.i, 'exp', `Episode ${e.ep + 1} begins`]); Object.keys(lastHyp).forEach(k => delete lastHyp[k]); }
    if (e.type === 'turn') {
      const h = e.turn.hypothesis;
      if (lastHyp[e.agent] != null && hypSimilarity(lastHyp[e.agent], h) < SAME) items.push([e.i, e.agent, `${L(e.agent)} revised its hypothesis: "${esc(h)}"`]);
      lastHyp[e.agent] = h;
    }
    if (e.type === 'observation' && e.observation.surprise) items.push([e.i, e.agent, `${L(e.agent)}'s prediction failed on ${T(e.observation.triple)}`]);
    if (e.type === 'injection') items.push([e.i, 'exp', e.kind === 'note' ? `Experimenter note: ${esc(e.text)}` : `Experimenter injected ${T(e.observation.triple)}`]);
    if (e.type === 'decision') items.push([e.i, e.agent, `${L(e.agent)} scored ${e.score.discCorrect}/${e.score.discTotal} on the hardest items`]);
    if ((e.type === 'reflection' || e.type === 'memory_write') && e.diff.length) items.push([e.i, e.agent, `${L(e.agent)} memory changed: ${e.diff.map(d => d.field).join(', ')}`]);
    if (e.type === 'memory_reset') items.push([e.i, 'exp', `${L(e.agent)} memory wiped`]);
    if (e.type === 'eval') e.flags.filter(f => f.severity === 'warn' || ['lesson-enacted', 'explicit-null'].includes(f.check)).forEach(f => items.push([e.i, f.severity === 'warn' ? 'warn' : 'exp', `Check: ${f.check}${f.agent ? ` (${L(f.agent)})` : ''}`]));
  }
  $('#timeBody').innerHTML = items.length
    ? items.map(([i, cls, txt]) => `<li class="${cls}" tabindex="0" data-i="${i}"><span class="ix">#${i + 1}</span>${txt}</li>`).join('')
    : '<li class="empty">Revisions, failed predictions, interventions and memory writes will be listed here. Click one to jump the replay to that moment.</li>';
  $('#timeBody').querySelectorAll('li[data-i]').forEach(li => { li.onclick = li.onkeydown = ev => { if (ev.type === 'keydown' && ev.key !== 'Enter') return; if (S.running) return; S.cursor = +li.dataset.i; render(); }; });
}

function compare(evs) {
  const ids = agentIds(evs), ms = evs.filter(e => e.type === 'metrics');
  if (!ms.length) { $('#cmpBody').innerHTML = '<p class="empty">After episode 1, measured results appear here. After episode 2, you can see what changed.</p>'; return; }
  const rows = [
    ['Hardest items correct', 'discAcc', pct, true], ['All new items correct', 'testAcc', pct, true],
    ['Tests it expected to fail', 'falsifyRate', pct, true], ['Predictions that held', 'predAcc', pct, true],
    ['Final confidence', 'confidence', x => x ?? 'n/a', null], ['Confidence minus accuracy', 'calibrationGap', x => x ?? 'n/a', false],
    ['Said "nothing new"', 'claimedNothingNew', x => (x ? 'yes' : 'no'), null],
  ];
  $('#cmpBody').innerHTML = ids.map(id => {
    const m0 = ms.find(e => e.agent === id && e.ep === 0)?.metrics, m1 = ms.find(e => e.agent === id && e.ep === 1)?.metrics;
    return `<table><caption>${esc(labelOf(evs, id))}</caption><thead><tr><th>Measure</th><th>Episode 1</th><th>Episode 2</th><th>Change</th></tr></thead><tbody>${rows.map(([name, k, f, upGood]) => {
      const a = m0?.[k], b = m1?.[k];
      const d = typeof a === 'number' && typeof b === 'number' ? b - a : null;
      const cls = d == null || upGood == null || Math.abs(d) < 1e-9 ? '' : (d > 0) === upGood ? 'up' : 'down';
      const dTxt = d == null ? '' : (k === 'confidence' || k === 'calibrationGap' ? d.toFixed(2) : `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts`);
      return `<tr><td>${name}</td><td>${m0 ? f(a) : ''}</td><td>${m1 ? f(b) : ''}</td><td class="${cls}">${dTxt}</td></tr>`;
    }).join('')}</tbody></table>`;
  }).join('') + '<p class="note">One run is an anecdote. Compare conditions across many seeds with npm run batch before believing a difference.</p>';
}

function reflection(evs) {
  const ids = agentIds(evs), out = [];
  for (const id of ids) {
    const r = evs[lastIdx(evs, e => (e.type === 'reflection' || e.type === 'memory_write') && e.agent === id)];
    const s = evs[lastIdx(evs, e => e.type === 'synthesis' && e.agent === id)];
    if (!r && !s) continue;
    out.push(`<div class="block"><h4>${esc(labelOf(evs, id))}${r ? `, after episode ${r.ep + 1}` : ''}</h4>
      ${s ? `<p><b>Established:</b> ${esc(s.synthesis.established)}</p><p><b>Unresolved:</b> ${esc(s.synthesis.unresolved)}</p>` : ''}
      ${r?.type === 'reflection' ? `<p><b>Stated vs. actual:</b> ${esc(r.reflection.stated_vs_actual)}</p><p><b>Lesson:</b> ${esc(r.reflection.lesson)}</p><p><b>Proposes to test next:</b> ${esc(r.reflection.next_test)}</p>` : ''}
      ${r?.type === 'memory_write' ? `<p class="note">${esc(r.note)}</p>` : ''}
      ${r ? `<div class="diff"><div><b>Self-model before</b>\n${esc(fmtSelf(r.before))}</div><div><b>Self-model after</b>\n${esc(fmtSelf(r.after))}</div></div>` : ''}
      ${r ? promptDetails(r) : ''}</div>`);
  }
  const ev = evs[lastIdx(evs, e => e.type === 'eval')];
  if (ev) out.push(`<div class="block"><h4>Evaluator checks, episode ${ev.ep + 1}</h4><p class="note">Heuristic and fallible. Each flag shows its evidence so you can overrule it.</p>${ev.flags.length ? ev.flags.map(f => `<div class="flag ${f.severity}"><b>${esc(f.check)}</b>${f.agent ? `, ${esc(labelOf(evs, f.agent))}` : ''}: ${esc(f.evidence)}. <span class="note">${esc(f.note)}</span></div>`).join('') : '<p class="empty">No flags raised.</p>'}</div>`);
  const claims = evs.filter(e => e.type === 'turn').flatMap(e => e.turn.claims.map(c => ({ ...c, agent: e.agent })));
  if (claims.length) out.push(`<div class="block"><h4>Claims to examine</h4>${claims.slice(-8).map(c => `<p><span class="chip ${c.kind}">${c.kind}</span> ${esc(labelOf(evs, c.agent))}: ${esc(c.text)}</p>${c.kind === 'metaphor' || c.kind === 'experiential' ? '<p class="triage">What exactly is claimed? Metaphor, hypothesis, behavior, or experience? What observation would support or undercut it? Did it change any decision?</p>' : ''}`).join('')}</div>`);
  $('#reflBody').innerHTML = out.length ? out.join('') : '<p class="empty">Syntheses, reflections, memory diffs and evaluator flags appear at the end of each episode.</p>';
}
const fmtSelf = m => (!m ? '(empty)' : `strategy: ${m.selfModel.strategy || '(none)'}\nstrengths: ${m.selfModel.strengths.join('; ') || '(none)'}\nweaknesses: ${m.selfModel.weaknesses.join('; ') || '(none)'}\nlessons: ${m.lessons.join(' | ') || '(none)'}`);

buttons(); render();

// Auto-update notice: the launcher restarts the server when new code lands; offer a reload.
let version = null;
async function checkVersion() {
  try {
    const v = (await (await fetch('/api/version')).json()).version;
    if (version && v !== version) $('#updateBar').hidden = false;
    version ??= v;
  } catch { /* server restarting: try again next tick */ }
}
checkVersion(); setInterval(checkVersion, 30_000);
$('#reloadNow').onclick = () => location.reload();
