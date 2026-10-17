# Stebula (formerly Threshold)

**Start here: [knowledge/README.md](knowledge/README.md)** holds everything known, decided, and planned for this project.

Stebula is a visual laboratory for how an AI agent's memory, self-description, attention mechanism and decisions interact. You can talk to the agent or read to it and watch, from recorded data, which information it received, which thoughts it proposed, which two won a limited workspace, what changed in its stored memory, and whether that change affects a later decision. Everything that "grows" is text in an external memory file that is pasted into prompts; the model's weights never change. The process view is a diagram of software state, not a scan of neural activity, and nothing here produces a consciousness score or says whether anything is experienced.

## Why Stebula exists

Stebula began with a personal question: how much of who we become is chosen, and how much comes from the expectations we absorb?

What would happiness mean without money as its measure? Who might we become without having to prove our worth through success?

These questions motivate the ambition to build an AI agent whose development we can observe, following its memories, expressed priorities, self-description, and decisions over time. Consciousness is an open question guiding the project, not an established capability.

Read [the motivation and vision behind Stebula](./VISION.md).

## The research question

Does structured interaction plus reflection on measured behavior produce changes in a system's self-model that then change its later decisions on a new problem, beyond what the same system does without interaction, memory, or reflection?

This tests a narrow, functional slice of the guiding hypothesis ("consciousness may involve dynamic processes that emerge and reorganize through interaction, reflection and memory"). It can show whether those processes do measurable work in this system. It cannot show whether anything is experienced. That gap stays visible on purpose.

The flagship experiment asks the smallest version of it: **does a stored lesson change the agent's next decision on a new problem?** Matched hidden-rule tasks, a relevant lesson versus no lesson versus a length-matched irrelevant lesson, the prediction recorded before the outcome, and scoring against ground truth that never appears in a prompt.

## The three destinations

- **Agent**: the main screen has two areas. On the left, the conversation: each reply appears once. On the right, a compact overview of the selected interaction that answers three questions from recorded state: what went into this response (your message, stored context, instructions and priorities, conversation signals, the selected proposals), what it considered (the proposals it selected, with the rest and the scores one click away) and what changed afterward (saved changes as added and removed lines, or "Nothing was saved or changed after this response."). If a stage failed, one notice at the top of the overview says which and why, and "View details" opens the diagnostic record. Details open in a drawer that is closed by default, with Back, Close and Escape; "Process diagram" opens the full stage-by-stage diagram, which can be stepped through. A strip at the top says which agent you are talking to and what it is doing now.
- **History**: every recorded moment for the agent (turns, readings, reflections, checks), newest first. Pick one to see the conversation, its process map and the state recorded then. What was not recorded, such as earlier versions of the note about the person, is listed as a gap, never filled from the present.
- **Lab**: the stored lesson experiment, what agents receive, compare agents, hidden-rule runs, self-checks, findings, methods, limits and indicators. Each test says what happens, which agent answers, who or what evaluates it, what changes between comparisons, and what the result tells us.

## Talk

An open conversation with Agent A or B, built on mechanisms taken from scientific theories of consciousness. Needs a live key.

Each turn has these stages:

1. **Think.** Five processes each propose one thought: perception, memory, self-monitor, evaluation, initiative. The set is validated: five unique recognized roles, valid text, relevance from 0 to 1.
2. **Compete.** Code scores the thoughts. Only 2 enter the workspace (global workspace theory). Modeled affect shifts the odds: surprise boosts self-monitoring, conflict boosts evaluation, curiosity boosts initiative. Repeating last turn's thoughts is penalized.
3. **Speak.** The answering stage sees only the winning thoughts. Losers are dropped and logged.

If the thinking stage fails (for example the provider refuses), the turn continues as **degraded**: it is labeled, shown, and excluded from analysis. If the speaking stage fails, the turn fails and nothing is saved.

Also in Talk:

- **Persistent memory** in `data/talk-A.json`: self-model, its model of you, a rolling summary, reading memories, every message. That file is all it remembers. A bounded, relevant slice of it is delivered to each model call, and the record says exactly which memory ids were delivered. A memory switch turns delivery off.
- **Self-prediction tests** ("Can it predict its next answer?"): it predicts whether a fresh copy of itself will agree with a statement, then two fresh copies answer without seeing the prediction. Unreadable answers make a test invalid, not wrong.
- **Between-session reflection**: come back after 30 minutes and it reviews the last conversation. Nothing runs while you are away.
- **Revision history**, **checks and audits**, and **Read to Stebula** (Digest) with a code-controlled personality model.

What it is told about itself: nobody currently knows whether it has subjective experience, so it should neither claim nor deny that with certainty. It is never told to perform awareness or its absence. Read `src/talk/prompts.js`.

Cost: 2 model calls per message (more if a stage is retried), 3 per self-prediction test, 1 per reflection or audit.

## Scorecard

Fourteen indicator properties drawn from theories of consciousness (following Butlin, Long et al. 2023), with an honest status for each. The page explains why the count does not settle anything.

## Check the interface

`npm run ui-check` starts the server with a scripted stand-in for the model and drives headless Chrome or Edge through the interface: empty, degraded, failed and cancelled states, memory controls, replay, keyboard use, experiments and a phone-sized screen. It writes screenshots to a temp folder (set SHOTS to choose one). It needs Chrome or Edge and is not part of `npm test`.

## One reproducible demonstration

This needs no key and costs nothing. It shows the pipeline, not the hypothesis.

```powershell
npm test                          # all test files, scripted stubs only
node scripts/make-example.js      # rebuilds examples/observe-example.json (scripted fixture)
npm start
```

Then, with the server running, either open Lab, Stored lesson, and press Run with the practice (scripted double) option selected, or from a second terminal:

```powershell
curl.exe -N -X POST http://localhost:5173/api/lesson -H "content-type: application/json" -d '{\"mode\":\"scripted\",\"tasks\":8}'
```

You will see 24 trials stream (8 matched tasks times 3 conditions). The relevant-lesson condition scores higher than the others **because the scripted double is written to react to that lesson text**. That proves the lesson reaches the prompt, the prediction is recorded before the outcome, scoring uses ground truth, and invalid trials are counted. It says nothing about any real model. A real result needs a live run with an explicit call budget, and the pilot labels say so.

## Run it on Windows

1. Install Node.js 18 or newer from nodejs.org, and Git.
2. In PowerShell:

```powershell
git clone https://github.com/RonaldLenser/stebula.git
cd stebula
git checkout improve/audit-2026-10
Copy-Item .env.example .env       # optional: add ANTHROPIC_API_KEY for live mode
npm test
npm start
```

3. Open http://localhost:5173.

`npm start` keeps itself current when the branch has an upstream: it pulls new commits on start and every 2 minutes, restarts the server cleanly, and waits while a conversation or experiment is running. It never overwrites uncommitted edits. Use `npm run serve` to run without updating.

The server listens on `127.0.0.1` only, so only your computer can reach it. Settings go in `.env`:

| Variable | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | Enables live mode. Never committed, never written to the record. |
| `MODEL` | Model name. Default `claude-sonnet-5-5`. |
| `PORT` | Default 5173. |
| `HOST` | Default `127.0.0.1`. A network address makes the server reachable from the network and then `STEBULA_TOKEN` is required for every `/api` call. |
| `STEBULA_TOKEN` | Access token (sent as `Authorization: Bearer`). Required when `HOST` is not loopback. |
| `STEBULA_PUBLIC` | `1` serves replay only: no live calls, no stored conversations, no exports. |
| `LIVE_MAX_CALLS` | Cap on one live experiment's model calls. Default 120. Raise it on purpose. |
| `STEBULA_DATA` | Folder for memory, records and experiments. Default `data/`. |
| `REQUEST_TIMEOUT_MS` | Per model request timeout. Default 90000. |
| `MAX_RETRIES` | Retries for transient provider errors (429, 5xx, network). Default 2. |

## Working on it with Claude Code

Open Claude Code in this folder and describe the change. `CLAUDE.md` tells it the rules: test, commit, push. Work on a branch; the running app auto-updates from whichever branch it is on.

## Run the two-agent experiment properly

One run is an anecdote. Experiment 01 compares four conditions across seeds. The unit of analysis is the run: the two agents in a dyad talk to each other, so a dyad run counts once.

```powershell
npm run batch -- --mode mock --seeds 10                              # free, plumbing only
npm run batch -- --mode live --seeds 3 --rounds 4 --max-calls 400   # costs API calls
```

The batch prints its plan first: calls are computed from the execution plan, before retries. Four conditions, 20 seeds, 4 rounds is **2,040 calls**; one seed is 102. A live batch refuses to start without `--max-calls` that covers the estimate. The batch saves every event log in `runs/` with a manifest (mode, model, code revision, seeds, usage, excluded runs).

## Where the data lives

| Path | What | In git? |
|---|---|---|
| `data/talk-A.json`, `talk-B.json` | Each agent's memory file: self-model, personality evidence log, reading memories. Written atomically (temp file, then rename). | No |
| `data/records/YYYY-MM-DD.jsonl` | The complete record, append-only: every input, model call attempt (full prompt, raw output, model, stop reason, usage, latency, memory ids supplied), stream stage, memory and personality change, self-test, audit, digest, experiment event. | No |
| `data/exports/*.csv` | CSVs made by Export data (columns in `docs/DATA_DICTIONARY.md`) | No, commit by choice with `git add -f` |
| `data/findings.json` | The findings registry: locked predictions, versions, results. One serialized writer. | No, commit by choice with `git add -f` |
| `data/experiments/<run>/protocol.json` | The protocol and predictions, written and hashed before the first model call | No |
| `data/experiments/<run>/result.json` | The run's result, manifest (model, prompt version, code revision), usage and exclusions. Lesson runs keep every trial's prompts and raw outputs for replay. | No |
| `data/experiments/<run>/<condition>/` | The treatment memory of each isolation condition | No |
| `data/talk-*-backup-*.json`, `talk-*-damaged-*.json` | Old memory kept when you reset | No |
| `examples/observe-example.json` | A scripted example for the empty state. Labeled scripted. | Yes |

Rules the files follow:

- Nothing in the record is rewritten or deleted. A reset moves the old memory to a backup file, under the same lock as conversation, and adds a `reset` record.
- Only a genuinely missing memory or registry file means "start fresh". A damaged file is reported with a recovery option (restore a backup, or "start fresh and keep the damaged file"); it is never silently replaced.
- A failed record append is not swallowed. The record queues the line, prints the failure, and reports it in `/api/health` and in the export headers. A shutdown flushes the record.
- Experiment checkpoints are **assessments** run on a snapshot of the agent's memory. They are stored in `result.json`, never in the treatment memory, so assessing an agent does not change it.
- `docs/HUMAN_COMPARISON.md` and `docs/DATA_DICTIONARY.md` are generated from code: run `npm run docs` after changing columns or citations. The tests and CI fail if they are stale.

## Architecture

See [knowledge/03-architecture.md](knowledge/03-architecture.md). In short:

```
src/env/ruleTask.js       hidden-rule tasks, ground truth, scoring (code, not a model)
src/agents/               prompts, live and scripted agents, model transport (timeouts, retries, structured output)
src/engine/               two-agent experiment protocol, analysis per run, call estimates
src/talk/                 Talk agent: context contract, stage schemas, session, digest, personality, workspace
src/research/             lesson experiment, isolation experiment, findings registry, metrics, protocols, exports
src/lib/                  stage runner, records, jobs, access control, atomic writes
public/                   browser app, renders only from recorded state
scripts/                  launcher, batch, tests, doc and example generators
docs/                     research map, limitations, generated data dictionary and human comparison
```

CI (`.github/workflows/ci.yml`) runs `npm test` and checks the generated docs on Node 20 and 22. It has not been observed passing from this checkout; check the Actions tab after pushing.

## Read before believing anything

- [knowledge/05-experiments/exp01-hidden-rule.md](knowledge/05-experiments/exp01-hidden-rule.md): design, predictions, and what counts against the hypothesis
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md): what this cannot show
- [knowledge/04-research/](knowledge/04-research/): theories, scorecard, human vs AI development, human research reference. References are not yet verified.

## Roadmap

See [knowledge/06-roadmap.md](knowledge/06-roadmap.md). Next for the owner: live runs with an explicit budget (the lesson experiment pilot, Experiment 01 pilot, 20 Talk turns).

## License

MIT
