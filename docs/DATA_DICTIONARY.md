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
| status_after | emerging, forming, or established, set by code from the evidence count and sources. |
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

## Record types in the JSONL

| type | What it holds |
|---|---|
| user_input | What the person typed or said (payload.mode: typed or spoken). |
| model_call | Every call to the model: stage, full system prompt and messages, raw output, model, stop reason, token usage, latency. Errors are recorded too. |
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
| experiment | Isolation experiment events: start, checkpoints, finish. |
| finding | Findings registry events: proposed, tested, revised. |
