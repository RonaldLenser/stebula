# Data dictionary

Generated from `src/research/exports.js`. Do not edit by hand; a test fails if this file drifts from the code.

The exports come from the complete record in `data/records/YYYY-MM-DD.jsonl` (one JSON object per line: `id`, `at`, `agent`, `session`, `type`, `payload`). The CSVs are a convenience view. The JSONL is the source.

Text cells that start with `=`, `+`, `-`, or `@` get a leading apostrophe so spreadsheets keep them as text. Empty means not applicable.

## conversations.csv

One row per Talk turn.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| turn | Turn number for this agent, counted from its last reset. |
| input_mode | typed or spoken. Spoken means it came through browser speech recognition. |
| user_text | What the person said. |
| reply | What the agent said. |
| parse_error | 1 if the app could not read the answer as JSON and used recovered text. |
| self_model_changed | 1 if the stored self-model changed this turn. |
| change_note | The agent's own note on what changed. A self-report, not evidence. |
| claims | Number of claims the agent tagged this turn. |
| experiential_claims | How many of those were tagged experiential (claims about inner states). Logged as data, not evidence. |
| flags | Names of automatic checks that fired, separated by semicolons. |
| status | ok, or degraded when a stage failed and the turn continued without it (for example the thinking step was refused). |
| excluded_from_analysis | 1 if the turn is excluded from behavior measures and personality evidence. Every degraded turn is. |
| memory_mode | on or off. Off means stored memory was not delivered to the model this turn. |
| memory_ids_supplied | Ids of reading memories actually put in the model requests this turn, separated by semicolons. Empty means none were supplied. |

## thoughts.csv

One row per candidate thought, for Talk turns and Digest passages. Five rows per turn when the thinking step worked.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| context | talk or digest. |
| turn_or_passage | Turn number (talk) or passage number (digest). |
| source | Digest only: title of the text being read. |
| module | Which process proposed it: perception, memory, self-monitor, evaluation, or initiative. |
| text | The thought. |
| relevance | The agent's own 0 to 1 rating of the thought. |
| affect_boost | Added by code from a modeled signal (surprise, conflict, or curiosity). Zero for modules with no signal. |
| driver | Which modeled signal fed the boost, if any. |
| novelty_penalty | Subtracted by code when the thought repeats what won last turn. Zero or negative. |
| score | relevance + affect_boost + novelty_penalty. The two highest scores win. |
| won | 1 if the thought entered the workspace and was visible when the agent answered. |
| thinking_status | ok, or failed when the thinking step produced no usable set of five thoughts. |
| failure_kind | Why the thinking step failed: refusal, truncation, malformed, schema, empty, transport, or timeout. Empty when it worked. |

## signals.csv

One row per Talk turn or Digest passage: the three modeled signals before and after. Modeled arithmetic, not feelings.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| context | talk or digest. |
| turn_or_passage | Turn number (talk) or passage number (digest). |
| surprise_before | Modeled surprise before this event, 0 to 1. Rises when contradicted or when a self-prediction failed. |
| conflict_before | Modeled conflict before this event, 0 to 1. Rises when the person challenges the agent. |
| curiosity_before | Modeled curiosity before this event, 0 to 1. Rises when the input is new relative to earlier input. |
| surprise | Modeled surprise after. |
| conflict | Modeled conflict after. |
| curiosity | Modeled curiosity after. |
| causes | Plain-language reasons the code recorded, separated by semicolons. |

## personality_history.csv

One row per accepted piece of evidence. Strength is computed by code; the model only proposed the quote.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| origin | talk or digest. |
| event_id | Id of the evidence event (a passage or a conversation turn) inside the agent's memory file. |
| source | Where it came from: a title, or "Conversation <date>". |
| step | Position of this entry in the agent's evidence log. |
| item_id | Stable id of the trait, motive, or belief (kind:name). |
| name | The trait, motive, or belief. |
| kind | trait, motive, or belief. |
| direction | supports (adds 0.15) or contradicts (subtracts 0.2). |
| strength_before | Strength before this entry, 0 to 1. |
| strength_after | Strength after this entry, 0 to 1. |
| status_after | emerging, forming, established, or contested, set by code from the evidence count, sources and counterevidence. |
| evidence_quote | Words copied from the source text. Code verified they appear there. |

## self_tests.csv

One row per self-prediction test.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| turn | Number of Talk turns the agent had had when it ran. |
| statement | The statement the agent predicted about. |
| predicted | What it predicted a fresh copy of itself would say: agree, disagree, or unsure. |
| confidence | Its stated confidence in the prediction, 0 to 1. |
| answer_1 | First fresh copy's stance. |
| answer_2 | Second fresh copy's stance. |
| stable | 1 if the two fresh copies agreed with each other. |
| match | yes (both answers matched), partial (one), no (neither), or invalid. Scored by code. |
| invalid | 1 if the prediction or an answer was unreadable. Invalid tests are not wrong answers: they are left out of accuracy. |
| invalid_reason | What was unreadable, when invalid. |
| assessment | 1 if the test was an experiment checkpoint run on a snapshot of memory, so it did not change the agent. |
| memory_mode | on or off: whether stored memory was delivered to the model for this test. |

## digests.csv

One row per passage read in Digest mode.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| title | Title of the text. |
| source | Where the text came from, as typed by the person. |
| passage | Passage number within this reading. |
| total_passages | How many passages the reading had. |
| passage_words | Length of the passage in words. |
| memory_id | Id of the episodic memory created for this passage. |
| summary | What the agent said it noticed. |
| question | The question it said it now had. |
| connects_to | Earlier memory ids it linked to, separated by semicolons. |
| updates_rejected | Proposed personality updates code rejected because the quote was not in the passage. |

## model_calls.csv

One row per model call attempt (retries are separate rows). Metadata only: prompts and outputs stay in the JSONL.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| stage | Which step made the call, for example think, speak, selftest-predict. A retry has a -retry suffix. |
| attempt | Attempt number within the stage, starting at 1. |
| model | Model name the provider reported. |
| stop_reason | Why the model stopped: end_turn, max_tokens, refusal, and so on. Empty if the call errored. |
| latency_ms | Wall-clock time of the call in milliseconds. |
| input_tokens | Input tokens the provider billed, when reported. |
| output_tokens | Output tokens the provider billed, when reported. |
| context_mode | on or off: whether stored memory was delivered in this request. Empty for calls with no memory context. |
| memory_ids_supplied | Ids of reading memories included in this request, separated by semicolons. |
| error_kind | transport, timeout, or another kind if the call itself failed. Empty when it returned. |

## experiments.csv

Experiment events and lesson-experiment trial rows: run start, finish, cancel, and for each lesson trial the prediction, the outcome, and the trial result.

| Column | Meaning |
|---|---|
| record_id | Id of the record this row came from. Look it up in data/records/ for the full original. |
| at | ISO 8601 time the event happened (UTC). |
| agent | Which agent: A (empiricist) or B (analogist). |
| session | Id of the server run that produced the record. Changes each time the app restarts. |
| record_type | experiment, lesson_prediction, lesson_outcome, or lesson_trial. |
| event | For experiment rows: start, finish, cancelled, failed, stopped-budget. Empty for lesson rows. |
| run_id | Experiment run id. Matches the folder in data/experiments/ (isolation runs only appear in the record under the experiment payload, so this can be empty for their inner rows). |
| condition | Condition name when the row belongs to one. |
| task_index | Lesson experiment: index of the matched task. The same index is used in every condition. |
| valid | 1 if the lesson trial completed both stages, 0 if it was invalid and excluded. Empty for other rows. |
| accuracy | Lesson trial: share of the 8 new items classified correctly, scored by code against ground truth. |
| discriminating_accuracy | Lesson trial: accuracy on the hardest items only (fit the true rule but not the narrow decoy). |
| detail | Short facts: for a prediction the probe, predicted result and confidence; for an outcome whether it was accepted and whether the agent was surprised. |

## Record types in the JSONL

| type | What it holds |
|---|---|
| user_input | What the person typed or said (payload.mode: typed or spoken). |
| model_call | Every call attempt to the model: stage, attempt, full system prompt and messages, raw output, model, stop reason, token usage, latency, and the memory context actually supplied (mode and ids). Errors are recorded too. |
| stage | Every stream stage as it was sent to the browser: heard, affect, thoughts, workspace, speaking, selfmodel, personality, done (and passage and digested for Digest). |
| turn | The finished Talk turn: reply, claims, flags, modeled signals before and after, all candidate thoughts with scores. |
| memory_change | A change to stored memory with before and after: self-model revisions and episode folding. |
| personality_change | Accepted evidence and the strength of each affected item before and after, plus rejected proposals with the reason. |
| digest | One passage read in Digest mode, with its memory, thoughts, and signals. |
| personality_questions | The five personality questions, answers, and traits derived from them (baseline and experiment checkpoints). |
| self_test | A self-prediction test: the prediction, both fresh answers, and the score. |
| audit | An audit of recent turns by a separate model call. |
| reflection | A reflection run when the person returned or pressed Reflect now. |
| reset | A memory reset. Names the backup file that kept the old memory. |
| experiment | Experiment events: start (with the locked protocol hash), finish, cancelled, failed, stopped-budget. |
| lesson_prediction | Lesson experiment: the agent's chosen probe, predicted result and confidence, recorded before the outcome exists. |
| lesson_outcome | Lesson experiment: the ground-truth result of the probe, computed by code after the prediction. |
| lesson_trial | Lesson experiment: a completed trial with its score. |
| turn_failed | A Talk turn that failed (stage, failure kind, attempts). Nothing was saved to memory. |
| turn_cancelled | A Talk turn that was cancelled. Nothing was saved to memory. |
| finding | Findings registry events: proposed, tested, revised. |
