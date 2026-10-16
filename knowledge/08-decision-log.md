# Decision log

Newest at the bottom. Every change to Stebula adds an entry: date, decision, why.

| # | Decision | Why |
|---|---|---|
| 1 | Research question narrowed to: does interaction plus reflection on measured behavior change later decisions? | Turns a philosophical question into something testable with a clear way to fail |
| 2 | First task is a hidden-rule game (Wason 2-4-6 structure) with code-scored ground truth | Growth must be a measurable change in behavior, not fancier language |
| 3 | Agents get different stances (empiricist, analogist); neither is told to falsify | A falsification strategy has to come from experience, not instructions |
| 4 | Round 1 is independent | Measures agreement that exists before interaction (shared training, similar prompts) |
| 5 | No consciousness score; evaluator checks are deterministic and show their evidence | Avoids fake precision; keeps judgments inspectable and overrulable |
| 6 | UI renders only from the event log | Every visual corresponds to a recorded state change; runs are replayable |
| 7 | Mock mode exists and is labeled as scripted | App runs without a key; mock improvement is designed in and proves nothing about the hypothesis |
| 8 | Talk agent added with persistent memory | Ron wanted a genuine conversation |
| 9 | The agent is never prompted to claim or deny consciousness | A scripted claim is a costume and would destroy credibility; a scripted denial is equally unsupported |
| 10 | Rejected naming or pitching the project as AGI | It is a structured layer over an existing model; AGI claims would be false and discredit the work |
| 11 | Consciousness-architecture upgrade: think, compete (2 of 5), speak; modeled affect; self-prediction; reflection on return; initiative; Scorecard | Implements functional markers from the leading theories, with an honest scorecard of what is and is not implemented |
| 12 | Repo lives under GitHub account RonaldLenser | Ron's personal account, not ronlenserdigital |
| 13 | After an API key nearly got committed in .env.example, history was wiped and recreated clean before the first push | Keys must never reach GitHub; .env is the only place for the key |
| 14 | Voice input and output via the browser | Ron wants to speak, not type |
| 15 | Temperature dropped automatically when a model rejects it | Newer models deprecate it |
| 16 | Replies capped around 40 to 150 words, cut-off output retried then salvaged | A long reply got cut off mid-JSON and raw code showed in the chat |
| 17 | Auto-updating launcher plus Claude Code workflow | Ron should never download updates; Claude Code edits, tests, commits, and pushes, and the app restarts itself |
| 18 | Project renamed Stebula; Talk becomes a live brain view | Ron's vision: watch its processes live. Every region maps to a real process |
| 19 | Digest mode and code-controlled personality with provenance | Watch traits form from what it reads, with receipts for where each came from |
| 20 | Divergence experiment built in from day one (two agents, different books, empty baseline) | Distinguishes traits shaped by experience from traits inherited from the base model |
| 21 | Complete records, clean exports, locked-prediction findings registry, human comparison | All findings stored as organized data; predictions cannot be fudged after the fact |
| 22 | Knowledge base added to the repo | The repo holds everything known, decided, and planned |
| 23 | Prompt 1 built: renamed to Stebula (repo is now RonaldLenser/stebula), Talk turns stream over server-sent events (heard, affect, thoughts, workspace, speaking, selfmodel, done), new brain view with emotion signals and a turn scrubber | The live view and the replay use one reducer (src/talk/brain.js), so a replayed turn is drawn from stored data by the same code that drew it live. Old stored data keeps its "threshold-talk/2" format tag so existing memory files still load |
| 24 | Found that the thinking call can come back empty (stop_reason "refusal", no text) on a live test; the app now logs the stop reason and the thinking-incomplete flag says so | The brain view is blank for turns with no scored thoughts, and it says why instead of looking broken. Cause is not fixed yet; open question for Ron |
| 25 | Prompt 2 built: Digest mode (Read to Stebula panel in Talk), code-controlled personality model, Growth tab, Compare tab, empty-memory baseline | Personality is an append-only evidence log in the memory file. Code replays it to get strength (+0.15 support, -0.2 contradiction, 0 to 1) and status, so the model can only propose evidence and the slider can replay any earlier state |
| 26 | Every proposed quote must appear verbatim in the passage or turn it came from, or the update is rejected and counted | Stops the model inventing evidence for a trait. The rejected count is shown after each reading |
| 27 | Said vs shown uses five fixed proxies (questions per turn, challenges, hedging, references to past memory, initiative wins). Only traits whose names match a proxy are measured; a flag needs at least 3 replies | Keeps the check computable and honest. Most trait names have no proxy, and the panel says so instead of guessing |
| 28 | Old episodic memories fold into summary memories after 60, keeping ids in a covers list; events and quotes are never folded | Provenance links keep resolving after summarizing |
