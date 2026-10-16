// Boot and navigation for the three primary views: Observe, Experiments, Research.
import { $, esc, initTheme, loadConfig, config } from '/core.js';
import { initObserve, observeActivated, render as renderObserve } from '/observe.js';
import { initExperiments, experimentsActivated } from '/experiments.js';
import { initResearch, researchActivated } from '/research.js';

initTheme();
const VIEWS = { observe: '#observeView', experiments: '#experimentsView', research: '#researchView' };
const showers = {};
let current = null;

function go(view, { replace = false } = {}) {
  if (!VIEWS[view]) view = 'observe';
  for (const [k, sel] of Object.entries(VIEWS)) $(sel).hidden = k !== view;
  for (const k of Object.keys(VIEWS)) $(`#view${k[0].toUpperCase()}${k.slice(1)}`).setAttribute('aria-pressed', String(k === view));
  document.body.dataset.view = view;
  if (view !== 'observe') document.body.classList.remove('inspect-open');
  const url = `#${view}`;
  if (replace) history.replaceState(null, '', url); else if (location.hash !== url) history.pushState(null, '', url);
  document.title = `${{ observe: 'Observe', experiments: 'Experiments', research: 'Research' }[view]} - Stebula`;
  if (view === 'observe') observeActivated(); else if (view === 'experiments') experimentsActivated(showers.exp); else researchActivated(showers.res);
  current = view;
}
for (const v of Object.keys(VIEWS)) $(`#view${v[0].toUpperCase()}${v.slice(1)}`).onclick = () => { go(v); $('#main').focus?.(); };
addEventListener('popstate', () => go(location.hash.slice(1) || 'observe', { replace: true }));
$('#reloadNow')?.addEventListener('click', () => location.reload());

(async () => {
  const cfg = await loadConfig();
  const chip = $('#modelChip');
  chip.className = `chip ${cfg.public ? 'warn' : cfg.live ? (cfg.fake ? 'warn' : 'ok') : ''}`;
  chip.textContent = cfg.public ? 'Public replay: no live model' : cfg.fake ? 'Scripted test model' : cfg.live ? `Live model: ${cfg.model}` : 'No model key: replay and scripted runs only';
  showers.exp = await initExperiments(cfg);
  showers.res = initResearch();
  await initObserve();
  go((location.hash.slice(1) || 'observe').split('/')[0], { replace: true });
  renderObserve();
})();
