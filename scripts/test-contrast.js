// Checks that the text and background colour pairs the interface actually uses meet WCAG AA (4.5:1) in both themes.
// Colours are read from the tokens in public/styles.css, so a token change that breaks contrast fails here.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const block = sel => { const m = css.match(new RegExp(`${sel.replace(/[[\]".]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m?.[1] || ''; };
const tokens = body => Object.fromEntries([...body.matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
const light = tokens(block(':root')), dark = { ...light, ...tokens(block(':root[data-theme="dark"]')) };
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [text token, background token, where it is used]
const PAIRS = [
  ['ink', 'bg', 'body text'], ['ink', 'surface', 'text on panels'], ['ink', 'sunken', 'text in message bubbles'],
  ['muted', 'bg', 'secondary text on the page'], ['muted', 'surface', 'secondary text on panels'], ['muted', 'sunken', 'secondary text in bubbles and chips'],
  ['accent', 'surface', 'links and active tabs'], ['accent', 'bg', 'links on the page'], ['on-accent', 'accent', 'primary button label'],
  ['accent', 'accent-soft', 'accent chips'], ['ink', 'accent-soft', 'selected message text'],
  ['ok', 'ok-soft', 'ok chips'], ['warn', 'warn-soft', 'warning chips'], ['bad', 'bad-soft', 'error chips'],
  ['ink', 'ok-soft', 'selected proposal rows'], ['ink', 'warn-soft', 'banners'], ['ink', 'bad-soft', 'error boxes'],
  ['ok', 'surface', 'ok text'], ['warn', 'surface', 'warning text'], ['bad', 'surface', 'error text'],
];
const low = [];
for (const [name, t] of [['light', light], ['dark', dark]]) for (const [fg, bg, use] of PAIRS) {
  assert(t[fg] && t[bg], `token missing: ${fg} or ${bg} in ${name}`);
  const r = ratio(t[fg], t[bg]);
  if (r < 4.5) low.push(`${name}: ${fg} on ${bg} (${use}) = ${r.toFixed(2)}`);
}
assert.deepEqual(low, [], `contrast below 4.5:1:\n${low.join('\n')}`);
console.log(`contrast ok: ${PAIRS.length} pairs in 2 themes meet 4.5:1`);
