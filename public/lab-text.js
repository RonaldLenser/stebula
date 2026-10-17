// Plain-language descriptions for each Lab activity. Each answers the same five questions, and each line was
// checked against the code that runs it (src/research/lesson.js, src/research/experiments.js, src/engine/run.js,
// public/growth.js). If a mechanism changes, change the matching line here.
export const HOW_LABELS = [['happens', 'What will happen'], ['answers', 'Which agent answers'], ['evaluates', 'Who or what evaluates it'], ['changes', 'What changes between comparisons'], ['tells', 'What the result tells us']];

export const HOW = {
  lesson: {
    happens: 'Each attempt starts a new agent with one saved lesson in its memory, or none. It picks one test, predicts the result, sees the real result, then labels eight new number triples.',
    answers: 'A fresh copy of Agent A with an empty memory apart from the lesson. In practice mode a script answers instead of a model.',
    evaluates: 'Code. It scores the labels against the true rule, which no prompt ever contains.',
    changes: 'Only the saved lesson: a useful one, none, one on an unrelated topic (matched in length), or optionally the useful one with its words shuffled.',
    tells: 'Whether a saved lesson changes this agent\'s next decision on this kind of task. It is a small pilot on one task family. Practice mode only checks that the pipeline works.',
  },
  isolation: {
    happens: 'Four agents start the same and then receive different input over several steps. After some steps each one answers five questions about itself and takes two self-prediction tests.',
    answers: 'Copies of Agent A that start with an empty memory. This one always needs a live model.',
    evaluates: 'Code. Traits are the agents\' own proposals, and code only checks that each quote really appears in the text. Self-predictions are scored from two fresh answers.',
    changes: 'What each agent receives: reading only, conversation only, both, or nothing (the comparison agent).',
    tells: 'Whether differences in what an agent receives are followed by differences in the traits it expresses. One run is one pilot observation.',
  },
  compare: {
    happens: 'Agent A and Agent B are shown side by side with an empty-memory copy that answers the same five questions.',
    answers: 'Agents A and B with the memory they have now, and a comparison agent: a copy with no memory.',
    evaluates: 'Code matches trait names by word overlap, so near-synonyms can be missed.',
    changes: 'What each agent has read and said so far. The comparison agent has read nothing.',
    tells: 'Which traits could come from the base model rather than from anything read. One comparison is an anecdote.',
  },
  rules: {
    happens: 'Two agents test a hidden number rule, talk about it, reflect, and test again.',
    answers: 'Agents A and B. Scripted mock agents need no key, and their improvement is built in, so they only test the plumbing. Live runs use a model.',
    evaluates: 'Code. It scores the agents\' guesses against the true rule.',
    changes: 'The setup you pick: memory on or off, reflection on or off, two agents or one.',
    tells: 'Whether memory and reflection change how well the agents find the rule. One run is an anecdote; compare many repeatable setups before believing a difference.',
  },
  checks: {
    happens: 'The agent predicts how two fresh copies of itself will answer a statement. The copies then answer without seeing the prediction. A second kind of check asks another model call to review recent turns.',
    answers: 'The agent you choose, using its stored memory. The fresh copies are the same agent without the prediction.',
    evaluates: 'Code scores the self-prediction. The audit is a separate model call, so it is fallible and its quotes are shown for you to judge.',
    changes: 'Nothing. These checks read the agent and, for self-predictions, save the result to its record.',
    tells: 'Whether the agent predicts its own answers better than chance. An unreadable answer is counted as invalid, never as wrong.',
  },
};

export const howHtml = (id, esc) => `<section class="how" aria-label="How this works"><h3>How this works</h3><dl>${HOW_LABELS.map(([k, name]) => `<div><dt>${esc(name)}</dt><dd>${esc(HOW[id][k])}</dd></div>`).join('')}</dl></section>`;
