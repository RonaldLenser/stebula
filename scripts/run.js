// Auto-updating launcher. `npm start` runs this.
//
// 1. Pulls the latest code from GitHub (fast-forward only, never overwrites your edits).
// 2. Starts the server.
// 3. Every UPDATE_CHECK_MINUTES (default 2) checks GitHub again, and also notices commits
//    made locally (for example by Claude Code). If the code changed, it restarts the server.
// The browser sees the new version and offers a reload. Your .env and data/ are never touched.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(path.join(ROOT, '.env'));
const EVERY = process.env.UPDATE_CHECK_SECONDS ? Number(process.env.UPDATE_CHECK_SECONDS) * 1000 : Math.max(1, Number(process.env.UPDATE_CHECK_MINUTES || 2)) * 60_000;
let lastSaid = '';
const say = msg => { if (msg !== lastSaid) console.log(`[updater] ${msg}`); lastSaid = msg; }; // no repeats every tick

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return null; } };
const isRepo = () => tryGit('rev-parse', '--is-inside-work-tree') === 'true';
const head = () => tryGit('rev-parse', '--short', 'HEAD') || 'unknown';

function pull() {
  if (!isRepo()) return;
  if (tryGit('fetch', '--quiet') === null) return; // offline or no remote: keep running what we have
  const local = tryGit('rev-parse', 'HEAD'), remote = tryGit('rev-parse', '@{u}');
  if (!local || !remote || local === remote) return;
  if (git('status', '--porcelain', '--untracked-files=no')) {
    return say('You have unsaved edits to project files. Skipping auto-update so nothing gets overwritten. Commit them, or run "git checkout ." to discard.');
  }
  if (tryGit('merge-base', '--is-ancestor', 'HEAD', '@{u}') === null) {
    if (tryGit('merge-base', '--is-ancestor', '@{u}', 'HEAD') !== null) return; // local is ahead: nothing to pull
    // Both sides changed: replay local commits on top of GitHub's. Back out cleanly on conflict.
    if (tryGit('rebase', '--quiet', '@{u}') !== null) return say('Merged GitHub changes under your local commits. Push when ready.');
    tryGit('rebase', '--abort');
    return say('Your local commits conflict with GitHub. Skipping auto-update. Ask Claude Code to "resolve the git conflict".');
  }
  const log = tryGit('log', '--oneline', 'HEAD..@{u}');
  if (tryGit('merge', '--ff-only', '--quiet', '@{u}') !== null) say(`Updated:\n${log}`);
}

let child = null, running = null, stopping = false, crashes = [];
function start() {
  running = head();
  child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, STEBULA_VERSION: running } });
  child.on('exit', code => {
    child = null;
    if (stopping) return;
    crashes = [...crashes.filter(t => Date.now() - t < 60_000), Date.now()];
    if (crashes.length > 4) { say('Server keeps crashing. Stopping. Paste the error above to get it fixed.'); process.exit(1); }
    say(`Server stopped (code ${code}). Restarting.`);
    setTimeout(start, 1500);
  });
}
function restart() {
  if (!child) return start();
  say(`New version ${head()}. Restarting the server.`);
  stopping = true;
  child.once('exit', () => { stopping = false; start(); });
  child.kill();
}

pull();
if (!isRepo()) say('Not a git repository, so auto-update is off. Clone the repo from GitHub to turn it on.');
start();
setInterval(() => { pull(); if (head() !== running) restart(); }, EVERY);

const quit = () => { stopping = true; child?.kill(); process.exit(0); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
