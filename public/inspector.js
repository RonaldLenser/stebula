// The one contextual inspector. It describes whatever is selected: a stage, a connection, a proposal, a memory.
// Each view starts with a plain sentence, then what was recorded, where it came from, what it was supplied to,
// whether it was selected or saved, and finally the raw technical record.
import { esc, fmt, sign, isNum, when } from '/core.js';
import { STATUS_TEXT, WHO_TEXT, ROLE_NAME, STEPS, agentMsg, foldedInto } from '/src/talk/process.js';

const time = at => (at ? new Date(at).toLocaleTimeString([], { hour12: false }) : '');
export const statusChip = s => `<span class="chip st-${s}">${esc(STATUS_TEXT[s] || s)}</span>`;
const nodeChip = n => `<span class="chip st-${n.status}">${esc(n.label || STATUS_TEXT[n.status])}</span>`;
const prov = who => `<span class="prov ${who}">${esc(WHO_TEXT[who] || who)}</span>`;
const section = (title, body) => (body ? `<h4>${esc(title)}</h4>${body}` : '');
const tech = (obj, label = 'Technical record') => `<details class="tech"><summary>${esc(label)}</summary><pre>${esc(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 1))}</pre></details>`;
const ul = xs => `<ul class="list">${xs.map(x => `<li>${x}</li>`).join('')}</ul>`;

const EVENT_FOR = { noticed: ['heard'], signals: ['affect'], proposals: ['thoughts'], selected: ['workspace'], reply: ['speaking'], changes: ['selfmodel', 'personality'] };
function events(model, id) {
  if (model.live) return '';
  if (!model.events) return '<p class="nodata">Stage timestamps were not recorded for this turn. It was saved before event logging was added.</p>';
  const mine = model.events.filter(e => (EVENT_FOR[id] || []).includes(e.stage));
  const all = model.events.map(e => `<li${mine.includes(e) ? ' class="here"' : ''}>${esc(e.stage)} <span class="note">${esc(time(e.at))}</span></li>`).join('');
  return `<p class="note">Reported by the application as each stage finished.</p><ol class="events">${all}</ol>`;
}
const attempts = (mem, model, stage) => {
  const st = agentMsg(mem, model.turn)?.monologue?.stages?.find(s => s.stage === stage);
  if (!st) return '';
  const a = st.attempts || [];
  return `<p class="note">${esc(stage)} step: ${esc(st.status)}${st.failure ? `, ${esc(st.failure.kind)}` : ''}, ${a.length} attempt${a.length === 1 ? '' : 's'}, ${a.reduce((n, x) => n + (x.latency_ms || 0), 0)} ms, stop reason ${esc(a.map(x => x.stop_reason ?? '?').join(', '))}.</p>`;
};
const bars = items => `<div class="bars">${items.map(i => `<span>${esc(i.name)}</span><div class="bar"><i style="width:${Math.round((i.value ?? 0) * 100)}%"></i></div><span>${fmt(i.value)}${isNum(i.before) ? ` <span class="note">was ${fmt(i.before)}</span>` : ''}</span>`).join('')}</div>`;

// Default view: the turn told in order. Every line opens its stage.
export function overviewHtml(model, ctx) {
  const n = model.nodes;
  if (!model.live && model.overall.state === 'unrecorded' && n.noticed.status !== 'done') {
    return `<p class="lead">Select a message, a stage in the map, or a line between stages to see what was recorded.</p><p class="note">This shows the software around the model: what it was given, what it proposed, what code selected, and what was saved. It does not show what happens inside the model.</p>`;
  }
  const order = ['noticed', 'memories', 'priorities', 'signals', 'proposals', 'selected', 'reply', 'changes'];
  const line = id => `<li><button class="linkish" data-pick-node="${id}"><b>${esc(n[id].title)}</b> ${nodeChip(n[id])}</button><div class="note">${esc(n[id].summary)}</div></li>`;
  return `<p class="lead">${esc(model.overall.text)}</p>
    <h4>This turn, in order</h4><ol class="story">${order.map(line).join('')}</ol>
    <p class="note">Select any line, or a stage in the map, for the recorded detail. Words like "supplied" mean the model's request contained it. They never mean it caused the reply.</p>
    ${ctx.example ? '<p class="note">This is a scripted example, not a model.</p>' : ''}`;
}

const NODE = {
  noticed: (m, model) => `<p class="lead">This is the message the agent received for this turn.</p>
    ${section('What was recorded', `<blockquote class="quote">${esc(m.detail)}</blockquote>`)}
    ${section('Where it came from', `<p>${prov('observed')} Typed or spoken by you. Nothing is added or rewritten.</p>`)}
    ${section('Supplied to later stages', ul(['Conversation signals: code measures it against your earlier messages.', 'Thinking step: it is the latest message in the conversation the model receives.', 'Reply step: it goes straight there as well.']))}`,

  signals: (m, model) => `<p class="lead">Three numbers that a fixed rule computes from the conversation. They describe the conversation. They are not feelings the agent has.</p>
    ${m.items.length ? section('What was recorded', `${bars(m.items)}`) : '<p class="nodata">No signal values were recorded for this turn.</p>'}
    ${m.causes.length ? section('What moved them this turn', ul(m.causes.map(esc))) : ''}
    ${section('How they are calculated', `<p>${prov('code')} Each new value is 0.6 x the previous value plus 0.4 x this turn's evidence. Surprise rises when you point to a contradiction or its last self-prediction failed. Conflict rises when you challenge it. Curiosity rises with how new your message is.</p>`)}
    ${m.boosts.length ? section('Where they were used', `${ul(m.boosts.map(b => `${esc(b.signal)} added <b>${esc(sign(b.boost) || '0')}</b> to the score of "${esc(ROLE_NAME[b.region] || b.region)}"`))}<p class="note">They are also written into the thinking prompt as text. The reply step does not receive them.</p>`) : ''}
    ${tech({ affect: m.items.map(i => [i.key, i.value, i.before]), causes: m.causes })}`,

  memories: (m, model, ctx) => {
    const lead = { done: 'These stored readings were given to the model for this turn.', none: m.summary, missing: m.summary, waiting: 'Which memories were supplied is recorded when the turn is saved.' }[m.status];
    const list = m.items.map(i => `<li><button class="linkish" data-pick-memory="${esc(i.id)}"><b>${esc(i.id)}</b> from ${esc(i.source)}${i.passage ? `, passage ${i.passage}` : ''}</button> <span class="note">to ${esc(i.to.join(' and '))}${isNum(i.score) ? `, word match ${fmt(i.score)}` : ''}</span></li>`);
    const c = m.ctx.speak || m.ctx.think;
    return `<p class="lead">${esc(lead)}</p>
      ${list.length ? section('What was supplied', `<ul class="list">${list.join('')}</ul>`) : ''}
      ${m.always.length ? section('Always supplied while memory is on', `${ul(m.always.map(esc))}<p class="note">Written by the agent over earlier turns and stored in its memory file.</p>`) : ''}
      ${c ? section('How readings were chosen', `<p>${prov('code')} Code ranks stored readings by how many distinctive words they share with your message, then supplies at most four, within a size limit. ${c.available} readings were stored, ${(m.items || []).length} supplied, ${c.omitted} left out.</p>`) : ''}
      <p class="note">${esc(m.window)} ${esc(m.note)}</p>
      ${tech(m.ctx)}`;
  },

  priorities: (m, model) => {
    const [stance, open, carried] = m.items;
    return `<p class="lead">${esc(m.summary)}</p>
      ${section('Its configured stance', `<p>${prov('config')} ${esc(stance.text)}</p><p class="note">${esc(stance.source)}. Given to: ${esc(stance.to)}.</p>`)}
      ${section('Its own open questions', open.recorded ? (open.list.length ? `${ul(open.list.map(esc))}<p class="note">${esc(open.source)}. Given to: ${esc(open.to)}.</p>` : '<p class="nodata">None had been written yet when this turn began.</p>') : '<p class="nodata">Not recorded.</p>')}
      ${section('Carried over from last turn', carried.recorded ? (carried.list.length ? `${ul(carried.list.map(esc))}<p class="note">${esc(carried.source)}. Given to: ${esc(carried.to)}.</p>` : '<p class="nodata">Nothing was selected last turn.</p>') : '<p class="nodata">There is no earlier recorded turn.</p>')}
      <p class="note">${esc(m.note)}</p>${tech(m.items)}`;
  },

  proposals: (m, model, ctx) => {
    if (m.status === 'failed') {
      const f = m.failure || {};
      return `<p class="lead">The proposal step failed, so no proposals exist for this turn.</p>
        ${section('What was recorded', `<p>${statusChip('failed')} Kind: <b>${esc(f.kind || 'unknown')}</b>${m.attempts ? `, after ${m.attempts} attempt${m.attempts === 1 ? '' : 's'}` : ''}. ${esc(f.detail || '')}</p>`)}
        ${section('What happened next', '<p>Nothing was selected. The reply step ran without selected proposals. The turn is marked degraded and is left out of analysis. It did not change memory.</p>')}
        ${tech(agentMsg(ctx.mem, model.turn)?.monologue?.thinkRaw || '(no raw output)', 'Raw model output')}`;
    }
    if (!m.candidates.length) return `<p class="lead">${esc(m.summary)}</p><p class="note">${esc(m.note)}</p>`;
    return `<p class="lead">The model was asked for one proposal from each of five roles and to rate how relevant each is. These are its answers.</p>
      ${section('What was recorded', `<div class="tablewrap"><table><thead><tr><th>Role</th><th>Proposal</th><th class="num">Its rating</th><th class="num">Signal</th><th class="num">Repeat</th><th class="num">Score</th></tr></thead><tbody>${m.candidates.map(c => `<tr class="${c.won ? 'won' : 'lost'}"><td>${esc(ROLE_NAME[c.module] || c.module)}<br><span class="note">${c.won ? 'selected' : 'dropped'}</span></td><td>${esc(c.text)}</td><td class="num">${fmt(c.base)}</td><td class="num">${esc(sign(c.affectBoost) || '0')}</td><td class="num">${esc(sign(c.noveltyPenalty) || '0')}</td><td class="num"><b>${fmt(c.score)}</b></td></tr>`).join('')}</tbody></table></div>`)}
      ${section('Where it came from', `<p>${prov('model')} The text and the rating are the model's. The signal and repeat columns are added by code.</p>`)}
      ${section('Supplied to later stages', '<p>Only the selected proposals go to the reply step. Dropped ones are kept in the record and are not seen again.</p>')}
      <p class="note">${esc(m.note)}</p>
      ${tech(agentMsg(ctx.mem, model.turn)?.monologue?.thinkRaw || '(no raw output stored)', 'Raw model output')}`;
  },

  selected: (m, model, ctx) => {
    if (!m.winners.length) return `<p class="lead">${esc(m.summary)}</p>${m.status === 'skipped' ? '<p class="note">Selection needs proposals. The thinking step produced none.</p>' : ''}`;
    const row = c => `<tr class="${c.won ? 'won' : 'lost'}"><td>${esc(ROLE_NAME[c.module] || c.module)}</td><td class="num">${fmt(c.base)}</td><td class="num">${esc(sign(c.affectBoost) || '0')}</td><td class="num">${esc(sign(c.noveltyPenalty) || '0')}</td><td class="num"><b>${fmt(c.score)}</b></td><td>${c.won ? 'selected' : 'dropped'}</td></tr>`;
    return `<p class="lead">${esc(m.summary)}</p>
      ${section('The rule', `<p>${prov('code')} ${esc(m.rule)}</p>`)}
      ${section('Scores', `<div class="tablewrap"><table><thead><tr><th>Role</th><th class="num">Rating</th><th class="num">Signal</th><th class="num">Repeat</th><th class="num">Score</th><th></th></tr></thead><tbody>${[...m.winners, ...m.dropped].sort((a, b) => b.score - a.score).map(row).join('')}</tbody></table></div>`)}
      ${section('Supplied to later stages', `<p>The reply step received: ${m.winners.map(c => `<b>${esc(ROLE_NAME[c.module] || c.module)}</b>`).join(' and ')}.</p>`)}
      ${tech(m.winners.concat(m.dropped).map(({ module, base, affectBoost, noveltyPenalty, score, won, driver }) => ({ module, base, affectBoost, noveltyPenalty, score, won, driver })), 'Scoring record')}`;
  },

  reply: (m, model, ctx) => {
    const a = agentMsg(ctx.mem, model.turn);
    return `<p class="lead">${m.status === 'partial' ? 'The reply was written, but without proposals, so the process behind it is incomplete.' : m.detail ? 'What the reply step was given. The reply itself is in the conversation.' : esc(m.summary)}</p>
      ${section('What the reply step was given', `<ul class="inputs">${m.inputs.map(i => `<li class="${i.given ? 'yes' : 'no'}"><span class="sr-only">${i.given ? 'Given: ' : 'Not given: '}</span>${esc(i.label)}</li>`).join('')}</ul><p class="note">Not given: ${esc(m.notGiven.join('; '))}.</p>`)}
      <p class="note">This lists what was supplied. The record cannot show which of these shaped the wording, so no influence is claimed.</p>
      ${m.claims.length ? section('Statements it tagged about itself', `${m.claims.map(c => `<p><span class="chip ${esc(c.kind)}">${esc(c.kind)}</span> ${esc(c.text)}</p>`).join('')}<p class="note">Logged as self-reports to examine. They are not evidence of experience.</p>`) : ''}
      ${a?.flags?.filter(f => f.severity === 'warn' && f.check !== 'thinking-incomplete').length ? section('Checks that flagged this reply', a.flags.filter(f => f.severity === 'warn' && f.check !== 'thinking-incomplete').map(f => `<p class="flag warn"><b>${esc(f.check)}</b>: ${esc(f.evidence)} <span class="note">${esc(f.note)}</span></p>`).join('')) : ''}
      ${section('Where it came from', `<p>${prov('model')} Written by the model from the inputs above.</p>`)}
      ${tech(a?.raw ?? '(no raw output stored)', 'Raw model output')}`;
  },

  changes: (m, model, ctx) => {
    const dl = (a = [], b = []) => [...b.filter(x => !a.includes(x)).map(x => `<li class="add">added: ${esc(x)}</li>`), ...a.filter(x => !b.includes(x)).map(x => `<li class="rem">${esc(x)}</li>`)].join('');
    const r = m.revision;
    const a = agentMsg(ctx.mem, model.turn);
    return `<p class="lead">${esc(m.summary)}</p>
      ${r ? section('Its self-description', `<ul class="diff">${dl(r.before.beliefs, r.after.beliefs)}${dl(r.before.uncertainties, r.after.uncertainties)}${dl(r.before.openQuestions, r.after.openQuestions)}</ul><p class="note">The reason it gave: ${esc(r.note)} ${prov('model')}</p>`) : (m.status === 'done' || m.status === 'none' ? '<p>Its self-description did not change.</p>' : '')}
      ${m.evidence.length ? section('Personality evidence added', `${ul(m.evidence.map(e => `<b>${esc(e.name)}</b> (${esc(e.kind)}, ${e.direction === 'supports' ? 'for' : 'against'}): "${esc(e.quote)}"`))}<p class="note">Code checked that the quote appears in the text. Whether it supports the trait was not checked.</p>`) : ''}
      ${m.reports.length ? section('Self-reports logged', ul(m.reports.map(c => `<span class="chip ${esc(c.kind)}">${esc(c.kind)}</span> ${esc(c.text)}`))) : ''}
      ${m.status === 'skipped' ? '<p>A degraded turn does not change memory, so none of its output was saved to the self-description or personality record.</p>' : ''}
      <p class="note">${esc(m.note)}</p>${tech({ revision: r, evidence: m.evidence, reports: m.reports, changeNote: a?.changeNote })}`;
  },
};

function memoryHtml(id, ctx) {
  const mem = ctx.mem, ep = (mem.episodes || []).find(e => e.id === id);
  const given = [];
  for (const m of mem.archive) if (m.role === 'assistant' && m.monologue?.context) for (const k of ['think', 'speak']) if (m.monologue.context[k]?.supplied?.some(s => s.id === id)) given.push(`turn ${m.turn}, ${k === 'think' ? 'thinking' : 'reply'}`);
  if (!ep) {
    const fold = foldedInto(mem, id);
    return `<p class="lead">Memory ${esc(id)} is no longer stored on its own.</p><p>${fold ? `It was folded into summary ${esc(fold.id)}, so its wording is not available.` : 'It is not in the stored memory.'}</p>${given.length ? section('It was supplied to', ul(given.map(esc))) : ''}`;
  }
  return `<p class="lead">A memory the agent made while reading: one passage, summarised in its own words.</p>
    ${section('What was recorded', `<blockquote class="quote">${esc(ep.summary)}</blockquote>${ep.question ? `<p class="note">Question it noted: ${esc(ep.question)}</p>` : ''}`)}
    ${section('Where it came from', `<p>${prov('memory')} ${esc(ep.source)}, passage ${ep.passage}. Read ${esc(when(ep.at))}. ${ep.status === 'degraded' ? '<span class="chip warn">degraded</span>' : ''}</p>${ep.excerpt ? `<p class="note">Start of the passage: "${esc(ep.excerpt)}"</p>` : ''}`)}
    ${section('Where it was supplied', given.length ? ul(given.map(esc)) : '<p>Not supplied to any recorded turn yet.</p>')}
    ${tech(ep)}`;
}

function edgeHtml(model, id) {
  const e = model.edges.find(x => x.id === id), A = model.nodes[e.from], B = model.nodes[e.to];
  const KIND = { supply: 'Given as input', direct: 'Given directly, skipping the stages in between', compute: 'Computed by code', score: 'Changes a score', save: 'Saved by code' }[e.kind];
  return `<p class="lead">${esc(e.text)}</p>
    ${section('Connection', `<p><b>${esc(A.title)}</b> to <b>${esc(B.title)}</b></p><p>${esc(KIND)}. ${e.given ? '<span class="chip ok">Present in this turn\'s record</span>' : '<span class="chip st-none">Not present in this turn</span>'}</p>`)}
    <p class="note">A line shows what was supplied or computed. It does not show that the earlier stage caused anything in the later one.</p>
    ${tech(e)}`;
}

const STAGE_FOR = { proposals: 'think', reply: 'speak' };
// Exact timestamps, attempts, stop reasons and token counts: useful to a developer, noise to everyone else.
function stageRecord(model, id, ctx) {
  const att = STAGE_FOR[id] ? attempts(ctx.mem, model, STAGE_FOR[id]) : '';
  const ev = events(model, id);
  return `<details class="tech"><summary>Timing and attempts</summary>${att}${ev}</details>`;
}

export function inspectorHtml(model, sel, ctx) {
  if (!sel) return overviewHtml(model, ctx);
  if (sel.kind === 'memory') return ctx.mem ? memoryHtml(sel.id, ctx) : '';
  if (sel.kind === 'edge') return model.edges.some(e => e.id === sel.id) ? edgeHtml(model, sel.id) : overviewHtml(model, ctx);
  if (sel.kind === 'proposal') {
    const c = model.nodes.proposals.candidates.find(x => x.module === sel.id);
    if (!c) return overviewHtml(model, ctx);
    return `<p class="lead">${esc(ROLE_NAME[c.module] || c.module)}: one of five proposals. It was <b>${c.won ? 'selected' : 'dropped'}</b>.</p>
      <blockquote class="quote">${esc(c.text)}</blockquote>
      ${section('Score', `<p>Its rating ${fmt(c.base)} ${c.driver ? `+ ${esc(c.driver)} boost ${esc(sign(c.affectBoost) || '0')}` : '+ no signal boost for this role'} ${c.noveltyPenalty ? `+ repeat penalty ${esc(sign(c.noveltyPenalty))}` : ''} = <b>${fmt(c.score)}</b>.</p>`)}
      ${section('Where it came from', `<p>${prov('model')} The text and rating. The boost and penalty are added by code.</p>`)}
      ${section('Supplied to the reply step?', c.won ? '<p>Yes. It was among the two highest scores.</p>' : '<p>No. It scored lower than the selected ones and was dropped.</p>')}`;
  }
  const n = model.nodes[sel.id];
  if (!n) return overviewHtml(model, ctx);
  const head = `<div class="node-head"><h3>${esc(n.title)}</h3>${nodeChip(n)} ${prov(n.who)}</div>`;
  return head + (NODE[sel.id]?.(n, model, ctx) ?? '') + (model.live ? '' : stageRecord(model, sel.id, ctx));
}
export const stepInfo = i => STEPS[i];
