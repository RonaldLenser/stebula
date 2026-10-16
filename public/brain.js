// Live brain view. A map of Stebula's software processes, not a scan of the model.
// Built once, then painted from a state object (see src/talk/brain.js). No glow is invented:
// region brightness is the recorded workspace score, wires exist only to recorded winners.
import { MODULES } from '/src/talk/workspace.js';

const NS = 'http://www.w3.org/2000/svg';
const C = { x: 300, y: 180 };
const OUTLINE = 'M70 215 C40 140 80 60 170 48 C250 30 370 28 440 52 C530 78 565 150 548 215 C538 262 505 280 470 284 C455 330 395 345 360 322 C345 310 330 300 310 304 C290 330 250 345 215 330 C170 318 120 290 95 262 C80 248 74 232 70 215 Z';
// Wedges partition the canvas around the Workspace; the outline clips them to the brain shape.
export const REGIONS = {
  'self-monitor': { name: 'Self-monitor', where: 'front top', poly: '0,0 235,0 300,180 0,170', at: [125, 100] },
  initiative: { name: 'Initiative', where: 'top', poly: '235,0 420,0 300,180', at: [320, 88] },
  perception: { name: 'Perception', where: 'back', poly: '420,0 600,0 600,400 450,400 300,180', at: [490, 175] },
  memory: { name: 'Memory', where: 'bottom', poly: '300,180 450,400 180,400', at: [300, 268] },
  evaluation: { name: 'Evaluation', where: 'front bottom', poly: '300,180 180,400 0,400 0,170', at: [120, 255] },
};
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };

export function initBrain(svg, { onSelect }) {
  svg.setAttribute('viewBox', '20 25 560 335');
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  el('path', { d: OUTLINE }, el('clipPath', { id: 'brainClip' }, defs));
  const parts = {};
  const clip = el('g', { 'clip-path': 'url(#brainClip)' }, svg);
  for (const m of MODULES) {
    const r = REGIONS[m];
    const g = el('g', { class: 'region', tabindex: 0, role: 'button', 'data-module': m }, clip);
    parts[m] = { g, poly: el('polygon', { class: 'rfill', points: r.poly }, g), wire: null };
  }
  el('path', { d: OUTLINE, class: 'outline' }, svg);
  for (const m of MODULES) { // wires from each region to the Workspace, shown only for recorded winners
    const [x, y] = REGIONS[m].at;
    parts[m].wire = el('line', { class: 'wire', x1: x, y1: y, x2: C.x, y2: C.y }, svg);
  }
  for (const m of MODULES) {
    const r = REGIONS[m], [x, y] = r.at, p = parts[m];
    p.label = el('text', { class: 'rlabel', x, y, 'text-anchor': 'middle' }, p.g); p.label.textContent = r.name;
    p.score = el('text', { class: 'rscore', x, y: y + 15, 'text-anchor': 'middle' }, p.g);
    p.boost = el('text', { class: 'rboost', x, y: y + 29, 'text-anchor': 'middle' }, p.g);
    p.g.addEventListener('mouseenter', () => onSelect(m));
    p.g.addEventListener('focus', () => onSelect(m));
    p.g.addEventListener('click', () => onSelect(m));
    p.g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(m); } });
  }
  const ws = el('g', { class: 'workspace' }, svg);
  parts.ws = el('circle', { cx: C.x, cy: C.y, r: 34, class: 'wsfill' }, ws);
  const wt = el('text', { x: C.x, y: C.y - 2, 'text-anchor': 'middle', class: 'wslabel' }, ws); wt.textContent = 'Workspace';
  parts.wsCount = el('text', { x: C.x, y: C.y + 13, 'text-anchor': 'middle', class: 'rscore' }, ws);
  const v = el('g', { class: 'voice' }, svg);   // sits at the front of the head, where speech comes out
  parts.voice = v;
  el('circle', { cx: 52, cy: 235, r: 12, class: 'voicering' }, v);
  el('circle', { cx: 52, cy: 235, r: 5, class: 'voicedot' }, v);
  const vt = el('text', { x: 52, y: 262, 'text-anchor': 'middle', class: 'rboost' }, v); vt.textContent = 'Voice';
  svg.__parts = parts;
  return parts;
}

// state: brain state. extra: { listening, speaking, boosts }
export function paintBrain(svg, state, extra = {}) {
  const parts = svg.__parts;
  const byMod = Object.fromEntries((state?.candidates || []).map(c => [c.module, c]));
  const winners = new Set(state?.winners || []);
  const decided = (state?.winners || []).length > 0;
  const boostBy = Object.fromEntries((extra.boosts || []).map(b => [b.region, b]));
  for (const m of MODULES) {
    const p = parts[m], c = byMod[m];
    const cls = ['region'];
    if (c) cls.push(decided ? (winners.has(m) ? 'win' : 'lose') : 'scored');
    if (m === 'perception' && (extra.listening || ['heard', 'affect'].includes(state?.phase)) && extra.live) cls.push('pulse');
    p.g.setAttribute('class', cls.join(' '));
    p.g.setAttribute('aria-label', `${REGIONS[m].name}, ${REGIONS[m].where}${c ? `, score ${c.score.toFixed(2)}, ${winners.has(m) ? 'in workspace' : 'dropped'}` : ', no recorded thought'}`);
    p.poly.style.setProperty('--glow', c ? Math.min(1, Math.max(0.08, c.score)).toFixed(2) : '0');
    p.score.textContent = c ? c.score.toFixed(2) : '';
    const b = boostBy[m];
    p.boost.textContent = b && b.boost > 0 ? `+${b.boost.toFixed(2)} from ${b.signal}` : '';
    p.wire.setAttribute('class', `wire${winners.has(m) ? ' on' : ''}`);
  }
  parts.wsCount.textContent = decided ? `${winners.size} in` : '';
  parts.ws.setAttribute('class', `wsfill${decided ? ' lit' : ''}`);
  parts.voice.setAttribute('class', `voice${extra.speaking ? ' on' : ''}`);
}
