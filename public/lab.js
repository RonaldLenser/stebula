// Lab: tasks, experiments, comparisons, findings and the technical evaluation tools, explained in ordinary language.
// One tab list covers "run something" and "read the results". Each test says what happens, which agent answers,
// who evaluates, what changes and what the result tells us.
import { $, $$, esc, fmt, when, api, config, tabKeys } from '/core.js';
import { onExperimentPane } from '/experiments.js';
import { onResearchPane } from '/research.js';
import { howHtml } from '/lab-text.js';
import { agentName } from '/store.js';

const PANES = ['lesson', 'isolation', 'compare', 'rules', 'checks', 'findings', 'methods', 'limits', 'score'];
const RESEARCH = new Set(['findings', 'methods', 'limits', 'score']);
let current = 'lesson';

const C = { agent: 'A', mem: null, busy: '', msg: '' };
async function loadChecks() { try { C.mem = (await api(`/api/talk/state?agent=${C.agent}`)).mem; C.msg = ''; } catch (e) { C.msg = e.message; C.mem = null; } renderChecks(); }
function renderChecks() {
  const m = C.mem, live = !!config.value?.live && !config.value?.public;
  const t = m?.selfTests || [], valid = t.filter(x => x.match !== 'invalid'), inv = t.length - valid.length, n = k => valid.filter(x => x.match === k).length;
  const audits = [...(m?.audits || [])].reverse().slice(0, 3).map(x => `<div class="block"><h4>Audit at turn ${x.turn}</h4><p>${esc(x.summary)}</p>${x.findings.map(f => `<div class="flag ${f.severity === 'warn' ? 'warn' : ''}"><b>${esc(f.type)}</b>: "${esc(f.quote)}" <span class="note">${esc(f.explanation)}</span></div>`).join('') || '<p class="nodata">No findings.</p>'}</div>`).join('');
  $('#cStatus').textContent = C.busy || C.msg || '';
  $('#cRun').disabled = !live || !!C.busy || !m; $('#cAudit').disabled = !live || !!C.busy || !m;
  $('#cResults').innerHTML = !m ? '<p class="empty">Loading.</p>' : `${t.length ? `<p><span class="stat"><b>${valid.length ? `${n('yes')} of ${valid.length}` : 'No data'}</b>predicted both answers</span><span class="stat"><b>${n('partial')}</b>one of two</span><span class="stat"><b>${n('no')}</b>neither</span><span class="stat"><b>${inv}</b>invalid, not counted</span></p>` : '<p class="empty">No self-prediction tests yet.</p>'}
    ${[...t].reverse().map(x => `<div class="test ${x.match}"><b>"${esc(x.statement)}"</b><br>${x.match === 'invalid' ? `<span class="chip">Invalid: not counted</span> ${esc(x.invalidReason || 'unreadable output')}` : `Predicted ${esc(x.prediction.predicted)} (confidence ${fmt(x.prediction.confidence)}). Fresh answers: ${x.answers.map(a => esc(a.stance || '?')).join(' and ')}. ${{ yes: 'It knew itself.', partial: 'Half right.', no: 'Wrong about itself.' }[x.match] || ''}`}${x.assessment ? ' <span class="chip">assessment on a snapshot</span>' : ''}</div>`).join('')}
    <h3>Audits</h3><p class="note">A separate model call reviews recent turns. It is fallible.</p>${audits || '<p class="nodata">None yet.</p>'}`;
}
async function runCheck(text, path, body) {
  if (C.busy) return;
  C.busy = text; C.msg = ''; renderChecks();
  try { C.mem = (await api(path, { agent: C.agent, ...body })).mem; } catch (e) { C.msg = e.message; }
  C.busy = ''; renderChecks();
}

export function showLab(id, { focus = false } = {}) {
  if (!PANES.includes(id)) id = 'lesson';
  current = id;
  for (const p of $$('#labView .subpane')) p.hidden = p.id !== `pane-${id}`;
  for (const b of $$('#labView [role=tab]')) b.setAttribute('aria-selected', String(b.dataset.lab === id));
  if (RESEARCH.has(id)) onResearchPane(id); else if (id === 'checks') loadChecks(); else onExperimentPane(id);
  if (focus) $(`#labView [data-lab="${id}"]`)?.focus();
}

export function initLab() {
  for (const id of ['lesson', 'isolation', 'compare', 'rules', 'checks']) { const el = $(`#how-${id}`); if (el) el.innerHTML = howHtml(id, esc); }
  for (const list of $$('#labView .tablist')) { tabKeys(list); for (const b of $$('[role=tab]', list)) b.onclick = () => showLab(b.dataset.lab); }
  $('#cAgent').onchange = e => { C.agent = e.target.value; C.mem = null; loadChecks(); };
  $('#cRun').onclick = () => runCheck(`${agentName(C.agent)} is predicting its own answer, then two fresh copies answer.`, '/api/talk/selftest', { statement: $('#cStmt').value, memory: 'on' });
  $('#cAudit').onclick = () => runCheck('A second model call is reviewing recent turns.', '/api/talk/audit', {});
}
export const labActivated = () => showLab(current);
