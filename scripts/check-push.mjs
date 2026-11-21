import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Required application checks; `pnpm test` includes every service's integration suite. */
export const checks = ['pnpm install --frozen-lockfile', 'node --test scripts/check-push.test.mjs', 'pnpm lint', 'pnpm typecheck', 'pnpm build', 'pnpm test', 'node scripts/validate-docs.mjs'];
const root = fileURLToPath(new URL('../', import.meta.url));
const execute = (command) => spawnSync(command, { cwd: root, shell: true, stdio: 'inherit' }).status ?? 1;
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot verify Git state');
  return result.stdout.trim();
};

/** Runs all mandatory checks in order; a failed prerequisite or check stops immediately. */
export function runChecks(run = execute) {
  if (run('docker info > /dev/null') !== 0) throw new Error('Docker is required for integration tests; push is blocked. Start Docker and retry.');
  for (const command of checks) {
    process.stdout.write(`\nChecking: ${command}\n`);
    if (run(command) !== 0) throw new Error(`Check failed: ${command}. Push is blocked.`);
  }
}

/** Accepts only current-HEAD updates; other refs cannot borrow this worktree's test results. */
export function assertUpdates(input, head) {
  const updates = input.trim().split('\n').filter(Boolean);
  if (!updates.length) return false;
  for (const line of updates) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error('Invalid pre-push ref update');
    const [, sha] = fields;
    if (/^0+$/.test(sha)) continue;
    if (sha !== head) throw new Error('Push one checked-out HEAD at a time; another commit is not verified.');
  }
  return updates.some(line => !/^0+$/.test(line.trim().split(/\s+/)[1]));
}

/** Validates the exact clean worktree before and after tests, including concurrent edits. */
export function assertClean(status, currentHead, expectedHead) {
  if (status) throw new Error('Commit or otherwise resolve your working changes first; an uncommitted worktree cannot verify the pushed commit. Nothing was stashed or changed.');
  if (currentHead !== expectedHead) throw new Error('HEAD changed during verification; push is blocked.');
}

function main() {
  if (process.argv.includes('--hook')) {
    const head = git('rev-parse', 'HEAD');
    if (!assertUpdates(readFileSync(0, 'utf8'), head)) return;
    const clean = () => assertClean(git('status', '--porcelain', '--untracked-files=all'), git('rev-parse', 'HEAD'), head);
    clean(); runChecks(); clean();
  } else runChecks();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
