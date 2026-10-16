# Build prompts

Exact prompts for Claude Code, in order. Run each, let it finish and push, then run the next. Mark status here when done.

## Prompt 1: Rename and live brain view (status: not started)

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

## Prompt 2: Digest and personality growth (status: not started)

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

## Prompt 3: Research data layer (status: not started)

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
