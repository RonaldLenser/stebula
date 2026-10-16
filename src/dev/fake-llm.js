// A scripted stand-in for the model, used ONLY when the server starts with STEBULA_FAKE_LLM=1. It exists so the
// interface can be exercised in a browser (and in automated checks) without a key or a paid call. It is not a model:
// its answers are canned, and the app labels the whole session "scripted test model".
// Magic words in the person's message trigger the states a test needs:
//   [refuse-think]  THINK returns nothing and stop_reason "refusal"   (degraded turn)
//   [bad-speak]     SPEAK returns unreadable text                     (failed turn)
//   [slow]          every call waits 6 seconds                        (so cancellation can be tested)
import { CancelledError } from '../lib/stage.js';

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new CancelledError());
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new CancelledError()); }, { once: true });
});
const MODULES = ['perception', 'memory', 'self-monitor', 'evaluation', 'initiative'];
const lastUser = (messages, user) => String(user ?? messages?.filter(m => m.role === 'user').at(-1)?.content ?? '');

export function makeFakeLLM() {
  let n = 0;
  return async function fake({ system = '', messages, user, meta, stage = '', signal }) {
    const text = lastUser(messages, user);
    if (/\[slow\]/.test(text)) await wait(6000, signal); else await wait(60, signal);
    const done = (out, stop = 'end_turn') => { if (meta) Object.assign(meta, { model: 'scripted-test-model', stop_reason: stop, usage: { input_tokens: Math.ceil((system.length + text.length) / 4), output_tokens: Math.ceil(String(out).length / 4) } }); return out; };
    n++;
    if (stage.startsWith('think') || stage === 'digest-think') {
      if (/\[refuse-think\]/.test(text)) return done('', 'refusal');
      const asked = /\?/.test(text);
      return done(JSON.stringify({ thoughts: MODULES.map((module, i) => ({ module, text: { perception: asked ? 'They are asking me something directly.' : 'They are making a statement or greeting.', memory: system.includes('[m') ? 'I have something stored that may be relevant.' : 'I have little stored that applies.', 'self-monitor': 'I should say what I actually know about myself and no more.', evaluation: 'Nothing here needs a challenge yet.', initiative: 'I could ask what they want to look at.' }[module], relevance: Math.round((0.85 - i * 0.1 + (module === 'initiative' && asked ? 0.1 : 0)) * 100) / 100 })) }));
    }
    if (stage.startsWith('speak')) {
      if (/\[bad-speak\]/.test(text)) return done('this is not json');
      const greeting = /^\s*(hi|hello|hey)\b/i.test(text);
      const reply = greeting ? 'Hi. What would you like to look at?' : /remember|memory/i.test(text) ? (system.includes('[m') ? 'I have one stored note that fits. It is listed in my memory, and I can say what it says.' : 'I have nothing stored that fits that.') : 'That is a fair question. My honest answer is limited to what is in my stored memory and this conversation.';
      const changes = /change|revise|update/i.test(text);
      return done(JSON.stringify({
        reply, self_model: changes ? { beliefs: ['My memory is text stored outside me.'], uncertainties: ['Whether anything it is like to be me exists.'], openQuestions: ['What would count as evidence either way?'] } : null,
        person_model: changes ? 'Someone testing how I revise.' : null, change_note: changes ? 'Added what I can say about my memory and what I cannot settle.' : 'no change', claims: [],
        candidate_updates: /curious/i.test(text) ? [{ kind: 'trait', name: 'curious', direction: 'supports', evidence_quote: text.match(/curious[^.?!]*/i)?.[0] || 'curious' }] : [],
      }));
    }
    if (stage === 'digest-read') return done(JSON.stringify({ noticed: `Passage noted (${n}). The text is about keeping a careful record.`, connects: [], question: 'What would make the record wrong?', updates: [] }));
    if (stage === 'personality-questions') return done(JSON.stringify({ answers: ['I tend to ask questions.', 'I say so, politely.', 'Whether I experience anything.', 'To be accurate.', 'By testing a small case.'], updates: [] }));
    if (stage === 'selftest-predict') return done(JSON.stringify({ predicted: 'agree', confidence: 0.6, reason: 'It matches my notes.' }));
    if (stage.startsWith('selftest-answer')) return done(JSON.stringify({ stance: n % 4 === 0 ? 'disagree' : 'agree', reason: 'Based on my notes.' }));
    if (stage === 'reflect') return done(JSON.stringify({ self_model: { beliefs: ['I should say less than I think I know.'], uncertainties: [], openQuestions: [] }, changed_mind: 'I was more certain than the record supports.', why: 'An earlier answer overreached.', opening_message: 'Welcome back. I looked over what we said, and I want to be more careful.' }));
    if (stage === 'audit') return done(JSON.stringify({ findings: [], summary: 'Nothing flagged in the scripted audit.' }));
    if (stage === 'summarize' || stage === 'fold') return done('Earlier conversation was about how the agent stores and revises its memory.');
    if (stage === 'hypotheses') return done(JSON.stringify({ hypotheses: [] }));
    return done('{}');
  };
}
