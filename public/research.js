// Research: findings with locked predictions and pilot labels, methods and sources, limitations, and the
// architectural indicators. Nothing here is a score of consciousness, and no label is stronger than the data.
import { $, $$, esc, fmt, isNum, when, api, markdown } from '/core.js';
import { INDICATORS, SCORECARD_CAVEATS } from '/src/talk/indicators.js';
import { syncRecorder } from '/store.js';

const F = { data: null, busy: '', msg: '', docs: {} };
const val = v => (isNum(v) ? Number(v).toFixed(3).replace(/\.?0+$/, '') || '0' : '<span class="nodata">No data</span>');
const STATUS_CLASS = { 'pilot-consistent': 'ok', 'pilot-inconsistent': 'bad', testing: 'warn', inconclusive: 'warn', exploratory: 'warn', proposed: '' };
const STATUS_NAME = { 'pilot-consistent': 'Pilot: consistent', 'pilot-inconsistent': 'Pilot: not consistent', exploratory: 'Exploratory', inconclusive: 'Inconclusive', testing: 'Testing', proposed: 'Proposed' };

async function load() {
  try { F.data = await api('/api/findings'); F.msg = ''; syncRecorder(F.data.recorder); } catch (e) { F.msg = e.message; F.data = null; }
  render();
}
async function act(text, fn) {
  if (F.busy) return;
  F.busy = text; F.msg = ''; render();
  try { await fn(); F.data = await api('/api/findings'); syncRecorder(F.data.recorder); } catch (e) { F.msg = e.message; }
  F.busy = ''; render();
}

function human(f, d) {
  const a = d.humanAreas[f.humanArea];
  if (!a) return '<p class="note">No human research area is attached to this finding.</p>';
  const ev = d.evaluated[`${f.id}@${f.version}`];
  return `<div class="human"><p><b>${esc(a.title)}</b></p><p><b>What humans show.</b> ${esc(a.humans)}</p><p><b>What Stebula shows.</b> ${f.results.length ? `Latest: ${esc(STATUS_NAME[ev.status] || ev.status)}, value ${val(ev.value)} over n = ${ev.n}. ` : 'No data yet. '}${esc(a.stebula)}</p><p><b>The key difference.</b> ${esc(a.difference)}</p>
    <p class="note">Citations are unverified until checked against the source: ${a.citations.map(c => `${esc(c)} <b>(verify)</b>`).join('; ')}</p></div>`;
}
function card(f, d, old) {
  const ev = d.evaluated[`${f.id}@${f.version}`], m = d.catalog.find(x => x.name === f.metric.name);
  const status = old ? 'superseded' : f.status;
  const canTest = f.computable && m?.source === 'stats' && !old;
  return `<article class="finding ${esc(status)}" data-id="${esc(f.id)}">
    <header><b>${esc(f.id)}</b> <span class="note">version ${f.version}${f.origin === 'code' ? ', written by the app before any data' : ''}</span> <span class="chip ${STATUS_CLASS[status] || ''}">${esc(old ? 'superseded' : STATUS_NAME[status] || status)}</span>${f.needsExperiment ? ' <span class="chip warn">needs an experiment</span>' : ''}</header>
    <p class="statement">${esc(f.statement)}</p>
    ${old ? '' : `<p class="note">${esc(d.statusText[status] || '')}</p>`}
    <p><b>Prediction</b> <span class="note">locked ${when(f.lockedAt)}, cannot be edited</span><br>${esc(f.prediction.text)}${f.computable ? ` <span class="note">(${esc(f.metric.name)}${f.metric.agent ? `, agent ${esc(f.metric.agent)}` : ''} ${esc(f.prediction.comparator)} ${esc(f.prediction.value)}, at least ${f.prediction.minN} ${m?.source === 'experiment' ? 'independent runs' : 'observations'})</span>` : ''}</p>
    <p><b>Would count against it</b><br>${esc(f.refutedIf)}</p>
    ${f.needsExperiment ? `<p><b>Suggested design</b><br>${esc(f.design)}</p>` : ''}
    ${f.suggestedBy.length ? `<p class="note">Suggested by records: ${f.suggestedBy.map(esc).join(', ')}. Because it was suggested by existing data, it is tested only on data recorded after the lock.</p>` : ''}
    ${f.supersedes ? `<p class="note">Replaces ${esc(f.supersedes)}. Results from the old version do not carry over.</p>` : ''}
    ${f.results.length ? `<div class="tablewrap"><table><thead><tr><th>Date</th><th class="num">Value</th><th class="num">n</th><th>Data used</th><th>Label</th></tr></thead><tbody>${f.results.map(r => `<tr><td>${esc(when(r.at))}</td><td class="num">${val(r.value)}</td><td class="num">${r.n}${r.invalid ? ` <span class="chip">${r.invalid} invalid</span>` : ''}</td><td>${r.scope === 'since-lock' ? 'recorded after the lock' : r.scope === 'run' ? `run ${esc(r.runId)}` : 'all data, including data from before the lock'}</td><td>${esc(STATUS_NAME[r.outcome] || r.outcome)}</td></tr>`).join('')}</tbody></table></div>
      ${m?.source === 'experiment' ? `<p class="note">Pooled over ${ev.n} independent run${ev.n === 1 ? '' : 's'}: ${val(ev.value)}. A single run never decides it. Duplicate runs are ignored.</p>` : ''}` : '<p class="note">No results yet.</p>'}
    ${old ? '' : `<div class="factions">${canTest ? '<button class="btn small" data-act="test">Test on data recorded since the lock</button>' : ''}
      ${f.computable && m?.source === 'experiment' ? '<span class="note">Fed automatically by each completed experiment run under Experiments.</span>' : ''}
      ${f.computable ? `<details class="revise"><summary>Revise (makes a new version with no results)</summary>
        <label>Statement<textarea data-f="statement" rows="2">${esc(f.statement)}</textarea></label>
        <label>Comparator <select data-f="comparator">${['>', '<', '>=', '<='].map(c => `<option${c === f.prediction.comparator ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
        <label>Value <input data-f="value" type="number" step="any" value="${esc(f.prediction.value)}"></label>
        <label>Minimum n <input data-f="minN" type="number" value="${f.prediction.minN}"></label>
        <button class="btn small" data-act="revise">Save as new version</button></details>` : ''}</div>`}
    <details><summary>Compare to humans</summary>${human(f, d)}</details></article>`;
}

function render() {
  const d = F.data, off = !d?.live || !!F.busy;
  $('#fGenerate').disabled = off;
  $('#fStatus').textContent = F.busy || F.msg || ''; $('#fStatus').className = F.msg && !F.busy ? 'err' : 'note';
  if (!d) { $('#fList').innerHTML = F.msg ? `<div class="alert">${esc(F.msg)}</div>` : '<p class="empty">Loading.</p>'; return; }
  $('#fLocks').innerHTML = (d.locksOk ? '' : `<div class="alert"><b>A locked prediction no longer matches its lock hash:</b> ${d.tampered.map(esc).join(', ')}. The registry file was edited by hand.</div>`)
    + (d.recorder && !d.recorder.ok ? `<div class="alert"><b>The research record had ${d.recorder.failedWrites} failed write${d.recorder.failedWrites > 1 ? 's' : ''}.</b> Exports may be incomplete. Last error: ${esc(d.recorder.lastError || 'unknown')}. ${d.recorder.pending} line${d.recorder.pending === 1 ? '' : 's'} waiting to be written.</div>` : '');
  const cur = d.registry.findings.filter(f => !f.supersededBy), old = d.registry.findings.filter(f => f.supersededBy);
  $('#fList').innerHTML = (cur.length ? cur.map(f => card(f, d, false)).join('') : '<p class="empty">No findings yet. Generate hypotheses once there is recorded conversation, or run an experiment.</p>') + (old.length ? `<details><summary>Earlier versions (${old.length})</summary>${old.map(f => card(f, d, true)).join('')}</details>` : '');
  $('#fStats').innerHTML = Object.keys(d.stats).length ? `<div class="tablewrap"><table><thead><tr><th>Statistic</th><th class="num">Value</th><th class="num">n</th></tr></thead><tbody>${Object.entries(d.stats).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${val(v.value)}</td><td class="num">${v.n}${v.invalid ? ` <span class="chip">${v.invalid} invalid</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No statistics yet. Talk with an agent, or run self-prediction tests.</p>';
  for (const el of $$('#fList .finding')) {
    const id = el.dataset.id;
    el.querySelector('[data-act=test]')?.addEventListener('click', () => act('Testing on data recorded since the lock.', () => api('/api/findings/test', { id })));
    el.querySelector('[data-act=revise]')?.addEventListener('click', () => { const g = k => el.querySelector(`[data-f=${k}]`).value; act('Saving a new version.', () => api('/api/findings/revise', { id, changes: { statement: g('statement'), prediction: { comparator: g('comparator'), value: Number(g('value')), minN: Number(g('minN')), text: '' } } })); });
  }
}

async function doc(path, el, fallback) {
  if (F.docs[path]) { el.innerHTML = F.docs[path]; return; }
  try { const r = await fetch(path); if (!r.ok) throw new Error(); F.docs[path] = markdown(await r.text()); el.innerHTML = F.docs[path]; }
  catch { el.innerHTML = fallback; }
}
function scorecard() {
  const n = s => INDICATORS.filter(i => i.status === s).length;
  $('#scoreSummary').innerHTML = `<span><span class="status implemented">implemented</span> ${n('implemented')}</span><span><span class="status partial">partial analog</span> ${n('partial')}</span><span><span class="status absent">absent</span> ${n('absent')}</span><span><span class="status">cannot tell</span> ${n('unknown')}</span><span class="note">of ${INDICATORS.length} indicators. A count of properties, not a measure of anything felt.</span>`;
  $('#scoreTable').innerHTML = `<thead><tr><th>Indicator</th><th>Theory</th><th>What it requires</th><th>Status</th><th>Where in Stebula</th><th>What is missing</th></tr></thead><tbody>${INDICATORS.map(i => `<tr><td>${esc(i.id)}</td><td>${esc(i.theory)}</td><td>${esc(i.text)}</td><td><span class="status ${esc(i.status)}">${i.status === 'unknown' ? 'cannot tell' : esc(i.status)}</span></td><td>${esc(i.where || '')}</td><td>${esc(i.gap)}</td></tr>`).join('')}</tbody>`;
  $('#scoreCaveats').innerHTML = `<p><b>Read this before quoting the count.</b></p><ul class="list">${SCORECARD_CAVEATS.map(c => `<li>${esc(c)}</li>`).join('')}</ul><p>Bottom line: this agent implements some of the functional structure these theories describe, in simplified form. Whether anything is experienced is not answered here, and this page cannot answer it.</p>`;
}

const METHODS = `<h2>Methods</h2>
<p>Stebula keeps four kinds of thing apart, and every view says which one it is showing.</p>
<ul class="list"><li><b>Generated proposals.</b> What a model wrote: thoughts, replies, proposed evidence quotes. Treated as data, never as ground truth.</li>
<li><b>External memory.</b> Text in a file that is pasted into prompts. This is the only thing that changes between turns. Model weights never change.</li>
<li><b>Observed behavior.</b> What the agent did, measured by code: the questions it asked, the tests it chose, accuracy against a known rule.</li>
<li><b>Inaccessible internals.</b> What happens inside the model. Nothing here shows it, and the process view is software state around the model, not neural activity.</li></ul>
<h3>How a question becomes a finding</h3>
<ol class="list"><li>The prediction, the metric and what would count against it are written down and locked with a hash before anything is tested. A change makes a new version with no inherited results.</li>
<li>An experiment writes its protocol (design, predictions, parameters, code revision) to disk before its first model call.</li>
<li>Data collected before the lock cannot test it. A hypothesis suggested by existing statistics is tested only on data recorded afterwards.</li>
<li>Results use pilot labels: consistent or not consistent with the prediction, with the sample size and an interval where there are enough pairs. This is not a significance test.</li>
<li>A step that fails after bounded retries is invalid. Invalid trials are counted and shown, and never enter an average.</li></ol>
<h3>Human comparison</h3><div id="humanDoc"></div>
<h3>Data</h3><p>Every model call, with its full prompt, raw output, stop reason, usage and the memory ids supplied, is appended to data/records. The CSV downloads under Findings are built from it. <a href="/docs/DATA_DICTIONARY.md" target="_blank" rel="noopener">Data dictionary</a>.</p>`;

// Called by the Lab when one of the reading panes is shown.
export function onResearchPane(id) {
  if (id === 'findings') load();
  if (id === 'methods') { $('#methodsBody').innerHTML = METHODS; doc('/docs/HUMAN_COMPARISON.md', $('#humanDoc'), '<p class="nodata">The human comparison document is not available in this copy.</p>'); }
  if (id === 'limits') doc('/docs/LIMITATIONS.md', $('#limitsBody'), '<p class="nodata">The limitations document is not available in this copy.</p>');
  if (id === 'score') scorecard();
}
export function initResearch() {
  $('#fGenerate').onclick = () => act('Asking the model for up to 3 hypotheses from the stats.', async () => { const r = await api('/api/findings/generate', {}); F.msg = `${r.created} proposed.${r.rejected.length ? ` ${r.rejected.length} rejected: ${r.rejected.map(x => x.why).join('; ')}` : ''}`; });
  $('#fExport').onclick = async () => {
    try {
      const list = (await api('/api/export')).exports;
      for (const e of list) {
        const t = localStorage.getItem('stebula.token');
        const r = await fetch(`/api/export/${e.name}.csv`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
        if (!r.ok) throw new Error(`Export failed (${r.status})`);
        const incomplete = r.headers.get('x-record-complete') === 'false';
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await r.blob()), download: `stebula-${e.name}.csv` });
        document.body.appendChild(a); a.click(); a.remove();
        if (incomplete) F.msg = 'Exported, but the research record had a write failure, so these files may be incomplete.';
        await new Promise(x => setTimeout(x, 250));
      }
      F.msg ||= 'Exported. Copies are also saved in data/exports/.';
    } catch (e) { F.msg = e.message; }
    render();
  };
}
