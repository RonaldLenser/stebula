# Build prompts

Exact prompts for Claude Code, in order (prompts 1 to 3 are the original build, prompt 4 is the audit response). Run each, let it finish and push, then run the next. Mark status here when done.

## Prompt 1: Rename and live brain view (status: done)

```text
Rename the project to Stebula and make the Talk screen a live brain view.

1. Rename: "Threshold" becomes "Stebula" everywhere: UI title, package.json name ("stebula"), README, docs, CLAUDE.md, page titles. Rename the GitHub repo with `gh repo rename stebula --yes` and confirm the remote updated.

2. Live streaming: add a server-sent events endpoint for Talk turns that emits each stage as it happens: heard (user text), affect (new signal values and causes), thoughts (all 5 candidates with scores), workspace (the 2 winners), speaking (reply text), selfmodel (diff if changed), done. Keep the existing POST working.

3. Brain view (new default Talk layout): a large SVG side-view brain split into 5 regions mapped to the real processes: self-monitor (front top), evaluation (front bottom), initiative (top), perception (back), memory (bottom), with a central Workspace. Animate from the stream: perception pulses while it listens, each region glows by its score and shows its thought on hover or tap, winners send a line into the Workspace and losers dim, and a Voice indicator pulses while the reply is spoken. Respect prefers-reduced-motion.

4. Emotion signals panel: surprise, conflict, and curiosity as live bars, with the subtitle "Modeled from the conversation. Not felt." Show which region each signal is boosting right now.

5. Keep the conversation transcript, Speak button, hands-free mode, self-model panel, self-prediction tests, and audit, arranged around the brain. It must work on desktop and phone.

6. Turn scrubber: replay the brain state of any past turn from stored data.

7. Caption under the brain: "A map of Stebula's software processes, not a scan of the model." Every glow must come from recorded state.

Follow CLAUDE.md. Add tests for the stream. Run npm test, commit, push.
```

## Prompt 2: Digest and personality growth (status: done)

```text
Add Digest mode and personality growth to Stebula.

1. Digest mode: a "Read to Stebula" panel. Input by voice (continuous mic), paste, or .txt upload, plus a title and source. Split into passages of about 200 words. Stream each passage through the live brain view (same stages as Talk). For each passage, the model returns JSON: what it noticed, which existing memories it connects to (by id), a question it now has, and candidate updates: [{kind: trait|motive|belief, name, direction: supports|contradicts, evidence_quote}]. Store each passage as an episodic memory with an id, source title, passage number, and summary.

2. Personality model, controlled by code, not the model:
   - Each trait, motive, and belief has: id, name, strength 0 to 1, status, origin event id, evidence list (event ids plus quotes), and counter-evidence list.
   - Support adds 0.15 and contradiction subtracts 0.2, capped 0 to 1. The model can never set strength directly.
   - Status: emerging (1 event), forming (2+ events), established (3+ events from at least 2 different sources). Conversation turns count as sources too.
   - Conversation turns in Talk also produce candidate updates the same way.

3. Said vs. shown: when a trait forms, map it to a measurable proxy from a fixed list the code can compute: questions asked per turn, challenges to the person, hedging language, references to past memories, initiative wins in the workspace. Show stated strength next to measured behavior, and flag traits behavior doesn't back.

4. Growth view (new tab): a live network graph of memory. Source nodes (books, conversations), event nodes, and trait/motive/belief nodes, with edges for evidence links. Nodes appear in real time during Digest, sized by strength. A timeline slider replays formation. Tapping a trait opens a provenance panel with every quote and turn that built or weakened it.

5. Divergence experiment: a Compare view showing the personality models of Agent A and Agent B side by side, plus a "fresh baseline": a copy with empty memory asked the same 5 personality questions. Highlight traits that differ by experience, and traits that appear even in the baseline (likely from the base model, not from reading).

6. Labels: Growth view caption: "What grows is Stebula's memory file. The model underneath does not change." Trait panel: "Traits are evidence-scored patterns, not proof of a personality."

7. Summarize old episodic memories when the file gets large, keeping ids and provenance intact.

Follow CLAUDE.md. Add tests: strength rules, status thresholds, provenance links, proxy measures. Run npm test, commit, push.
```

## Prompt 3: Research data layer (status: done)

```text
Add a research data layer, hypotheses, and human comparison to Stebula.

1. Complete record: append-only JSONL in data/records/YYYY-MM-DD.jsonl. Log every event: user input (typed or spoken), every model call (stage, full prompt, raw output, model, latency, token usage if available), every stream stage, every memory and personality change (before and after), self-tests, audits, and digests (source and passage). Each record has an id, timestamp, agent, session id, type, and payload. Never log the API key. Nothing is deleted; resets archive the old data.

2. Clean exports: an "Export data" button produces CSVs: conversations, thoughts (all candidates, scores, winners), signals, personality_history (trait strength over time with evidence ids), self_tests, digests. Write docs/DATA_DICTIONARY.md describing every column.

3. Findings registry (data/findings.json, new Findings tab):
   - A "Generate hypotheses" button: the model reads aggregated stats and proposes up to 3 testable hypotheses. Each needs a statement, the record ids that suggested it, a prediction locked BEFORE testing, the metric that tests it, and the result that would refute it.
   - Code tests any hypothesis whose metric is computable. Others are marked "needs experiment" with a suggested design.
   - Statuses: proposed, testing, supported, refuted, inconclusive. Results store the numbers, sample size, and date. A prediction can never be edited after data arrives; changes create a new version.

4. Human comparison: docs/HUMAN_COMPARISON.md plus a "Compare to humans" panel on each finding, covering the matched human research area (self-recognition, theory of mind, inner speech, sensitive periods, social deprivation, introspection accuracy, personality heritability), what humans show, what Stebula shows, and the key difference. Mark every citation "verify" until it's checked.

5. Isolation experiment presets: run agents as isolated (reading only), social (conversation only), mixed, and baseline (nothing). Give the same personality questions and self-prediction tests at fixed checkpoints. Results feed the Findings registry automatically.

6. Add a README section explaining the data layout. Keep records out of git; findings and exports can be committed by choice.

Follow CLAUDE.md. Add tests for logging completeness, CSV exports, the hypothesis lifecycle (no edits after data), and the experiment presets. Run npm test, commit, push.
```

## Prompt 4: Audit response (status: done)

A condensed version of the audit task. The audit examined commit 078592269f34f80847122b9e8d37883be290d357. Some findings may already be fixed: verify each before changing it.

```text
You are the lead AI engineer and product designer for Stebula. Execute: investigate, modify, test, finish. Do not stop at a plan.

1. Intended product. Stebula is a visual laboratory for how an AI's memory, self-description, attention mechanism and decisions interact. The visitor should be able to observe a conversation or recorded experiment, see which information the agent received, inspect its generated proposals and the selection process, understand what changed in stored memory, test whether that change affects a later decision, and trace a result to its evidence. Keep generated proposals, external memory, observed behavior and inaccessible model internals distinct. Never imply a process view shows neural activity or establishes experience. Keep the rule against prompting the agent to assert or deny consciousness. No consciousness percentage or progress meter.

2. Safe baseline. Read CLAUDE.md, AGENTS.md, the knowledge index, principles, architecture and roadmap. Preserve existing user changes. Work on a dedicated branch, commit verified milestones, push the branch, and do not merge into the default branch (the app auto-deploys from it). Run the tests first and record the starting revision. Stay dependency-free. Keep a progress checklist; if something is blocked by credentials or services, finish the rest and name the exact blocker.

3. Memory delivery first. Stored reading episodes and personality evidence were not reaching the model (memoryBlock and plainSystem omitted them). Build an explicit, bounded context contract shared by all stages: retrieve relevant reading memories where the protocol permits, keep source and memory ids, record what was actually supplied to each call, make memory-enabled and disabled conditions explicit, keep evaluation-only trait annotations out of agent instructions unless a protocol tests them, never dump the whole archive, keep summaries and compaction. Verify with a unique learned fact: the enabled probe receives it, the disabled control does not, and the recorded requests show the difference.

4. Explicit, recoverable stage failures. THINK could fail completely while SPEAK looked fine. Validate THINK (five unique recognized roles, valid text, finite relevance in range), SPEAK, reflection, baseline answers and self-predictions. Classify truncation, refusal, malformed output, transport failure and schema failure from provider stop reasons. Use provider structured output where compatible, after verifying the current official documentation. Bounded retries with recorded attempts, raw outputs preserved. Never count a failed mechanism as a successful trial. A fallback turn is labeled degraded with explicit exclusion rules. Show failures near the interaction with a recovery action. Add timeouts, bounded backoff and cancellation propagation; cancelling stops further model calls and records the final state. Do not invent the cause of the earlier failure; inspect real records.

5. Protect state and the record. Validate agent ids at route and storage; contain paths; replace memory and registry atomically; serialize reset, conversation and other mutations per agent; one transactional registry writer including experiment completion; treat corrupted files explicitly (only a missing file means fresh); make recorder failures visible; flush on shutdown; defer automatic restarts while work is active; pin the code revision in each manifest. Serve on loopback by default, keep paid endpoints away from unauthenticated users, separate public replay from live operations. Preserve data and backups; commit no keys, private conversations or raw memory files.

6. Evaluation and experiment design. Unreadable self-test answers are invalid, excluded from denominators, and counted. Checkpoint self-tests run on immutable snapshots and are stored apart from treatment memory. Result ingestion is idempotent. Separate exploratory findings from confirmation on held-out or later data. Use descriptive pilot labels until a protocol has an uncertainty-aware rule. Record predictions and protocol versions before collection, including API launches. Do not treat dyad members as independent replications. Collect first hypotheses from the same observation snapshot before either agent's first probe. Make live and mock information flow identical (the decision gets the synthesis) and test parity. Preserve Unicode in quote validation and reject empty normalized quotes; distinguish quote presence from support for a trait; reconsider "established" when counterevidence accumulates. Correct call estimates from the execution plan (four conditions, 20 seeds, 4 rounds is 2,040 calls before retries). Record model, prompt version, code revision, seed, condition, memory snapshot, exclusions and usage. Keep the machinery understandable.

7. One flagship experiment: does a stored lesson change the agent's next decision on a new problem? Shared start, matched tasks, a relevant lesson versus none versus an irrelevant or shuffled lesson of similar length. Record the prediction before the outcome, keep the answer hidden until scoring, report performance, behavior, invalid counts, calibration, latency, tokens and uncertainty, and support trial replay. Verify the mechanism with deterministic doubles; live runs only within an explicit budget; never present mock improvement as validation.

8. Interface. Replace six destinations with Observe (conversation about two thirds, one contextual inspector, visible composer, compact stage indicator, a short "what changed" after each turn, message selection updates the inspector, raw prompts and advanced controls behind disclosure, unmistakable replay position, distinct missing, zero and failed states), Experiments (research questions, treatment/control, execution, results, Compare), and Research (findings, methods, sources, limitations, scorecard). Growth becomes change history in Observe. Mobile prioritizes the conversation with an expandable inspector and no competing scroll regions. Useful empty states; clearly labeled scripted examples; never fabricate metrics.

9. Visual system and language. Calm research instrument: no graph-paper background, fewer borders and cards, consolidated CSS, consistent spacing and type, restrained serif for branding with readable sans for conversation, one accent color plus status colors, two intentional themes, visible focus, reduced motion, labeled form controls, checked contrast. The brain silhouette may stay as an optional conceptual view; the primary visualization explains recorded information flow; no simulated firing. Wording: "Process view", "Recorded proposals", "Current self-description", "Can it predict its next answer?", "Conversation signals", "What changed", "Process trace incomplete". Replies are concise and conversational; a greeting does not trigger an essay; no repeated persona introductions or speeches about consciousness; no invented feelings or access to hidden processing.

10. Verify and finish. Focused regression tests for each demonstrated failure; run the suite, targeted tests and HTTP checks; exercise the real UI in a browser (desktop and narrow, keyboard, empty, loading, success, degraded and failed states, memory controls, replay, cancellation, experiment comparison) and fix layout problems, or say browser verification was unavailable. Add GitHub Actions. Update README, architecture, limitations, decision log, roadmap and generated docs to match behavior. Explain the project in one paragraph and document one reproducible demonstration. Report what changed, which audit findings were confirmed, already fixed or not reproducible, tests and browser checks actually performed, remaining limits, branch and commit ids, and exact Windows steps. Do not claim deployment, live-model verification or CI success unless observed.
```

## Prompt 5: Agent-centered redesign (status: done)

Goal: make the agent the center of the experience. Keep the depth of the process and make the visible experience simple, labeled and understandable.

1. Read the repository instructions and trace the real process (input, memory context, signals, five proposals, selection, reply, saved changes) before changing the interface.
2. Three destinations: Agent (talk and observe), History (revisit recorded moments), Lab (tasks, experiments, findings, in ordinary language).
3. Agent screen in three layers: a current-state strip (who, doing what, responding to what, latest), a process map of the selected turn, and one contextual inspector.
4. Honest motives, signals and thoughts: name sources, never turn a score into a feeling, never claim influence from "supplied".
5. A complete interaction can be followed and stepped through at recorded-stage granularity. Selecting an older message shows its own records.
6. Failures stay visible: nothing recorded, no relevant result, still processing, stage failed, stage completed.
7. Plain names for Lab controls, with the technical name in the details and five fixed questions per test.
8. Calm visual system, keyboard and reduced-motion support, desktop and mobile.
9. Tests for the event mapping, history and missing or failed stages (`scripts/test-process.js`) and browser checks (`npm run ui-check`).

## Prompt 6: One reliable, readable interaction (status: done)

1. Trace the proposal-generation failure through request, provider response, parsing, validation and event recording. Classify refusal, unreadable output, empty, truncated and transport failures separately. Never bypass a refusal or fabricate proposals.
2. Replace the three-column Agent screen with two areas: the conversation and a compact overview. Details open in a drawer that is closed by default.
3. Overview answers three questions from recorded state: what went into this response, what did it consider, what changed afterward. One notice for an incomplete interaction.
4. Show the reply once. Move raw scores, timestamps, attempts and the connection diagram behind explicit actions.
5. Tests for classification, a reply after a failed proposal step, saved, unchanged and failed-to-save outcomes, older turns, and switching agents (`scripts/test-overview.js`), plus browser checks.

