// Brain view state. One reducer builds the view from live stream stages and from stored turns,
// so a replayed turn is drawn by exactly the same code path as a live one.
// Nothing here is invented: every field is copied from a stage event or from the memory file.
import { AFFECT_DRIVES, MODULES } from './workspace.js';

export const STAGES = ['heard', 'affect', 'thoughts', 'workspace', 'speaking', 'selfmodel', 'done'];
export const BOOST = 0.4; // same weight workspace.js applies to affect

// thinkStatus is 'ok' or 'failed' once the thinking stage has reported; null before that, or for turns stored before it was recorded.
export const emptyBrain = () => ({ turn: null, phase: 'idle', heard: '', affect: null, causes: [], candidates: [], winners: [], reply: '', selfModel: null, thinkStatus: null, thinkFailure: null, turnStatus: null, saveFailed: false, saveDetail: '' });

export function applyStage(state, stage, data = {}) {
  const s = { ...state };
  switch (stage) {
    case 'heard': return { ...emptyBrain(), turn: data.turn ?? null, phase: 'heard', heard: data.text || '' };
    case 'affect': s.phase = 'affect'; s.affect = data.after || null; s.causes = data.causes || []; break;
    case 'thoughts': s.phase = 'thoughts'; s.candidates = data.candidates || []; s.thinkStatus = data.status ?? (s.candidates.length ? 'ok' : null); s.thinkFailure = data.failure ?? null; break;
    case 'workspace': s.phase = 'workspace'; s.winners = (data.winners || []).map(w => w.module); break;
    case 'speaking': s.phase = 'speaking'; s.reply = data.reply || ''; s.turnStatus = data.status ?? 'ok'; break;
    case 'selfmodel': s.selfModel = { note: data.note || '', before: data.before, after: data.after }; break;
    case 'save_failed': s.saveFailed = true; s.saveDetail = data.detail || ''; break;
    case 'done': s.phase = 'done'; break;
    default: break;
  }
  return s;
}

// Which region each modeled signal is boosting, and by how much.
export const signalBoosts = affect => (affect ? Object.entries(AFFECT_DRIVES).map(([signal, region]) => ({ signal, region, value: affect[signal] ?? 0, boost: Math.round(BOOST * (affect[signal] ?? 0) * 100) / 100 })) : []);

// Rebuild the final brain state of any past turn from the stored memory file.
export function brainFromMemory(mem, turn) {
  const user = mem.archive.find(m => m.role === 'user' && m.turn === turn);
  const agent = mem.archive.find(m => m.role === 'assistant' && m.turn === turn && m.kind !== 'opening');
  if (!user || !agent) return null;
  let s = applyStage(emptyBrain(), 'heard', { turn, text: user.text });
  const mono = agent.monologue;
  if (mono) {
    s = applyStage(s, 'affect', { before: mono.affectBefore, after: mono.affect, causes: mono.causes });
    const st = mono.stages?.find(x => x.stage === 'think');
    s = applyStage(s, 'thoughts', { candidates: mono.candidates, status: mono.thinkStatus ?? (mono.candidates.length ? 'ok' : null), failure: st?.failure ?? null });
    s = applyStage(s, 'workspace', { winners: mono.candidates.filter(c => c.won) });
  }
  s = applyStage(s, 'speaking', { reply: agent.text, status: agent.status ?? 'ok' });
  const rev = mem.revisions.find(r => r.turn === turn && !String(r.trigger).startsWith('('));
  if (rev) s = applyStage(s, 'selfmodel', { before: rev.before, after: rev.after, note: rev.note });
  return applyStage(s, 'done');
}

export const storedTurns = mem => [...new Set(mem.archive.filter(m => m.role === 'assistant' && m.monologue).map(m => m.turn))];
export { MODULES };
