// Growth and Compare views. Every node and number is derived from the memory file's personality log;
// strengths are recomputed by code (src/talk/personality.js), never read from anything the model said.
import { buildItems, saidVsShown } from '/src/talk/personality.js';
import { compareModels } from '/src/talk/personality.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NS = 'http://www.w3.org/2000/svg';
const G = { sel: null, k: null, seen: new Set(), mem: null };
const KIND_COLOR = { trait: 'var(--a)', motive: 'var(--exp)', belief: 'var(--b)' };
const nodeEl = (tag, attrs, parent, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; parent?.appendChild(e); return e; };

export function renderGrowth(mem) {
  G.mem = mem;
  const p = mem.personality, total = p.log.length;
  const slider = $('#growthSlider');
  const follow = G.k == null || Number(slider.value) >= Number(slider.max);   // stay at the newest step while new evidence arrives
  slider.max = String(total); slider.disabled = total < 2;
  if (follow) G.k = total;
  slider.value = String(G.k);
  const k = G.k;
  $('#growthStep').textContent = total ? `Showing the first ${k} of ${total} evidence steps.` : 'No evidence yet. Read something to Stebula, or talk with it.';
  const items = buildItems(p, k);
  if (G.sel && !items.some(i => i.id === G.sel)) G.sel = null;

  // graph: sources (left), events (middle), items (right). Events and sources appear only once they hold evidence.
  const entries = p.log.slice(0, k), evIds = [...new Set(entries.map(e => e.eventId))];
  const events = evIds.map(id => p.events.find(e => e.id === id)).filter(Boolean);
  const sources = [...new Set(events.map(e => e.source))];
  const ROW = 15, W = 860, H = Math.max(260, events.length * ROW + 40, items.length * 56 + 40);
  const svg = $('#growthSvg'); svg.innerHTML = ''; svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const srcPos = {}, evPos = {}, itemPos = {};
  sources.forEach((s, i) => { srcPos[s] = { x: 110, y: 30 + i * Math.max(46, (H - 60) / Math.max(1, sources.length)) }; });
  events.forEach((e, i) => { evPos[e.id] = { x: 400, y: 24 + i * ROW }; });
  items.forEach((it, i) => { itemPos[it.id] = { x: 700, y: 36 + i * Math.min(56, (H - 60) / Math.max(1, items.length)) }; });
  const edges = nodeEl('g', {}, svg), nodes = nodeEl('g', {}, svg);
  for (const e of events) nodeEl('line', { x1: srcPos[e.source].x + 10, y1: srcPos[e.source].y, x2: evPos[e.id].x, y2: evPos[e.id].y, class: 'gedge src' }, edges);
  for (const e of entries) { const a = evPos[e.eventId], b = itemPos[e.id]; if (a && b) nodeEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `gedge ${e.direction === 'supports' ? 'sup' : 'con'}${G.sel === e.id ? ' hot' : ''}` }, edges); }
  const fresh = id => (G.seen.size && !G.seen.has(id) ? ' new' : '');
  for (const s of sources) {
    const g = nodeEl('g', { class: `gsrc${fresh('s:' + s)}` }, nodes), pos = srcPos[s];
    nodeEl('rect', { x: pos.x - 100, y: pos.y - 11, width: 108, height: 22, rx: 3 }, g);
    nodeEl('text', { x: pos.x - 94, y: pos.y + 4 }, g, s.length > 17 ? `${s.slice(0, 16)}...` : s);
    nodeEl('title', {}, g, s);
  }
  for (const e of events) { const g = nodeEl('g', { class: `gev${fresh(e.id)}` }, nodes); nodeEl('circle', { cx: evPos[e.id].x, cy: evPos[e.id].y, r: 4.5 }, g); nodeEl('title', {}, g, `${e.id}: ${e.excerpt}`); }
  for (const it of items) {
    const pos = itemPos[it.id], r = 8 + 20 * it.strength;
    const g = nodeEl('g', { class: `gitem ${it.status}${G.sel === it.id ? ' sel' : ''}${fresh(it.id)}`, tabindex: 0, role: 'button', 'aria-label': `${it.kind} ${it.name}, strength ${it.strength.toFixed(2)}, ${it.status}` }, nodes);
    nodeEl('circle', { cx: pos.x, cy: pos.y, r, style: `fill:${KIND_COLOR[it.kind]}` }, g);
    nodeEl('text', { x: pos.x + r + 8, y: pos.y - 2, class: 'gname' }, g, it.name);
    nodeEl('text', { x: pos.x + r + 8, y: pos.y + 12, class: 'gsub' }, g, `${it.kind}, ${it.strength.toFixed(2)}, ${it.status}`);
    const pick = () => { G.sel = it.id; renderGrowth(G.mem); };
    g.addEventListener('click', pick); g.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
  }
  G.seen = new Set([...sources.map(s => `s:${s}`), ...events.map(e => e.id), ...items.map(i => i.id)]);

  // list with said vs shown
  $('#traitList').innerHTML = items.length ? [...items].sort((a, b) => b.strength - a.strength).map(it => {
    const sv = it.kind === 'trait' ? saidVsShown(it, mem.archive) : { proxy: null, note: 'Only traits have a behavior proxy.' };
    const shown = sv.proxy ? `Stated ${it.strength.toFixed(2)}. Shown: ${esc(sv.label)} ${sv.shown == null ? 'n/a' : sv.shown.toFixed(2)} over ${sv.n} replies.${sv.flagged ? ' <b class="flag-inline">Behavior does not back this trait.</b>' : sv.n < 3 ? ' Too few replies to judge.' : ''}` : esc(sv.note);
    return `<button class="trait ${it.status}${G.sel === it.id ? ' sel' : ''}" data-id="${esc(it.id)}"><span class="tname">${esc(it.name)}</span> <span class="chip ${it.kind === 'trait' ? 'behavioral' : it.kind === 'motive' ? 'hypothesis' : 'metaphor'}">${it.kind}</span> <span class="status ${it.status === 'established' ? 'implemented' : it.status === 'forming' ? 'partial' : 'unknown'}">${it.status}</span>
      <span class="bar"><i style="width:${Math.round(it.strength * 100)}%"></i></span><span class="note">${shown}</span></button>`;
  }).join('') : '<p class="empty">Nothing has formed yet.</p>';
  for (const b of document.querySelectorAll('#traitList .trait')) b.onclick = () => { G.sel = b.dataset.id; renderGrowth(G.mem); };

  provenance(mem, items);
}

function provenance(mem, items) {
  const it = items.find(i => i.id === G.sel), box = $('#provenance');
  if (!it) { box.innerHTML = '<p class="empty">Tap a trait, motive or belief to see every quote and turn that built or weakened it.</p>'; return; }
  const p = mem.personality;
  const where = ev => { const e = p.events.find(x => x.id === ev.eventId); if (!e) return ev.eventId; const ep = e.sourceType === 'digest' ? mem.episodes.find(x => x.id === e.ref || (x.covers || []).includes(e.ref)) : null;
    return `${esc(e.id)}, ${esc(e.source)}${e.sourceType === 'digest' ? `, passage ${ep ? ep.passage : '?'} (memory ${esc(e.ref)})` : e.sourceType === 'talk' ? `, turn ${e.ref?.turn ?? '?'}` : ''}`; };
  const all = [...it.evidence.map(x => ({ ...x, dir: 'supports' })), ...it.counter.map(x => ({ ...x, dir: 'contradicts' }))].sort((a, b) => a.n - b.n);
  box.innerHTML = `<h3>${esc(it.name)} <span class="note">(${it.kind}, origin event ${esc(it.originEvent)})</span></h3>
    <p class="stat">Strength history: ${it.history.map(h => h.strength.toFixed(2)).join(' then ')}</p>
    <ol class="prov">${all.map(x => `<li class="${x.dir === 'supports' ? 'sup' : 'con'}"><b>${x.dir === 'supports' ? '+0.15' : '-0.20'}</b> step ${x.n}: "${esc(x.quote)}"<br><span class="note">${where(x)}</span></li>`).join('')}</ol>
    <p class="note">Traits are evidence-scored patterns, not proof of a personality. The model proposed each quote; code checked it against the source text and set the strength.</p>`;
}

export function initGrowth() {
  $('#growthSlider').oninput = e => { G.k = Number(e.target.value); renderGrowth(G.mem); };
}

// ---------- Compare ----------
const cmpState = { baselineOf: 'A' };
export async function loadCompare(api) {
  const [a, b] = await Promise.all([api('state?agent=A'), api('state?agent=B')]);
  renderCompare(a.mem, b.mem, a.live);
}
function col(title, items, archiveNote, cls) {
  return `<div class="cmpcol ${cls || ''}"><h3>${esc(title)}</h3><p class="note">${archiveNote}</p>${items.length ? items.map(it => `<div class="citem ${it.inBaseline ? 'base' : ''} ${it.inOther === false ? 'diff' : ''}"><b>${esc(it.name)}</b> <span class="note">${it.kind}, ${it.strength.toFixed(2)}, ${it.status}</span>
    <span class="bar"><i style="width:${Math.round(it.strength * 100)}%"></i></span>${it.inBaseline ? '<span class="tag base">also in empty baseline: likely from the base model</span>' : ''}${it.inOther === false && !it.inBaseline ? '<span class="tag exp">not in the other agent: differs by experience</span>' : ''}${it.inOther === false && it.inBaseline ? '<span class="tag exp">not in the other agent</span>' : ''}</div>`).join('') : '<p class="empty">Nothing formed yet.</p>'}</div>`;
}
export function renderCompare(memA, memB, live) {
  const baseMem = cmpState.baselineOf === 'A' ? memA : memB;
  const base = baseMem.baseline ? buildItems(baseMem.baseline.personality) : [];
  const A = buildItems(memA.personality), B = buildItems(memB.personality);
  const c = compareModels(A, B, base);
  $('#cmpControls').innerHTML = `<label>Baseline copy of <select id="cmpBase"><option value="A"${cmpState.baselineOf === 'A' ? ' selected' : ''}>Agent A</option><option value="B"${cmpState.baselineOf === 'B' ? ' selected' : ''}>Agent B</option></select></label>
    <button id="runBase" ${live ? '' : 'disabled'}>${baseMem.baseline ? 'Re-run baseline' : 'Run baseline'}</button>
    <span class="note">${baseMem.baseline ? `Last run ${esc(baseMem.baseline.at.slice(0, 16).replace('T', ' '))}${baseMem.baseline.parseError ? '. The answer was not readable JSON.' : ''}` : 'Not run yet.'}</span>`;
  const note = m => `${m.episodes.length} memories read, ${m.personality.log.length} evidence steps, ${m.turns} turns`;
  $('#cmpGrid').innerHTML = col('Agent A (empiricist)', c.a, note(memA)) + col('Agent B (analogist)', c.b, note(memB)) +
    col(`Fresh baseline (${cmpState.baselineOf}, empty memory)`, base.map(x => ({ ...x, inBaseline: false, inOther: true })), baseMem.baseline ? 'Same five questions, no memory, no reading.' : 'Run the baseline to fill this column.', 'basecol');
  $('#cmpAnswers').innerHTML = baseMem.baseline ? `<details><summary>The five questions and the baseline's answers</summary>${baseMem.baseline.answers.map(x => `<p><b>${esc(x.q)}</b><br>${esc(x.a || '(no answer)')}</p>`).join('')}</details>` : '';
  $('#cmpBase').onchange = e => { cmpState.baselineOf = e.target.value; renderCompare(memA, memB, live); };
  $('#runBase').onclick = async ev => { ev.target.disabled = true; ev.target.textContent = 'Running...'; try { await cmpState.api(`baseline`, { agent: cmpState.baselineOf }); } catch (e) { $('#cmpAnswers').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; } loadCompare(cmpState.api); };
}
export const setCompareApi = fn => { cmpState.api = fn; };
