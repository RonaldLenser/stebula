// Findings tab: the registry of hypotheses, locked predictions, results, human comparison, and the
// isolation experiment runner. All numbers come from data/findings.json and the experiment results.
import { parseSse } from '/src/talk/sse.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = t => String(t || '').slice(0, 16).replace('T', ' ');
const F = { data: null, busy: '', msg: '', progress: [] };

async function call(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
async function postStream(path, body, onEvent) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', failed = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const p = parseSse(buf + dec.decode(value, { stream: true }));
    buf = p.rest;
    for (const e of p.events) { if (e.stage === 'error') failed = e.data.error; else onEvent(e.stage, e.data); }
  }
  if (failed) throw new Error(failed);
}

export async function loadFindings() {
  try { F.data = await call('/api/findings'); } catch (e) { F.msg = e.message; }
  renderFindings();
}

async function act(text, fn) {
  if (F.busy) return;
  F.busy = text; F.msg = ''; renderFindings();
  try { await fn(); F.data = await call('/api/findings'); } catch (e) { F.msg = e.message; }
  F.busy = ''; renderFindings();
}

const value = v => (v == null ? 'n/a' : Number(v).toFixed(3).replace(/\.?0+$/, '') || '0');
function humanPanel(f, d) {
  const a = d.humanAreas[f.humanArea];
  if (!a) return '<p class="note">No human research area is attached to this finding.</p>';
  const ev = d.evaluated[`${f.id}@${f.version}`];
  const shows = f.results.length ? `Latest: ${esc(ev.status)}, value ${value(ev.value)} over n = ${ev.n}. ${esc(a.stebula)}` : `No data yet. ${esc(a.stebula)}`;
  return `<div class="human"><p><b>${esc(a.title)}</b></p><p><b>What humans show.</b> ${esc(a.humans)}</p><p><b>What Stebula shows.</b> ${shows}</p><p><b>The key difference.</b> ${esc(a.difference)}</p>
    <p class="note">Citations (all unverified until checked against the source): ${a.citations.map(c => `${esc(c)} <b>(verify)</b>`).join('; ')}</p></div>`;
}

function card(f, d, old) {
  const ev = d.evaluated[`${f.id}@${f.version}`], m = d.catalog.find(x => x.name === f.metric.name);
  const status = old ? 'superseded' : f.status;
  const canTest = f.computable && m?.source === 'stats' && !old;
  return `<article class="finding ${status}" data-id="${esc(f.id)}">
    <header><b>${esc(f.id)}</b> <span class="note">version ${f.version}${f.origin === 'code' ? ', written by the app before any data' : ''}</span> <span class="fstatus ${status}">${esc(status)}</span>${f.needsExperiment ? ' <span class="fstatus needs">needs experiment</span>' : ''}</header>
    <p class="statement">${esc(f.statement)}</p>
    <p><b>Prediction</b> <span class="note">locked ${day(f.lockedAt)}, cannot be edited</span><br>${esc(f.prediction.text)}${f.computable ? ` <span class="note">(${esc(f.metric.name)}${f.metric.agent ? `, agent ${f.metric.agent}` : ''} ${esc(f.prediction.comparator)} ${esc(f.prediction.value)}, needs n of at least ${f.prediction.minN})</span>` : ''}</p>
    <p><b>Would count against it</b><br>${esc(f.refutedIf)}</p>
    ${f.needsExperiment ? `<p><b>Suggested design</b><br>${esc(f.design)}</p>` : ''}
    ${f.suggestedBy.length ? `<p class="note">Suggested by records: ${f.suggestedBy.map(esc).join(', ')}</p>` : ''}
    ${f.supersedes ? `<p class="note">Replaces ${esc(f.supersedes)}. Results from the old version do not carry over.</p>` : ''}
    ${f.results.length ? `<table class="rtable"><thead><tr><th>Date</th><th>Value</th><th>n</th><th>Outcome</th></tr></thead><tbody>${f.results.map(r => `<tr><td>${day(r.at)}</td><td>${value(r.value)}</td><td>${r.n}</td><td>${esc(r.outcome)}</td></tr>`).join('')}</tbody></table>
      ${m?.source === 'experiment' ? `<p class="note">Pooled over ${ev.n} run${ev.n === 1 ? '' : 's'}: ${value(ev.value)}. A single run never decides it.</p>` : ''}` : '<p class="note">No results yet.</p>'}
    ${old ? '' : `<div class="factions">${canTest ? '<button class="small" data-act="test">Test now</button>' : ''}
      ${f.computable && m?.source === 'experiment' ? '<span class="note">Fed automatically by each isolation experiment run.</span>' : ''}
      ${f.computable ? `<details class="revise"><summary>Revise (makes a new version)</summary>
        <label>Statement<textarea data-f="statement" rows="2">${esc(f.statement)}</textarea></label>
        <label>Comparator <select data-f="comparator">${['>', '<', '>=', '<='].map(c => `<option${c === f.prediction.comparator ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Value <input data-f="value" type="number" step="any" value="${esc(f.prediction.value)}"></label>
        <label>Minimum n <input data-f="minN" type="number" value="${f.prediction.minN}"></label>
        <button class="small" data-act="revise">Save as new version</button></details>` : ''}</div>`}
    <details><summary>Compare to humans</summary>${humanPanel(f, d)}</details></article>`;
}

function expTable(run) {
  if (!run) return '<p class="empty">No experiment has run yet.</p>';
  const conds = Object.entries(run.conditions);
  return `<p class="note">Run ${esc(run.runId)}, ${day(run.at)}. Each cell: traits expressed in the answers to the five questions, and self-prediction tests passed.</p>
    <table class="rtable"><thead><tr><th>Condition</th>${conds[0] ? conds[0][1].checkpoints.map(c => `<th>Step ${c.step}</th>`).join('') : ''}</tr></thead><tbody>${conds.map(([name, c]) => `<tr><td title="${esc(c.description)}">${esc(name)}</td>${c.checkpoints.map(cp => `<td>${cp.traits.length} traits, ${cp.selfpredict.yes}/${cp.selfpredict.n}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function renderFindings() {
  const d = F.data;
  const off = !d?.live || !!F.busy;
  $('#fGenerate').disabled = off; $('#fRun').disabled = off;
  $('#fStatus').textContent = F.busy || F.msg || '';
  $('#fStatus').className = F.msg && !F.busy ? 'err' : 'note';
  if (!d) { $('#fList').innerHTML = '<p class="empty">Loading.</p>'; return; }
  $('#fLocks').innerHTML = d.locksOk ? '' : `<p class="err">A locked prediction no longer matches its lock hash: ${d.tampered.map(esc).join(', ')}. The registry file was edited by hand.</p>`;
  const cur = d.registry.findings.filter(f => !f.supersededBy), old = d.registry.findings.filter(f => f.supersededBy);
  $('#fList').innerHTML = (cur.length ? cur.map(f => card(f, d, false)).join('') : '<p class="empty">No findings yet.</p>') + (old.length ? `<details><summary>Earlier versions (${old.length})</summary>${old.map(f => card(f, d, true)).join('')}</details>` : '');
  $('#fStats').innerHTML = Object.keys(d.stats).length ? `<table class="rtable"><thead><tr><th>Statistic</th><th>Value</th><th>n</th></tr></thead><tbody>${Object.entries(d.stats).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${value(v.value)}</td><td>${v.n}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No statistics yet. Talk, read, or run self-prediction tests.</p>';
  $('#fExpResult').innerHTML = expTable(d.experiment);
  $('#fProgress').textContent = F.progress.slice(-6).join(' ');
  for (const el of document.querySelectorAll('#fList .finding')) {
    const id = el.dataset.id;
    el.querySelector('[data-act=test]')?.addEventListener('click', () => act('Testing against stored data.', () => call('/api/findings/test', { id })));
    el.querySelector('[data-act=revise]')?.addEventListener('click', () => {
      const g = k => el.querySelector(`[data-f=${k}]`).value;
      act('Saving a new version.', () => call('/api/findings/revise', { id, changes: { statement: g('statement'), prediction: { comparator: g('comparator'), value: Number(g('value')), minN: Number(g('minN')), text: '' } } }));
    });
  }
}

export function initFindings() {
  $('#fGenerate').onclick = () => act('Asking the model for up to 3 hypotheses from the stats.', async () => { const r = await call('/api/findings/generate', {}); F.msg = `${r.created} proposed.${r.rejected.length ? ` ${r.rejected.length} rejected: ${r.rejected.map(x => x.why).join('; ')}` : ''}`; });
  $('#fExport').onclick = async () => {
    const list = (await call('/api/export')).exports;
    for (const e of list) { const a = Object.assign(document.createElement('a'), { href: `/api/export/${e.name}.csv`, download: `stebula-${e.name}.csv` }); document.body.appendChild(a); a.click(); a.remove(); await new Promise(r => setTimeout(r, 300)); }
    F.msg = 'Exported. Copies are also saved in data/exports/.'; renderFindings();
  };
  const est = () => {
    const n = [...document.querySelectorAll('#fConds input:checked')].length, steps = Number($('#fSteps').value) || 6, every = Number($('#fEvery').value) || 3;
    const cps = Math.floor(steps / every) + 1 + (steps % every ? 1 : 0);
    $('#fEstimate').textContent = `About ${n * (cps * 7 + steps * 3)} model calls for ${n} condition${n === 1 ? '' : 's'} (the baseline skips the steps). This costs real API credit.`;
  };
  for (const el of ['#fSteps', '#fEvery']) $(el).oninput = est;
  $('#fConds').onchange = est;
  $('#fRun').onclick = () => act('Running the isolation experiment. This takes a while.', async () => {
    F.progress = [];
    const conditions = [...document.querySelectorAll('#fConds input:checked')].map(i => i.value);
    await postStream('/api/experiment', { conditions, steps: Number($('#fSteps').value), every: Number($('#fEvery').value) }, (stage, data) => {
      F.progress.push(stage === 'finished' ? `Finished run ${data.runId}.` : `${data.condition}: ${stage} ${data.step}.`);
      $('#fProgress').textContent = F.progress.slice(-6).join(' ');
    });
  });
  est();
}
