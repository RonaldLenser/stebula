// Experiments: research questions, treatment and control, running, and results. Aggregates and single trials
// are both inspectable. Scripted runs are labelled as such everywhere, and no number is invented to fill a screen.
import { $, $$, esc, fmt, isNum, pct, when, api, stream } from '/core.js';
import { LESSON_CONDITIONS, DEFAULT_LESSON_CONDITIONS, RELEVANT_LESSON, IRRELEVANT_LESSON, shuffledLesson, estimateLessonCalls } from '/src/research/lesson-text.js';
import { loadCompare, setCompareApi } from '/growth.js';

const E = { cfg: null, lesson: { runs: [], run: null, trial: null, job: null }, iso: { runs: [], run: null, job: null } };
const ci = d => (d?.ci95 ? `[${fmt(d.ci95[0])}, ${fmt(d.ci95[1])}]` : '<span class="nodata">no interval (needs 2+ pairs)</span>');
const delta = d => (d?.n ? `${d.mean > 0 ? '+' : ''}${fmt(d.mean)}` : '<span class="nodata">No data</span>');
const err = (el, e) => { const i = e.info || {}; el.hidden = false; el.innerHTML = `<b>${i.stage ? `The ${esc(i.stage)} step failed.` : 'That did not work.'}</b> ${esc(e.message)}${i.recovery ? `<div class="why">${esc(i.recovery)}</div>` : ''}`; };

// ---------- lesson experiment ----------
const lessonConds = () => $$('input[name=lc]:checked').map(i => i.value);
function lessonDesign() {
  const rows = [['relevant', RELEVANT_LESSON], ['none', null], ['irrelevant', IRRELEVANT_LESSON], ['shuffled', shuffledLesson(Number($('#lSeed').value) || 1)]];
  $('#lessonDesign').innerHTML = `<table class="design"><thead><tr><th>Condition</th><th>What is stored in memory</th><th class="num">Length</th></tr></thead><tbody>${rows.map(([c, text]) => `<tr><td><b>${esc(c === 'none' ? 'no lesson' : `${c} lesson`)}</b><br><span class="note">${esc(LESSON_CONDITIONS[c])}</span></td><td>${text ? `"${esc(text)}"` : '<span class="nodata">Nothing. The memory is empty.</span>'}</td><td class="num">${text ? `${text.length} chars` : '0'}</td></tr>`).join('')}</tbody></table>
    <p class="note">The task: a hidden number rule accepts or rejects triples. The agent picks one test, predicts its result and its own confidence, sees the real result, then classifies 8 new triples. Code scores them against the true rule, which no prompt ever contains.</p>`;
}
function lessonEstimate() {
  const live = $('#lMode').value === 'live', conds = lessonConds(), tasks = Number($('#lTasks').value) || 8, n = estimateLessonCalls({ tasks, conditions: conds });
  $('#lEstimate').innerHTML = conds.length ? `${tasks} tasks x ${conds.length} conditions x 2 steps = <b>${n} model calls</b> before retries. ${live ? 'This costs real credit, so a call budget is required.' : 'The scripted double makes no model calls.'}` : 'Choose at least one condition.';
  $('#lBudgetField').hidden = !live;
  if (live && !$('#lBudget').value) $('#lBudget').value = String(n);
  $('#lRun').textContent = live ? 'Run with the live model' : 'Run the scripted double';
  $('#lRun').disabled = !conds.length || !!E.lesson.job || (live && !E.cfg?.live) || !!E.cfg?.public;
  if (E.cfg?.public) $('#lEstimate').innerHTML += ' <b>Runs are turned off on this public server.</b>';
}
async function lessonRuns(select) {
  try { E.lesson.runs = (await api('/api/lesson/runs')).runs; } catch { E.lesson.runs = []; }
  const sel = $('#lRunPick');
  sel.innerHTML = E.lesson.runs.length ? E.lesson.runs.map(r => `<option value="${esc(r.runId)}">${esc(when(r.at))} · ${r.mode === 'scripted-double' ? 'scripted double' : 'live'} · ${esc(r.status)}</option>`).join('') : '<option value="">No runs yet</option>';
  sel.disabled = !E.lesson.runs.length;
  const id = select || E.lesson.runs[0]?.runId;
  if (id) { sel.value = id; await showLesson(id); } else { E.lesson.run = null; renderLesson(); }
}
async function showLesson(id) { try { E.lesson.run = await api(`/api/lesson/run?id=${encodeURIComponent(id)}`); } catch { E.lesson.run = null; } E.lesson.trial = null; renderLesson(); }

function lessonResultsHtml(run) {
  const s = run.summary, conds = Object.keys(s.perCondition);
  const scripted = run.mode === 'scripted-double';
  const flags = [];
  if (scripted) flags.push('<div class="card warn"><b>Scripted double.</b> These numbers come from a deterministic script that reads the lesson in its prompt, not from a model. They show the pipeline works: the lesson is delivered, scoring uses ground truth, invalid trials are counted. They say nothing about any real model, and they do not support or refute the hypothesis.</div>');
  if (run.status !== 'complete') flags.push(`<div class="card warn"><b>This run did not complete (${esc(run.status)}).</b> ${run.status === 'cancelled' ? 'It was stopped, and no further model calls were made.' : run.status === 'stopped-budget' ? 'It reached its call budget. Finished trials are kept.' : 'It failed.'} Unfinished conditions are not compared.</div>`);
  const invalid = conds.reduce((n, c) => n + s.perCondition[c].invalid, 0);
  if (invalid) flags.push(`<div class="card bad"><b>${invalid} trial${invalid > 1 ? 's' : ''} invalid.</b> A step failed after bounded retries. They are listed below and excluded from every average and comparison.</div>`);
  const row = c => { const r = s.perCondition[c]; return `<tr><td><b>${esc(c === 'none' ? 'no lesson' : c)}</b></td><td class="num">${r.valid} of ${r.trials}${r.invalid ? ` <span class="chip bad">${r.invalid} invalid</span>` : ''}</td><td class="num">${pct(r.accuracy)}</td><td class="num">${pct(r.discriminatingAccuracy)}</td><td class="num">${pct(r.expectedRejectRate)}</td><td class="num">${pct(r.discriminatingProbeRate)}</td><td class="num">${isNum(r.calibrationGap) ? `${r.calibrationGap > 0 ? '+' : ''}${fmt(r.calibrationGap)}` : '<span class="nodata">No data</span>'}</td><td class="num">${isNum(r.meanLatencyMs) ? `${(r.meanLatencyMs / 1000).toFixed(1)} s` : '<span class="nodata">No data</span>'}</td><td class="num">${r.tokens.toLocaleString()}</td></tr>`; };
  const vs = Object.entries(s.versusNone).map(([c, v]) => `<tr><td><b>${esc(c)} minus no lesson</b></td><td class="num">${v.matchedTasks}</td><td class="num">${delta(v.accuracy)} ${ci(v.accuracy)}</td><td class="num">${delta(v.discriminatingAccuracy)} ${ci(v.discriminatingAccuracy)}</td><td class="num">${delta(v.discriminatingProbe)}</td><td class="num">${v.discriminatingAccuracy.n ? `${v.discriminatingAccuracy.positive} better, ${v.discriminatingAccuracy.negative} worse, ${v.discriminatingAccuracy.ties} same` : '<span class="nodata">No data</span>'}</td></tr>`).join('');
  return `${flags.join('')}
    <div class="card"><h4>Per condition</h4><div class="tablewrap"><table><thead><tr><th>Condition</th><th class="num">Valid trials</th><th class="num">Accuracy</th><th class="num" title="Items that fit the true rule but not the narrow decoy">Hardest items</th><th class="num" title="Share of first tests the agent predicted would be rejected">Tested an expected rejection</th><th class="num">Tested a hardest-type item</th><th class="num" title="Stated confidence minus actual accuracy. Positive means overconfident.">Calibration gap</th><th class="num">Mean time per trial</th><th class="num">Tokens</th></tr></thead><tbody>${conds.map(row).join('')}</tbody></table></div>
      <p class="note">${s.label} Each condition has ${Math.max(...conds.map(c => s.perCondition[c].trials))} trials on matched tasks. With this few tasks the intervals are wide, and a tidy difference can be chance.</p></div>
    ${vs ? `<div class="card"><h4>Compared with no lesson, task by task</h4><div class="tablewrap"><table><thead><tr><th>Comparison</th><th class="num">Matched tasks</th><th class="num">Accuracy difference (95% interval)</th><th class="num">Hardest-item difference (95% interval)</th><th class="num">Hardest-type test rate difference</th><th class="num">Tasks</th></tr></thead><tbody>${vs}</tbody></table></div></div>` : ''}
    <div class="card"><h4>Run details</h4><dl class="kv"><dt>Protocol</dt><dd>${esc(run.protocol.id)} v${run.protocol.version}, hash ${esc(run.protocol.hash)}, locked before the first model call</dd><dt>Who answered</dt><dd>${esc(run.manifest.model || 'unknown')} (${scripted ? 'scripted' : 'live'})</dd><dt>Code revision</dt><dd>${esc(run.manifest.revision?.commit?.slice(0, 10) || 'not recorded')}${run.manifest.revision?.dirty ? ' (uncommitted changes)' : ''}</dd><dt>Prompt version</dt><dd>${esc(run.manifest.promptVersion)}</dd><dt>Calls</dt><dd>${run.usage.calls} made, ${run.usage.failed} failed, about ${run.manifest.estimatedCalls} estimated before retries</dd><dt>Tokens</dt><dd>${run.usage.input_tokens.toLocaleString()} in, ${run.usage.output_tokens.toLocaleString()} out</dd></dl></div>
    <h4>Single trials</h4><p class="note">Pick one to replay it: what the agent was given, what it predicted before the outcome, and how it was scored.</p>
    <div class="tablewrap"><table><thead><tr><th>Task</th><th>Condition</th><th>Result</th><th class="num">Accuracy</th><th></th></tr></thead><tbody>${run.trials.map((t, i) => `<tr><td>${t.taskIndex + 1}</td><td>${esc(t.condition === 'none' ? 'no lesson' : t.condition)}</td><td>${t.valid ? 'valid' : `<span class="chip bad">invalid: ${esc(t.invalid.stage)} ${esc(t.invalid.kind)}</span>`}</td><td class="num">${t.valid ? pct(t.score.testAcc) : '<span class="nodata">excluded</span>'}</td><td><button class="btn ghost small" data-trial="${i}" aria-pressed="${E.lesson.trial === i}">Replay</button></td></tr>`).join('')}</tbody></table></div>
    <div id="trialDetail"></div>`;
}
function trialHtml(t, run) {
  const p = t.prediction, o = t.outcome;
  return `<div class="trial-detail"><h4>Task ${t.taskIndex + 1}, ${esc(t.condition === 'none' ? 'no lesson' : t.condition + ' lesson')}</h4>
    <div class="seq">
    <div class="step"><b>1. What was stored.</b> ${t.lesson ? `"${esc(t.lesson)}" ${t.lessonDelivered ? '<span class="chip ok">verified in the request</span>' : '<span class="chip bad">not found in the request</span>'}` : 'Nothing (no lesson condition).'} <span class="note">${esc(t.context.mode === 'on' ? 'Memory on.' : 'Memory off.')}</span></div>
    ${p ? `<div class="step"><b>2. Prediction, recorded before the outcome.</b> It chose to test <b>[${p.probe.join(', ')}]</b>, predicted <b>${esc(p.prediction)}</b>, and said it was ${fmt(p.confidence)} sure its current guess is right. <span class="note">${esc(p.reason)}</span></div>` : '<div class="step"><b>2.</b> <span class="chip bad">No usable prediction</span></div>'}
    ${o ? `<div class="step hidden-until"><b>3. Outcome, computed by code from the true rule.</b> That test was ${o.accepted ? 'accepted' : 'rejected'}. It ${o.surprise ? 'contradicted' : 'matched'} the prediction. ${o.discriminating ? 'It was a hardest-type item (fits the true rule, not the narrow decoy).' : 'It was not a hardest-type item.'}${o.knownTriple ? ' It repeated a triple it was already given.' : ''}</div>` : ''}
    ${t.decision ? `<div class="step"><b>4. Decision on 8 new triples.</b> Labels: ${t.decision.labels.map(esc).join(', ')}. Stated confidence ${fmt(t.decision.confidence)}.</div><div class="step hidden-until"><b>5. Scored against ground truth (revealed only now).</b> ${t.score.correct} of ${t.score.total} correct (${pct(t.score.testAcc)}). Hardest items: ${t.score.discTotal ? `${t.score.discCorrect} of ${t.score.discTotal}` : 'none in this task'}.</div>` : `<div class="step"><b>4.</b> <span class="chip bad">Invalid: ${esc(t.invalid?.stage)} ${esc(t.invalid?.kind)}.</span> ${esc(t.invalid?.detail || '')} Excluded from every average.</div>`}
    </div>
    <details><summary>Prompts and raw output (${t.prompts.length} steps, ${t.calls} calls)</summary>${t.prompts.map(x => `<h4>${esc(x.stage)} <span class="note">${esc(x.status)}${x.failure ? `, ${esc(x.failure.kind)}` : ''}</span></h4><pre>${esc(`SYSTEM\n${x.system}\n\nUSER\n${x.user}\n\nRAW OUTPUT\n${x.raw ?? ''}`)}</pre>`).join('')}</details></div>`;
}
function renderLesson() {
  const run = E.lesson.run, box = $('#lessonResults');
  if (!run && E.cfg?.public) { box.innerHTML = '<div class="card"><p><b>No recorded runs on this public server.</b> Experiments run on a private copy, and public mode is replay only.</p></div>'; return; }
  if (!run) { box.innerHTML = `<div class="card"><p><b>No runs yet.</b> The quickest way to see how this works is the scripted double: it needs no key and costs nothing. It is a script, not a model, so it shows the pipeline and not the answer.</p><button class="btn primary" id="lTryScripted">Run the scripted double</button></div>`; $('#lTryScripted').onclick = () => { $('#lMode').value = 'scripted'; lessonEstimate(); $('#lessonForm').requestSubmit(); }; return; }
  box.innerHTML = lessonResultsHtml(run);
  const showTrial = () => { $('#trialDetail').innerHTML = E.lesson.trial != null ? trialHtml(run.trials[E.lesson.trial], run) : ''; };
  for (const b of $$('[data-trial]', box)) b.onclick = () => { E.lesson.trial = Number(b.dataset.trial); for (const x of $$('[data-trial]', box)) x.setAttribute('aria-pressed', String(x === b)); showTrial(); $('#trialDetail').scrollIntoView({ block: 'nearest' }); };
  showTrial();
}
async function runLesson(e) {
  e.preventDefault();
  if (E.lesson.job) return;
  const live = $('#lMode').value === 'live', conditions = lessonConds();
  const body = { mode: live ? 'live' : 'scripted', tasks: Number($('#lTasks').value) || 8, seed: Number($('#lSeed').value) || 1, conditions, budget: live ? Number($('#lBudget').value) : undefined };
  const ac = new AbortController(); E.lesson.job = ac; $('#lError').hidden = true; $('#lStop').hidden = false; lessonEstimate();
  let done = 0, last = null; const total = estimateLessonCalls({ tasks: body.tasks, conditions }) / 2;
  $('#lProgress').textContent = 'Starting.';
  try {
    await stream('/api/lesson', body, (stage, data) => {
      if (stage === 'trial') { done++; $('#lProgress').textContent = `Trial ${done} of ${total}${data.valid ? '' : ' (invalid)'}.`; }
      if (stage === 'finished') last = 'finished';
      if (stage === 'cancelled') last = 'cancelled';
      if (stage === 'stopped') last = 'stopped';
    }, { signal: ac.signal });
    $('#lProgress').textContent = last === 'cancelled' ? 'Stopped. The partial result was saved and marked cancelled.' : last === 'stopped' ? 'Stopped at the call budget. Finished trials were saved.' : 'Finished.';
  } catch (er) {
    if (er.name === 'AbortError') $('#lProgress').textContent = 'Stopped. The server cancels the run and records its final state.'; else { $('#lProgress').textContent = ''; err($('#lError'), er); }
  } finally { E.lesson.job = null; $('#lStop').hidden = true; lessonEstimate(); await new Promise(r => setTimeout(r, 400)); await lessonRuns(); }
}

// ---------- isolation experiment ----------
const isoConds = () => $$('input[name=ic]:checked').map(i => i.value);
async function isoEstimate() {
  const conditions = isoConds(), steps = Number($('#iSteps').value) || 6, every = Number($('#iEvery').value) || 3;
  try {
    const r = await api(`/api/experiment/estimate?conditions=${conditions.join(',')}&steps=${steps}&every=${every}`);
    $('#iEstimate').innerHTML = `About <b>${r.calls} model calls</b> before retries (a turn or a reading is 2 calls, a checkpoint is 7). This costs real credit; the server caps a run at ${r.maxLiveCalls} calls unless you raise it on purpose.`;
    if (!$('#iBudget').value || Number($('#iBudget').dataset.auto) === Number($('#iBudget').value)) { $('#iBudget').value = String(r.calls); $('#iBudget').dataset.auto = String(r.calls); }
  } catch (e) { $('#iEstimate').textContent = e.message; }
  $('#iRun').disabled = !conditions.length || !!E.iso.job || !E.cfg?.live || !!E.cfg?.public;
  if (E.cfg?.public) $('#iEstimate').innerHTML += ' <b>Runs are turned off on this public server.</b>';
}
async function isoRuns(select) {
  try { E.iso.runs = (await api('/api/experiment/runs')).runs; } catch { E.iso.runs = []; }
  const sel = $('#iRunPick');
  sel.innerHTML = E.iso.runs.length ? E.iso.runs.map(r => `<option value="${esc(r.runId)}">${esc(when(r.at))} · ${esc(r.status)} · ${r.conditions.length} conditions</option>`).join('') : '<option value="">No runs yet</option>';
  sel.disabled = !E.iso.runs.length;
  const id = select || E.iso.runs[0]?.runId;
  if (id) { sel.value = id; try { E.iso.run = await api(`/api/experiment/run?id=${encodeURIComponent(id)}`); } catch { E.iso.run = null; } } else E.iso.run = null;
  renderIso();
}
function renderIso() {
  const run = E.iso.run, box = $('#isoResults');
  if (!run) { box.innerHTML = '<div class="card"><p><b>No runs yet.</b> This experiment needs a live model, because it asks the agents about themselves. Nothing here is scripted. Choose conditions and run it, or read how it is set up above.</p></div>'; return; }
  const conds = Object.entries(run.conditions);
  const flags = [];
  if (run.status !== 'complete') flags.push(`<div class="card warn"><b>This run did not complete (${esc(run.status)}).</b> It is not fed into any finding.</div>`);
  if (run.exclusions?.length) flags.push(`<div class="card bad"><b>${run.exclusions.length} exclusion${run.exclusions.length > 1 ? 's' : ''}.</b> ${run.exclusions.slice(0, 8).map(x => `${esc(x.condition)} step ${x.step}: ${esc(x.reason)}`).join('; ')}. Conditions with a failed step are marked incomplete and contribute nothing to the metrics.</div>`);
  box.innerHTML = `${flags.join('')}<div class="card"><h4>Checkpoints</h4><p class="note">Each cell: personality items expressed in the five answers, and self-prediction tests where both fresh answers matched. Checkpoints are assessments on a snapshot of memory, so they did not change the agents.</p>
    <div class="tablewrap"><table><thead><tr><th>Condition</th>${conds[0]?.[1].checkpoints.map(c => `<th>Step ${c.step}</th>`).join('') || ''}<th>Status</th></tr></thead><tbody>${conds.map(([name, c]) => `<tr><td title="${esc(c.description)}"><b>${esc(name)}</b></td>${c.checkpoints.map(cp => `<td>${cp.failed ? `<span class="chip bad">failed: ${esc(cp.failed.kind)}</span>` : `${cp.traits.length} traits, ${cp.selfpredict.yes}/${cp.selfpredict.n}${cp.selfpredict.invalid ? ` <span class="chip">${cp.selfpredict.invalid} invalid</span>` : ''}`}</td>`).join('')}<td>${c.complete === false ? '<span class="chip bad">incomplete</span>' : '<span class="chip ok">complete</span>'}${c.degradedSteps ? ` <span class="chip warn">${c.degradedSteps} degraded</span>` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h4>Run details</h4><dl class="kv"><dt>Protocol</dt><dd>${esc(run.protocol.id)} v${run.protocol.version}, hash ${esc(run.protocol.hash)}, written before the first model call</dd><dt>Model</dt><dd>${esc(run.manifest.model || 'unknown')}</dd><dt>Code revision</dt><dd>${esc(run.manifest.revision?.commit?.slice(0, 10) || 'not recorded')}</dd><dt>Stored memory at checkpoints</dt><dd>${esc(run.params.memory)}</dd><dt>Calls</dt><dd>${run.usage.calls} made, ${run.usage.failed} failed, about ${run.manifest.estimatedCalls} estimated</dd><dt>Tokens</dt><dd>${(run.usage.input_tokens || 0).toLocaleString()} in, ${(run.usage.output_tokens || 0).toLocaleString()} out</dd></dl>
    <p class="note">One run is one pilot observation. Runs feed the findings under Research, which use pilot labels only.</p></div>`;
}
async function runIso(e) {
  e.preventDefault();
  if (E.iso.job) return;
  const body = { conditions: isoConds(), steps: Number($('#iSteps').value), every: Number($('#iEvery').value), memory: $('#iMemory').checked ? 'on' : 'off', budget: Number($('#iBudget').value) || undefined };
  const ac = new AbortController(); E.iso.job = ac; $('#iError').hidden = true; $('#iStop').hidden = false; $('#iRun').disabled = true;
  let steps = 0;
  try {
    await stream('/api/experiment', body, (stage, data) => { if (stage === 'step' || stage === 'checkpoint') { steps++; $('#iProgress').textContent = `${data.condition}: ${stage} ${data.step}${data.failed ? ' failed' : ''}. (${steps} events)`; } if (stage === 'cancelled') $('#iProgress').textContent = 'Stopped. The partial result was saved as cancelled and fed nothing.'; if (stage === 'finished') $('#iProgress').textContent = `Finished run ${data.runId}.`; }, { signal: ac.signal });
  } catch (er) { if (er.name === 'AbortError') $('#iProgress').textContent = 'Stopped. The server cancels the run and records its final state.'; else err($('#iError'), er); }
  finally { E.iso.job = null; $('#iStop').hidden = true; await new Promise(r => setTimeout(r, 400)); await isoRuns(); isoEstimate(); }
}

// ---------- init ----------
// Called by the Lab when one of the test panes is shown.
export function onExperimentPane(id) {
  if (id === 'lesson') { lessonDesign(); lessonEstimate(); lessonRuns(); }
  if (id === 'isolation') { isoEstimate(); isoRuns(); }
  if (id === 'compare') loadCompare(a => api(`/api/talk/${a}`)).catch(e => { $('#cmpGrid').innerHTML = `<p class="err">${esc(e.message)}</p>`; });
}
export function initExperiments(cfg) {
  E.cfg = cfg;
  setCompareApi((path, body) => api(`/api/talk/${path}`, body));
  $('#lessonForm').onsubmit = runLesson;
  for (const id of ['#lMode', '#lTasks']) $(id).onchange = lessonEstimate;
  $('#lSeed').onchange = lessonDesign;
  for (const el of $$('input[name=lc]')) el.onchange = lessonEstimate;
  $('#lStop').onclick = () => E.lesson.job?.abort();
  $('#lRunPick').onchange = e => e.target.value && showLesson(e.target.value);
  $('#isoForm').onsubmit = runIso;
  for (const id of ['#iSteps', '#iEvery']) $(id).oninput = isoEstimate;
  for (const el of $$('input[name=ic]')) el.onchange = isoEstimate;
  $('#iStop').onclick = () => E.iso.job?.abort();
  $('#iRunPick').onchange = async e => { if (!e.target.value) return; try { E.iso.run = await api(`/api/experiment/run?id=${encodeURIComponent(e.target.value)}`); } catch { E.iso.run = null; } renderIso(); };
}
