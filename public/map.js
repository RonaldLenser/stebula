// The process map: what one turn recorded, laid out as inputs, proposals, selection, reply and saved changes.
// Lines between stages are drawn from the same model the inspector reads. Nothing here is decoration:
// a node's colour is its recorded status and a line is a recorded hand-off. Selecting either opens the inspector.
import { $, $$, esc, fmt } from '/core.js';
import { STATUS_TEXT, WHO_TEXT, ROLE_NAME, STEPS } from '/src/talk/process.js';

const ROWS = [
  { cap: 'What it had to work with', ids: ['noticed', 'signals', 'memories', 'priorities'] },
  { cap: 'What it considered', ids: ['proposals'] },
  { cap: 'What was chosen', ids: ['selected'] },
  { cap: 'What it said', ids: ['reply'] },
  { cap: 'What was saved', ids: ['changes'] },
];

function body(n) {
  const s = esc(n.summary);
  if (n.id === 'proposals' && n.candidates.length) {
    return `<ul class="mini">${n.candidates.map(c => `<li><button class="mini-btn ${c.won ? 'won' : 'lost'}" data-proposal="${esc(c.module)}" aria-label="${esc(ROLE_NAME[c.module] || c.module)}: ${c.won ? 'selected' : 'dropped'}, score ${fmt(c.score).replace(/<[^>]+>/g, '')}"><span class="mname">${esc(ROLE_NAME[c.module] || c.module)}</span><span class="mbar"><i style="width:${Math.round(Math.min(1, Math.max(0, c.score)) * 100)}%"></i></span><span class="mtag">${c.won ? 'selected' : 'dropped'}</span></button></li>`).join('')}</ul>`;
  }
  if (n.id === 'selected' && n.winners.length) return `<p class="sum">${s}</p>`;
  if (n.id === 'signals' && n.items.length) return `<p class="sum">${n.items.map(i => `${esc(i.name.toLowerCase())} ${i.value}`).join(', ')}</p>`;
  if (n.id === 'memories' && n.items.length) return `<p class="sum">${n.items.length} supplied</p><ul class="chips">${n.items.slice(0, 4).map(i => `<li><button class="chip-btn" data-memory="${esc(i.id)}">${esc(i.id)}</button></li>`).join('')}</ul>`;
  return `<p class="sum">${s}</p>`;
}

export function mapHtml(model, { selected = null, step = null } = {}) {
  const shown = step == null ? null : new Set(STEPS.slice(0, step + 1).flatMap(x => x.reveals));
  const current = step == null ? null : STEPS[step].id;
  const rel = new Set(), relEdges = new Set();
  if (selected?.kind === 'node') { rel.add(selected.id); for (const e of model.edges) if (e.from === selected.id || e.to === selected.id) { relEdges.add(e.id); rel.add(e.from); rel.add(e.to); } }
  if (selected?.kind === 'edge') { const e = model.edges.find(x => x.id === selected.id); if (e) { relEdges.add(e.id); rel.add(e.from); rel.add(e.to); } }
  if (selected?.kind === 'proposal') { for (const id of ['proposals', 'selected']) rel.add(id); }
  const node = id => {
    const n = model.nodes[id];
    const hidden = shown && !shown.has(id);
    const sel = selected?.kind === 'node' && selected.id === id;
    const dim = selected && !rel.has(id) && !sel;
    return `<section class="node st-${n.status} who-${n.who}${sel ? ' selected' : ''}${dim ? ' dim' : ''}${hidden ? ' later' : ''}${current === id || (current === 'noticed' && ['memories', 'priorities'].includes(id)) ? ' current' : ''}" data-node="${id}">
      <button class="node-main" data-pick-node="${id}" aria-pressed="${sel}" aria-label="${esc(n.title)}: ${esc(n.label)}. ${hidden ? 'Not shown yet in this replay.' : ''}">
        <span class="nhead"><span class="ntitle">${esc(n.title)}</span><span class="chip st-${n.status}">${esc(n.short)}</span></span>
        <span class="nwho">${esc(WHO_TEXT[n.who])}</span>
      </button>${hidden ? '<p class="sum later-note">Not shown yet in this replay.</p>' : body(n)}</section>`;
  };
  const rows = ROWS.map((r, i) => `<div class="mrow r${i}"><h3 class="rowcap">${esc(r.cap)}</h3><div class="mnodes n${r.ids.length}">${r.ids.map(node).join('')}</div></div>`).join('');
  return `<div class="mapwrap"><svg class="mapsvg" aria-hidden="false" role="group" aria-label="Connections between stages"></svg>${rows}</div>
    <div class="legend" aria-label="How to read the lines"><span><i class="ln supply"></i> given as input</span><span><i class="ln direct"></i> given straight to the reply</span><span><i class="ln compute"></i> computed by code</span><span><i class="ln faint"></i> not present this turn</span></div>`;
}

// Draws the connecting lines after layout. Lines run behind the nodes; long ones travel in the side margins.
export function drawEdges(root, model, { selected = null, step = null } = {}) {
  const wrap = $('.mapwrap', root), svg = $('.mapsvg', root);
  if (!wrap || !svg) return;
  const W = wrap.clientWidth, H = wrap.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', W); svg.setAttribute('height', H);
  const box = id => { const el = $(`.node[data-node="${id}"]`, wrap); if (!el) return null; const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect(); return { l: r.left - w.left, r: r.right - w.left, t: r.top - w.top, b: r.bottom - w.top, cx: (r.left + r.right) / 2 - w.left, row: Number(el.closest('.mrow').className.match(/r(\d)/)[1]) }; };
  const shown = step == null ? null : new Set(STEPS.slice(0, step + 1).flatMap(x => x.reveals));
  const into = {}; for (const e of model.edges) (into[e.to] ||= []).push(e);
  let lane = { left: 0, right: 0 }; const out = [];
  for (const e of model.edges) {
    const a = box(e.from), b = box(e.to);
    if (!a || !b) continue;
    if (shown && (!shown.has(e.from) || !shown.has(e.to))) continue;
    const k = into[e.to].indexOf(e), m = into[e.to].length;
    const tx = b.l + (b.r - b.l) * (k + 1) / (m + 1), sx = a.cx, sy = a.b, ty = b.t;
    let d;
    if (b.row - a.row > 1 || (e.kind === 'direct')) {
      const side = a.cx < W / 2 ? 'left' : 'right', x = side === 'left' ? 6 + lane.left++ * 6 : W - 6 - lane.right++ * 6;
      d = `M${sx},${sy} V${sy + 10} H${x} V${ty - 10} H${tx} V${ty}`;
    } else d = `M${sx},${sy} C${sx},${sy + (ty - sy) / 2} ${tx},${ty - (ty - sy) / 2} ${tx},${ty}`;
    const sel = selected?.kind === 'edge' && selected.id === e.id;
    const rel = selected?.kind === 'node' && (selected.id === e.from || selected.id === e.to);
    const quiet = selected && !sel && !rel;
    out.push(`<g class="edge ${e.kind}${e.given ? '' : ' absent'}${sel ? ' selected' : ''}${quiet ? ' quiet' : ''}${rel ? ' related' : ''}" data-edge="${e.id}" tabindex="0" role="button" aria-pressed="${sel}" aria-label="Connection from ${esc(model.nodes[e.from].title)} to ${esc(model.nodes[e.to].title)}: ${esc(e.label)}${e.given ? '' : ', not present this turn'}"><path class="hit" d="${d}"/><path class="line" d="${d}"/>${sel || rel ? `<text x="${tx + 6}" y="${ty - 14}">${esc(e.label)}</text>` : ''}</g>`);
  }
  svg.innerHTML = out.join('');
}

export function redraw(root, model, opts) {
  drawEdges(root, model, opts);
}
export const hookResize = (root, fn) => { if (typeof ResizeObserver === 'undefined') return; const ro = new ResizeObserver(() => fn()); const w = $('.mapwrap', root); if (w) ro.observe(w); return ro; };
