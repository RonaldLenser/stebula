// Boot and navigation for the three destinations: Agent, History, Lab.
import { $, initTheme, loadConfig, config } from '/core.js';
import { initAgent, agentActivated, render as renderAgent } from '/agent.js';
import { initHistory, historyActivated } from '/history.js';
import { initExperiments } from '/experiments.js';
import { initResearch } from '/research.js';
import { initLab, showLab, labActivated } from '/lab.js';

initTheme();
const VIEWS = { agent: '#agentView', history: '#historyView', lab: '#labView' };
const NAMES = { agent: 'Agent', history: 'History', lab: 'Lab' };
const LEGACY = { observe: 'agent', experiments: 'lab', research: 'lab' };

function go(view, { replace = false, pane = null } = {}) {
  view = LEGACY[view] ?? view;
  if (!VIEWS[view]) view = 'agent';
  for (const [k, sel] of Object.entries(VIEWS)) $(sel).hidden = k !== view;
  for (const k of Object.keys(VIEWS)) $(`#view${k[0].toUpperCase()}${k.slice(1)}`).setAttribute('aria-pressed', String(k === view));
  document.body.dataset.view = view;
  if (view !== 'agent') document.body.classList.remove('inspect-open');
  if (view === 'lab' && pane) showLab(pane);
  const url = `#${view}`;
  if (replace) history.replaceState(null, '', url); else if (location.hash.split('/')[0] !== url) history.pushState(null, '', url);
  document.title = `${NAMES[view]} - Stebula`;
  if (view === 'agent') agentActivated(); else if (view === 'history') historyActivated(); else labActivated();
}
for (const v of Object.keys(VIEWS)) $(`#view${v[0].toUpperCase()}${v.slice(1)}`).onclick = () => { go(v); $('#main').focus?.(); };
addEventListener('popstate', () => go(location.hash.slice(1).split('/')[0] || 'agent', { replace: true }));
addEventListener('stebula:go', e => go(e.detail));
$('#reloadNow')?.addEventListener('click', () => location.reload());

(async () => {
  const cfg = await loadConfig();
  const chip = $('#modelChip');
  chip.className = `chip ${cfg.public ? 'warn' : cfg.live ? (cfg.fake ? 'warn' : 'ok') : ''}`;
  chip.textContent = cfg.public ? 'Public replay: no live model' : cfg.fake ? 'Scripted test model' : cfg.live ? `Live model: ${cfg.model}` : 'No model key: replay and scripted runs only';
  initExperiments(cfg); initResearch(); initLab(); initHistory();
  await initAgent();
  const [view, pane] = location.hash.slice(1).split('/');
  go(view || 'agent', { replace: true, pane });
  renderAgent();
})();
