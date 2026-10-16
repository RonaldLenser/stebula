# Threshold (becoming Stebula)

**Start here: [knowledge/README.md](knowledge/README.md)** holds everything known, decided, and planned for this project.

A lab notebook you can run. Two language-model agents face a hidden rule, talk, test, decide, and reflect. Everything they say and every change to their memory is recorded, and the question is whether any of it changes what they do next.

## The research question

Does structured interaction plus reflection on measured behavior produce changes in a system's self-model that then change its later decisions on a new problem, beyond what the same system does without interaction, memory, or reflection?

This tests a narrow, functional slice of the guiding hypothesis ("consciousness may involve dynamic processes that emerge and reorganize through interaction, reflection and memory"). It can show whether those processes do measurable work in this system. It cannot show whether anything is experienced. That gap stays visible on purpose.

## What you see

- **Conversation**: every turn, test, prediction, synthesis and decision, with the exact prompt and raw output one click away.
- **Threshold map**: each hypothesis an agent states, colored by whether its predictions held, with revisions and recorded challenges.
- **Agent state**: persistent memory, self-model, lessons, model of the partner, and modeled affect (numbers computed from outcomes, labeled as such).
- **Timeline**: revisions, failed predictions, interventions, memory writes and evaluator flags. Click to jump the replay there.
- **Before and after**: measured results for episode 1 vs episode 2.
- **Reflection and checks**: what each agent claims was established, what is unresolved, what it proposes to test next, memory diffs, evaluator flags, and claims to examine.
- **Controls**: run, step one round, inject a true counterexample, add an experimenter note, reset, export, load, replay.

Every visual is drawn from the event log. Decorative elements are labeled.

## Talk

An open conversation with Agent A or B, built on mechanisms taken from scientific theories of consciousness. Needs a live key.

Each turn has two stages:

1. **Think.** Five processes each propose one thought: perception, memory, self-monitor, evaluation, initiative.
2. **Compete.** Code scores the thoughts. Only 2 enter the workspace (global workspace theory). Modeled affect shifts the odds: surprise boosts self-monitoring, conflict boosts evaluation, curiosity boosts initiative. Repeating last turn's thoughts is penalized.
3. **Speak.** The answering stage sees only the winning thoughts. Losers are dropped and logged.

Open "What it thought" under any answer to see every candidate, its score breakdown, and what won.

Also in Talk:

- **Persistent memory** in `data/talk-A.json`: self-model, its model of you, a rolling summary, every message. That file is all it remembers.
- **Self-prediction tests**: it predicts whether a fresh copy of itself will agree with a statement, then two fresh copies answer without seeing the prediction. Code scores whether it knows itself, and whether its own answers are stable.
- **Between-session reflection**: come back after 30 minutes and it reviews the last conversation, revises its self-model, and opens with something it wants to say or ask. The review runs when you return. Nothing runs while you are away, and the app says so.
- **Revision history**: every self-model change with before, after, reason, and trigger.
- **Checks and audits**: per-turn flags for confident experience claims, confident denials, sycophancy, repetition; a separate audit call on demand.

What it is told about itself: nobody currently knows whether it has subjective experience, so it should neither claim nor deny that with certainty. It is never told to perform awareness or its absence. Read `src/talk/prompts.js`.

Cost: 2 model calls per message, 3 per self-prediction test, 1 per reflection or audit.

## Scorecard

Fourteen indicator properties drawn from theories of consciousness (following Butlin, Long et al. 2023), with an honest status for each: implemented, partial analog, absent, or cannot tell. Current count: 1 implemented, 6 partial, 6 absent, 1 cannot tell. The page explains why that count does not settle anything.

## Run it

Requires Node 18 or newer and Git. No dependencies.

```bash
gh repo clone RonaldLenser/threshold-lab && cd threshold-lab
npm test              # checks the plumbing with scripted mock agents
npm start             # open http://localhost:5173
```

`npm start` keeps itself current. It pulls new commits from GitHub on start and every 2 minutes, notices local commits too, restarts the server, and the page offers a reload. It never overwrites uncommitted edits. Use `npm run serve` to run without updating.

For real agents:

```bash
cp .env.example .env  # add ANTHROPIC_API_KEY, optionally MODEL
npm start
```

## Working on it with Claude Code

Open Claude Code in this folder and describe the change. `CLAUDE.md` tells it the rules: test, commit, push. The running app updates itself.

## Run the experiment properly

One run is an anecdote. Experiment 01 compares four conditions across seeds:

```bash
npm run batch -- --mode mock --seeds 10                 # free, plumbing only
npm run batch -- --mode live --seeds 20 --rounds 4      # real test, costs API calls
```

Live cost: about 14 model calls per episode for a dyad, 2 episodes per run, per seed, per condition. 20 seeds x 4 conditions is roughly 1,000 calls. Start with `--seeds 3 --conditions dyad-reflect,dyad-nomemory`.

The batch prints a comparison table and saves every event log in `runs/`. Load any run in the app to replay it.

## Architecture

```
src/env/ruleTask.js       hidden-rule tasks, ground truth, scoring (code, not a model)
src/agents/prompts.js     every word agents see
src/agents/live.js        LLM agent
src/agents/mock.js        scripted stand-in for running without a key
src/memory/store.js       persistent per-agent memory and diffs
src/engine/run.js         experiment protocol, conditions, event log
src/engine/affect.js      modeled affect variables
src/eval/checks.js        evaluator: flattery, repetition, shared priors, unsupported certainty, stated-vs-actual gaps
public/                   browser app, renders only from the event log
scripts/batch.js          multi-seed condition comparison
docs/                     research map, experiment design, limitations
```

## Read before believing anything

- [knowledge/05-experiments/exp01-hidden-rule.md](knowledge/05-experiments/exp01-hidden-rule.md): design, predictions, and what counts against the hypothesis
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md): what this cannot show
- [knowledge/04-research/](knowledge/04-research/): theories, scorecard, human vs AI development, human research reference. References are not yet verified.

## Roadmap

1. **v0.1 (this)**: hidden-rule task, two agents, memory, reflection, evaluator, replay, batch comparison.
2. **v0.2**: run Experiment 01 live across 20+ seeds. Verify every reference. Add an LLM judge alongside the heuristic checks and measure where they disagree.
3. **v0.3**: harder task family the model has not seen in training (to escape ceiling effects), misleading-evidence injections, side-by-side comparison of two runs.
4. **v0.4**: dialogue experiments on self-observation ("catching your own shadow"): agents predict their own next answer, then compare. Tests self-model accuracy directly.
5. **v0.5**: limited-capacity shared workspace (global workspace analog) vs open log, as an ablation.

## License

MIT
