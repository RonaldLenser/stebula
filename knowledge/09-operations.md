# Operations (Windows, PowerShell)

## Locations
- Project: `C:\Users\xdfin\stebula`. GitHub repo: RonaldLenser/threshold-lab, renamed to RonaldLenser/stebula by prompt 1.
- Never work from Downloads. Delete old copies there.

## First-time setup
1. Install Node.js LTS (nodejs.org), Git (git-scm.com), GitHub CLI (cli.github.com).
2. `gh auth login` as RonaldLenser.
3. `gh repo clone RonaldLenser/threshold-lab $HOME\stebula` (after the rename: `gh repo clone RonaldLenser/stebula $HOME\stebula`).
4. In the project folder: `Copy-Item .env.example .env`, then `notepad .env` and paste the key after `ANTHROPIC_API_KEY=`.
5. `npm test` should print "selftest passed".

## Daily use
- `npm start`, then open http://localhost:5173. It updates itself from GitHub every 2 minutes.
- Building: open a terminal in the project, run `claude`, describe the change. It tests, commits, and pushes.

## Install Claude Code
`irm https://claude.ai/install.ps1 | iex`, then reopen the terminal. Source: code.claude.com/docs/en/setup

## Rules
- The key goes in `.env` only. Never in `.env.example`. Never screenshot `.env`.
- Run git commands only inside the project folder. Check the prompt ends with the project name.

## Troubleshooting (things that already happened)
| Symptom | Cause | Fix |
|---|---|---|
| `git add .` hangs and lists personal files | Ran in the user home folder | Ctrl+C, `Remove-Item -Recurse -Force .git` in that folder, cd into the project |
| "cannot create a repository for RonaldLenser" | gh logged in as ronlenserdigital | `gh auth logout`, `gh auth login` with the browser signed into RonaldLenser |
| .env.example grew in size | Key pasted into the wrong file | Rename it to .env, recreate a clean .env.example, wipe local history before pushing |
| "temperature is deprecated" | Newer model | Fixed in code; leave TEMPERATURE blank |
| "mock mode only: no API key" | Wrong folder, or key line empty | Check `Test-Path .env` and that the key line has a value |
| Raw JSON in a reply | Reply cut off | Fixed: retry and salvage |
| Zip not found | Different file name | Use the newest-file command, or stop using zips: use Claude Code |
