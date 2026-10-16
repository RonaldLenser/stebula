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
- Output handling: every stage is validated; failures are classified and retried once where a retry can help (see section 8). A turn with a failed thinking stage is degraded and excluded from analysis.

## 3. Brain view (BUILT, prompt 1)
Live SVG brain, side view, five regions mapped to the real processes plus a central Workspace and a Voice indicator. Driven by a server-sent events stream of turn stages: heard, affect, thoughts, workspace, speaking, selfmodel, done. Emotion signals panel labeled "Modeled from the conversation. Not felt." Turn scrubber replays past brain states. Caption: "A map of Stebula's software processes, not a scan of the model."

## 4. Digest and personality growth (BUILT, prompt 2)
- Read to Stebula by voice, paste, or file. Passages of about 200 words stream through the brain view. Each becomes an episodic memory with source and passage number.
- Personality model controlled by code: traits, motives, beliefs with strength 0 to 1. Support +0.15, contradiction -0.2. Status: emerging (1 event), forming (2+), established (3+ events from 2+ sources, counterevidence a minority, strength at least 0.3), contested (counterevidence at least half of the supporting events). Quotes are checked for presence only; whether they support the trait is recorded as unreviewed.
- Said vs shown: each trait mapped to a measurable proxy (questions per turn, challenges, hedging, references to memories, initiative wins).
- Growth view: live network graph of sources, events, and traits with provenance for every trait.
- Compare view: Agent A vs Agent B vs a fresh empty-memory baseline.

## 5. Research data layer (BUILT, prompt 3)
- Append-only JSONL record of every input, model call, stage, memory change, test, audit, digest.
- CSV exports plus a data dictionary.
- Findings registry with locked predictions and pilot labels (not verdicts).
- Human comparison panel per finding.
- Isolation experiment presets.

## 6. Scorecard (BUILT)
14 indicator properties from consciousness science with honest status. See 04-research/indicator-scorecard.md.

## 7. Operations (BUILT)
- `npm start` runs `scripts/run.js`: pulls from GitHub on start and every 2 minutes, notices local commits, restarts the server, page shows a Reload bar. Never overwrites uncommitted edits. Rebases local commits on top of GitHub changes, backs out on conflict.
- `npm run serve` runs without updating. `npm test` checks all plumbing with stub models. `npm run batch` runs experiments.
- Model transport drops `temperature` automatically if the model rejects it.

## 8. Audit response architecture (BUILT unless marked)

### Memory context contract (`src/talk/context.js`)
One function, `buildContext`, decides which stored memories a model call may see. Mode `on` supplies the agent's own memory plus a bounded set of reading memories (at most 4 episodes and 1,600 characters), chosen by relevance to the query or, for checkpoint questions, by recency. Mode `off` supplies nothing stored. Every supplied memory keeps its id and source. The descriptor (mode, ids, sizes) is recorded with every model call, so "the file contains a memory" and "the model received it" are separate, checkable facts. Personality traits are evaluation annotations: they stay out of agent prompts unless a protocol sets `traits: in-prompt` on purpose, and that choice is recorded.

### Stage runner and failure kinds (`src/lib/stage.js`, `src/talk/schemas.js`)
Every model stage (think, speak, reflect, audit, personality questions, digest read, self-test predict and answer, lesson probe and decide) runs through `runStage`: prompt, bounded attempts, validation, outcome. A stage returns a validated value or a failure with a kind: `refusal`, `truncation`, `malformed`, `schema`, `empty`, `transport`, `timeout`, `cancelled`. Truncation, malformed, schema and empty get one retry (truncation with a larger token limit); a refusal is not retried. Every attempt keeps its raw output and diagnostics. The five-role THINK contract requires five unique recognized roles, valid text, and relevance from 0 to 1. A failed THINK makes the turn **degraded** (labeled, shown, excluded from analysis); a failed SPEAK fails the turn and saves nothing.

### Transport (`src/agents/transport-node.js`)
Per-request timeout, bounded exponential backoff for 429, 5xx and network errors (honoring `retry-after`), and an abort signal that stops a request and any pending retry. Structured output is requested with `output_config.format` of type `json_schema` (checked against the provider documentation on 2026-10-16, which lists `claude-sonnet-5-5` as supported). If the model rejects it, the transport stops sending it and relies on code validation alone. Code validators remain the real gate either way.

### Jobs, cancellation and shutdown (`src/lib/jobs.js`, `server.js`)
Turns, readings and experiments are jobs. A job is cancelled when the browser disconnects or when asked, which aborts the signal every model call checks, so no further paid calls are made, and the final state is recorded. On shutdown the server stops accepting requests, cancels work, and flushes the record. The launcher asks the server over IPC how many jobs are running and defers restarts until none are.

### Access model (`src/lib/access.js`)
The server binds to `127.0.0.1` by default and checks Host and Origin headers so a web page on another site cannot drive it. A non-loopback `HOST` requires `STEBULA_TOKEN` for every `/api` call except the public ones. `STEBULA_PUBLIC=1` serves replay only. The code revision is pinned in each manifest.

### Stored state
Agent ids are validated at the route and at the storage boundary, and the file path is contained to the data folder. Memory and registry files are written atomically. A damaged file is an error, not a fresh start. Reset, conversation and every other mutation of one agent run under one per-agent lock. The findings registry has one writer (`makeRegistry`) that serializes updates and refuses a change that would break a lock hash. The recorder queues lines, reports failed appends, and exposes `health()`.

### Protocols, manifests and assessments (`src/research/protocol.js`, `experiments.js`)
An experiment writes `protocol.json` (design, predictions with lock hashes, parameters, manifest) before its first model call. The manifest names model, prompt version, code revision, plan and estimated calls; the result adds usage and exclusions. Checkpoints are assessments on an immutable snapshot of memory, stored in the result and not in the treatment memory. A step that fails after retries marks its condition incomplete and excludes it from metrics. A cancelled run saves a partial result marked cancelled and feeds nothing.

### Findings and evaluation (`src/research/findings.js`)
Statuses are pilot labels: proposed, testing, exploratory, inconclusive, pilot-consistent, pilot-inconsistent. There is no significance test. A statistics-based finding is measured only on data recorded after it was locked, when its metric can be restricted that way; otherwise the result is exploratory and never earns a consistent or inconsistent label. Results are idempotent per run id. Self-tests with an unreadable prediction or answer are invalid and excluded from accuracy, with the invalid count reported.

### Two-agent engine changes (`src/engine/`)
Analysis is per run, not per agent (`analyze.js`). Round 0 hypotheses and probes come from the same observation snapshot. The decision call receives the agent's own synthesis, in both live and scripted agents. Call estimates are computed from the plan (`estimate.js`): 102 per seed for four conditions at four rounds, 2,040 for 20 seeds.

### Flagship lesson experiment (`src/research/lesson.js`)
Question: does a stored lesson change the next decision on a new problem? Matched hidden-rule tasks (same seeds in every condition), a fresh agent per trial, and conditions that differ only in one stored lesson: relevant, none, length-matched irrelevant (optionally shuffled). A trial has two stages. PROBE: the agent picks one test triple and predicts its result and confidence; this is recorded before code computes the outcome. DECIDE: after seeing the result it classifies 8 new triples, scored by code against ground truth that is never in a prompt. A trial with a failed stage is invalid, counted, and excluded. Reports: accuracy, hardest-item accuracy, expected-reject and discriminating-probe rates, calibration gap and Brier, latency, tokens, invalid counts, and matched-task differences against no lesson with a t-based 95% interval. Every trial can be replayed. A deterministic scripted double (`lesson-double.js`) reads only the prompt and exists to test the plumbing; its improvement is scripted and proves nothing about a model. Live runs need an explicit call budget.

### Interface
Three primary views replace six (`public/main.js` routes them; `observe.js`, `experiments.js` and `research.js` build them; `core.js` holds shared helpers; styles are one file with a light and a dark token set). **Observe**: the conversation (about two thirds) plus one contextual inspector with tabs Process, Changes, Memory, Checks and Raw; Growth becomes change history here. **Experiments**: Stored lesson (flagship), Isolation, Compare agents, Two-agent hidden-rule runs. **Research**: Findings, Methods and sources, Limitations, Scorecard. Missing data, a legitimate zero and a failed stage look different. A scripted example is always labeled scripted. On a phone the conversation comes first and the inspector opens as one sheet.

Interface verification: `npm run ui-check` starts the real server with a scripted stand-in for the model (`STEBULA_FAKE_LLM=1`, `src/dev/fake-llm.js`, clearly labeled in the page) and drives headless Chrome or Edge over the DevTools protocol (`scripts/browser.js`, no dependency). It checks empty, loading, success, degraded, failed and cancelled states, memory controls, replay, keyboard use, labels, experiments and narrow screens, and writes screenshots. `scripts/test-contrast.js` (part of `npm test`) checks that every text and background pair in both themes meets 4.5:1.
