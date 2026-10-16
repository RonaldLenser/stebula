# Working on Stebula (formerly Threshold)

Read this before changing anything. Then read knowledge/README.md and knowledge/02-core-principles.md.

## Knowledge base rules
- knowledge/ is the single source of truth for vision, principles, architecture, research, experiments, roadmap, build prompts, and decisions.
- After every change: add an entry to knowledge/08-decision-log.md, update status in knowledge/06-roadmap.md, and mark build prompts done in knowledge/07-build-prompts.md.
- If Ron says "run prompt N", run that prompt from knowledge/07-build-prompts.md exactly.
- New research claims go in knowledge/04-research/ marked "verify" until checked against the source.

## The owner
Ron runs this project. He does not hand-code. Explain changes in plain words, give him only the steps he must do himself, and keep replies short. He uses Windows and PowerShell.

## How changes ship
- `npm start` runs `scripts/run.js`, which auto-updates and restarts the server when commits land (local or on GitHub). Ron should never have to download files.
- After every change: run `npm test`, then commit with a clear message, then `git push`. The running app picks it up within 2 minutes and the page offers a reload.
- Never commit `.env`, `data/`, or `runs/*.json`. Never print the API key.

## Stack
- Node 18+, no dependencies, no build step. Vanilla JS ES modules in `public/` and `src/`.
- `server.js` serves the app and proxies model calls. `src/talk/` is the Talk agent. `src/engine/` is the experiment runner.
- Model calls go through `src/agents/transport-node.js`. Do not send `temperature` unless `.env` sets it.

## Non-negotiable research rules
- Never prompt an agent to claim consciousness, and never prompt it to deny it. The honesty instruction in `src/talk/prompts.js` stays.
- Self-reports are logged as data, not evidence. Do not add a "consciousness score".
- Every visual must come from recorded state. Label anything decorative.
- Keep `docs/LIMITATIONS.md` and the Scorecard honest when adding features. If a new feature changes an indicator's status, update `src/talk/indicators.js` and say why.

## Style
- No em dashes or en dashes anywhere: code comments, UI text, docs.
- Plain, specific UI copy. No hype.
- Complete, working changes. Run `npm test` before every commit; add a test when adding a mechanism.
