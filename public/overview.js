// Draws the compact overview from src/talk/overview.js: one notice, then three questions.
import { esc } from '/core.js';

const open = o => (o ? ` data-open='${esc(JSON.stringify(o))}'` : '');
const row = r => `<li class="orow st-${r.state || 'ok'}"><button class="rowbtn"${open(r.open)}><span class="rl">${esc(r.label)}</span><span class="rv">${esc(r.value)}</span><span class="rt">given to: ${esc(r.to)}</span></button>${r.id === 'memories' && r.items?.length ? `<details class="more"><summary>Show the readings supplied</summary><ul class="chips">${r.items.map(i => `<li><button class="chip-btn" data-memory="${esc(i.id)}">${esc(i.id)}</button> <span class="note">${esc(i.source)}${i.passage ? `, passage ${i.passage}` : ''}</span></li>`).join('')}</ul></details>` : ''}</li>`;

export function noticeHtml(n, { retry = false } = {}) {
  if (!n) return '';
  return `<div class="notice ${n.level}" role="status"><p>${esc(n.text)}</p><div class="nactions">${n.open ? `<button class="btn small" data-open='${esc(JSON.stringify(n.open))}'>View details</button>` : ''}${retry ? '<button class="btn small" data-act="retry">Retry the same message</button>' : ''}</div></div>`;
}

export function overviewHtml(ov, { memoryItems = [], retry = false } = {}) {
  if (ov.empty) return '<p class="lead">Nothing selected yet.</p><p class="note">Send a message, or choose an answer in the conversation. Three questions about it are answered here from what was recorded.</p>';
  const inputs = ov.inputs.map(r => ({ ...r, items: r.id === 'memories' ? memoryItems : null }));
  const c = ov.considered, ch = ov.changed;
  const considered = c.state === 'recorded'
    ? `<ul class="props">${c.selected.map(s => `<li><button class="rowbtn" data-open='${esc(JSON.stringify({ kind: 'proposal', id: s.module }))}'><b>${esc(s.role)}</b> <span class="tick">selected</span><span class="rv">${esc(s.text)}</span></button></li>`).join('')}</ul>
       <p class="note">${c.dropped} other proposal${c.dropped === 1 ? ' was' : 's were'} considered and dropped.</p>
       <button class="linkish" data-open='${esc(JSON.stringify({ kind: 'node', id: 'selected' }))}'>Show every proposal, its score and the selection rule</button>`
    : `<p class="${c.state === 'none' ? 'nodata-strong' : 'pending'}">${esc(c.text)}</p>`;
  const diffs = ch.diffs?.length ? ch.diffs.map(d => `<div class="diffrow"><b>${esc(d.label)}</b><ul>${d.added.map(x => `<li class="add">added: ${esc(x)}</li>`).join('')}${d.removed.map(x => `<li class="rem">removed: ${esc(x)}</li>`).join('')}</ul></div>`).join('') : '';
  const changed = `<p class="${ch.state === 'failed' ? 'nodata-strong' : ''}">${esc(ch.headline)}</p>${diffs}${ch.evidence?.length ? `<p class="note">Evidence recorded: ${ch.evidence.map(esc).join('; ')}.</p>` : ''}${ch.note ? `<p class="note">${esc(ch.note)}</p>` : ''}${ch.state === 'saved' || ch.state === 'unchanged' ? `<button class="linkish" data-open='${esc(JSON.stringify({ kind: 'node', id: 'changes' }))}'>Show the saved records</button>` : ''}`;
  return `${noticeHtml(ov.notice, { retry })}
    <section class="osec"><h3>What went into this response?</h3><ul class="orows">${inputs.map(row).join('')}</ul></section>
    <section class="osec"><h3>What did it consider?</h3>${considered}</section>
    <section class="osec"><h3>What changed afterward?</h3>${changed}</section>
    <p class="note onote">These are the application's records around the model. They are not a view inside it.</p>`;
}
