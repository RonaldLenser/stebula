# Architecture

Node 18+, no dependencies, no build step. Vanilla JS ES modules. The server serves the app and proxies model calls so the API key stays server-side.

Status key: BUILT (in the repo), SPECCED (prompt written, see 07-build-prompts.md), PLANNED.

## 1. Experiment engine (BUILT)
- `src/env/ruleTask.js`: hidden-rule tasks. Number triples (0 to 30). Seed examples fit a narrow decoy rule; the real rule is broader. Only tests the agent expects to fail can reveal it (Wason 2-4-6 structure). Ground truth and scoring are code, never a model.
- `src/engine/run.js`: two agents (A empiricist, B analogist) or one agent. Protocol per episode: encounter, retrieve memory, predict and test, question each other, synthesize, decide alone, reveal, reflect, record. Round 1 is independent so pre-existing agreement can be measured.
- Conditions: dyad-reflect, dyad-noreflect, dyad-nomemory, single-reflect.
- `src/eval/checks.js`: evaluator flags flattery, repetition, shared priors, unsupported certainty, ungrounded consensus, self-reports, stated-vs-actual gaps.
- `scripts/batch.js`: multi-seed comparison with rough 95% intervals.
- Event log drives the UI. Any run can be exported and replayed.

## 2. Talk agent (BUILT)
Each turn is two model calls:
1. **Think:** five processes each propose one thought: perception, memory, self-monitor, evaluation, initiative. Each self-rates relevance.
2. **Compete (code):** score = relevance + affect boost + repetition penalty. Only 2 thoughts enter the workspace (capacity 2).
3. **Speak:** the answering stage sees only the winning thoughts. Losers are dropped and logged.

Modeled affect (`src/talk/workspace.js`), computed by code each turn:
- surprise rises when the person points out a contradiction or a self-prediction failed; boosts self-monitor
- conflict rises when the person challenges it; boosts evaluation
- curiosity rises with how new the message is; boosts initiative
- Boost 0.4 x signal, repetition penalty 0.3 x overlap. Hand-chosen weights.

Memory (`data/talk-<agent>.json`): self-model (beliefs, uncertainties, open questions), model of the person, rolling summary, full archive, revisions with before/after/reason/trigger, self-reports, flags, audits, self-tests, reflections.

Also built:
- Self-prediction tests: predict whether a fresh copy agrees with a statement, then two fresh copies answer blind. Scores self-knowledge and answer stability.
- Between-session reflection: after 30+ minutes away, it reviews the record on return and opens with something to say or ask. Nothing runs while away.
- Audit: separate model call reviews recent turns for contradiction, sycophancy, unsupported certainty, memory errors, persuasive-but-empty language.
- Per-turn checks: confident experience claims, confident denials, untagged self-reports, sycophancy, repetition, revisions without reasons.
- Voice: browser speech recognition in, browser voices out, hands-free mode.
- Robust output handling: cut-off JSON is retried once, then the reply text is salvaged.

## 3. Brain view (SPECCED, prompt 1)
Live SVG brain, side view, five regions mapped to the real processes plus a central Workspace and a Voice indicator. Driven by a server-sent events stream of turn stages: heard, affect, thoughts, workspace, speaking, selfmodel, done. Emotion signals panel labeled "Modeled from the conversation. Not felt." Turn scrubber replays past brain states. Caption: "A map of Stebula's software processes, not a scan of the model."

## 4. Digest and personality growth (SPECCED, prompt 2)
- Read to Stebula by voice, paste, or file. Passages of about 200 words stream through the brain view. Each becomes an episodic memory with source and passage number.
- Personality model controlled by code: traits, motives, beliefs with strength 0 to 1. Support +0.15, contradiction -0.2. Status: emerging (1 event), forming (2+), established (3+ events from 2+ sources).
- Said vs shown: each trait mapped to a measurable proxy (questions per turn, challenges, hedging, references to memories, initiative wins).
- Growth view: live network graph of sources, events, and traits with provenance for every trait.
- Compare view: Agent A vs Agent B vs a fresh empty-memory baseline.

## 5. Research data layer (SPECCED, prompt 3)
- Append-only JSONL record of every input, model call, stage, memory change, test, audit, digest.
- CSV exports plus a data dictionary.
- Findings registry with locked predictions and statuses.
- Human comparison panel per finding.
- Isolation experiment presets.

## 6. Scorecard (BUILT)
14 indicator properties from consciousness science with honest status. See 04-research/indicator-scorecard.md.

## 7. Operations (BUILT)
- `npm start` runs `scripts/run.js`: pulls from GitHub on start and every 2 minutes, notices local commits, restarts the server, page shows a Reload bar. Never overwrites uncommitted edits. Rebases local commits on top of GitHub changes, backs out on conflict.
- `npm run serve` runs without updating. `npm test` checks all plumbing with stub models. `npm run batch` runs experiments.
- Model transport drops `temperature` automatically if the model rejects it.
