// The exact code a result came from. A dirty working tree is reported, because uncommitted code is not reproducible.
import { execFileSync } from 'node:child_process';

export function codeRevision(root) {
  const git = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  const commit = process.env.STEBULA_REVISION || git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain', '--untracked-files=no');
  return { commit: commit || 'unknown', dirty: Boolean(dirty), branch: git('rev-parse', '--abbrev-ref', 'HEAD') };
}
