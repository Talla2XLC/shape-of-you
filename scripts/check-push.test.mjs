import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertClean, assertUpdates, checks, runChecks } from './check-push.mjs';
const head = 'a'.repeat(40), old = 'b'.repeat(40);
test('required gates match existing CI commands and include the full test suite', () => {
  const workflow = readFileSync(new URL('../.github/workflows/_quality.yml', import.meta.url), 'utf8');
  for (const command of checks) assert.ok(workflow.includes(`run: ${command}\n`));
  assert.ok(checks.includes('pnpm test'));
  assert.ok(!checks.some(command => command.includes('test:unit')));
});
test('missing Docker fails before any test command, without unit-only fallback', () => {
  const calls = [];
  assert.throws(() => runChecks(command => { calls.push(command); return 1; }), /Docker is required/);
  assert.equal(calls.length, 1);
});
test('test failure blocks subsequent validation and never turns into success', () => {
  const calls = [];
  assert.throws(() => runChecks(command => { calls.push(command); return command === 'pnpm test' ? 1 : 0; }), /Check failed: pnpm test/);
  assert.ok(!calls.includes('node scripts/validate-docs.mjs'));
});
test('success runs every mandatory gate', () => {
  const calls = []; runChecks(command => { calls.push(command); return 0; });
  assert.deepEqual(calls.slice(1), checks);
});
test('another pushed commit cannot borrow HEAD results; deletions need no tests', () => {
  assert.equal(assertUpdates(`refs/heads/main ${head} refs/heads/main ${old}`, head), true);
  assert.throws(() => assertUpdates(`refs/heads/other ${old} refs/heads/other ${head}`, head), /another commit/);
  assert.equal(assertUpdates(`(delete) ${'0'.repeat(40)} refs/heads/old ${old}`, head), false);
  assert.equal(assertUpdates('', head), false);
});
test('dirty worktree and HEAD changes both block delivery', () => {
  assert.throws(() => assertClean(' M apps/api/src/app.ts', head, head), /uncommitted worktree/);
  assert.throws(() => assertClean('?? new-file.ts', head, head), /uncommitted worktree/);
  assert.throws(() => assertClean('', old, head), /HEAD changed/);
  assert.doesNotThrow(() => assertClean('', head, head));
});

test('hook installation refuses an existing default hook even from another working directory', async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'soy-push-installer-'));
  const repo = join(directory, 'repo'); mkdirSync(repo);
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    assert.equal(git('init', '--quiet').status, 0);
    mkdirSync(join(repo, 'scripts')); mkdirSync(join(repo, '.githooks'));
    copyFileSync(new URL('./install-git-hooks.mjs', import.meta.url), join(repo, 'scripts/install-git-hooks.mjs'));
    copyFileSync(new URL('../.githooks/pre-push', import.meta.url), join(repo, '.githooks/pre-push'));
    writeFileSync(join(repo, '.git/hooks/pre-push'), '#!/bin/sh\nexit 0\n');
    const result = spawnSync(process.execPath, [join(repo, 'scripts/install-git-hooks.mjs')], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Existing pre-push hook was not overwritten/);
    assert.equal(git('config', '--local', '--get', 'core.hooksPath').status, 1);
    assert.equal(readFileSync(join(repo, '.git/hooks/pre-push'), 'utf8'), '#!/bin/sh\nexit 0\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
