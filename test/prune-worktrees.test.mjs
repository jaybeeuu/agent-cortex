// Integration tests for skills/workflow/ralph/scripts/prune-worktrees.mjs.
//
// The script decides, from bead state alone, whether a ralph worktree may go —
// then tears it down with real git. Each case therefore runs a real repository
// with a real origin and a real worktree; only `bd` is injected, because the
// case under test is what the script does with a given bead state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createTempRoot } from './helpers/temp-root.mjs';
import { pruneWorktrees, runCli } from '../skills/workflow/ralph/scripts/prune-worktrees.mjs';

const tempRoot = createTempRoot('prune-worktrees-');
const execFileAsync = promisify(execFile);

/** Run a git command in `cwd` and return its stdout.
 * @param {string} cwd @param {string[]} args @returns {Promise<string>} */
async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
  return stdout;
}

/** Run a git command and report the outcome instead of throwing, so a case can
 * pass the same `{ ok, stdout } | { ok: false, stderr }` shape the script expects.
 * @param {string} cwd @param {string[]} args
 * @returns {Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} */
async function gitResult(cwd, args) {
  try {
    return { ok: true, stdout: await git(cwd, args) };
  } catch (error) {
    const stderr = /** @type {{ stderr?: unknown, message?: unknown }} */ (error).stderr;
    return { ok: false, stderr: typeof stderr === 'string' ? stderr : String(error) };
  }
}

/**
 * Land the worktree's branch on the base branch the way a squash merge does,
 * then delete the remote branch and prune the stale remote-tracking ref. This is
 * the shape every landed ralph branch has after a merge with branch deletion:
 * the work is in the base branch and the local branch has no upstream left.
 * @param {{ repoRoot: string, branch: string }} options
 */
async function squashMergeOntoBase({ repoRoot, branch }) {
  await git(repoRoot, ['merge', '--squash', '--quiet', branch]);
  await git(repoRoot, ['commit', '-m', 'landed']);
  await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  await git(repoRoot, ['push', '--quiet', 'origin', '--delete', branch]);
  await git(repoRoot, ['fetch', '--quiet', '--prune', 'origin']);
}

/**
 * A repository with an origin and one ralph worktree on a feature branch. The
 * bead id is the worktree's directory name, and `bead` is the status the
 * injected `bd` reports for it — or `'missing'` for no bead at all. `push: false`
 * leaves the branch unpublished, so it has no upstream and no remote branch.
 * @param {{ beadId?: string, bead: string, push?: boolean }} options
 */
async function createRepo({ beadId = 'proj-1', bead, push = true }) {
  const workspace = await tempRoot.createWorkspace();
  const origin = join(workspace, 'origin.git');
  await git(workspace, ['init', '--bare', '--quiet', origin]);

  const repoRoot = join(workspace, 'repo');
  await git(workspace, ['init', '--quiet', repoRoot]);
  await git(repoRoot, ['config', 'user.email', 'test@example.com']);
  await git(repoRoot, ['config', 'user.name', 'Test']);
  // A developer's global config may enable commit signing; the fixture must
  // not depend on a secret key being present.
  await git(repoRoot, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(repoRoot, 'README.md'), 'base\n');
  await git(repoRoot, ['add', '-A']);
  await git(repoRoot, ['commit', '-m', 'base']);
  await git(repoRoot, ['remote', 'add', 'origin', origin]);
  await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  // The origin's own HEAD decides the default branch, so the script derives the
  // base from `origin/HEAD` the way it does on any machine.
  await git(origin, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await git(repoRoot, ['remote', 'set-head', 'origin', '--auto']);

  const branch = `feature/${beadId}`;
  await mkdir(join(repoRoot, '.agent-cortex', 'worktrees'), { recursive: true });
  const worktree = join(repoRoot, '.agent-cortex', 'worktrees', beadId);
  await git(repoRoot, ['worktree', 'add', '--quiet', '-b', branch, worktree]);
  if (push) await git(worktree, ['push', '--quiet', '-u', 'origin', branch]);

  /** @type {(args: string[]) => Promise<string>} */
  const exec = async (args) => {
    const [, id] = args;
    if (bead === 'missing' || id !== beadId) throw new Error(`Issue ${id} not found`);
    return JSON.stringify([{ id, status: bead }]);
  };

  return { repoRoot, origin, worktree, branch, exec };
}

describe('pruneWorktrees', () => {
  it('removes a closed-bead worktree and both of its branches', async () => {
    const { repoRoot, origin, worktree, branch, exec } = await createRepo({ bead: 'closed' });

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(
      result.entries.map(({ classification, outcome }) => ({ classification, outcome })),
      [{ classification: 'closed-bead', outcome: 'removed' }],
    );
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '');
    assert.equal(
      (await git(origin, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])).trim(),
      '',
    );
  });

  it('leaves an open-bead worktree in place and reports it', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'in_progress' });

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(
      result.entries.map(({ classification, beadStatus, outcome }) => ({ classification, beadStatus, outcome })),
      [{ classification: 'open-bead', beadStatus: 'in_progress', outcome: 'kept' }],
    );
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
    assert.notEqual(result.exitCode, 0, 'an uncovered orphan fails the run so the chore can retry');
  });

  it('reports a worktree whose bead is missing as an orphan', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'missing' });

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(
      result.entries.map(({ classification, beadStatus, outcome }) => ({ classification, beadStatus, outcome })),
      [{ classification: 'orphan', beadStatus: 'missing', outcome: 'kept' }],
    );
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
    assert.notEqual(result.exitCode, 0);
  });

  it('refuses a closed-bead worktree with a dirty tree and gives the reason', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'left-behind.txt'), 'uncommitted\n');

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(
      result.entries.map(({ classification, outcome }) => ({ classification, outcome })),
      [{ classification: 'closed-bead', outcome: 'refused' }],
    );
    assert.match(result.entries[0].reasons.join(' '), /dirty: 1 uncommitted path/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });

  it('refuses a closed-bead worktree whose branch has commits the remote does not', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'unpushed.txt'), 'work in progress\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'unpushed work']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /1 commit\(s\) not pushed to origin\/feature\/proj-1/);
    await stat(worktree);
  });

  it('refuses a locked worktree and gives the lock reason', async () => {
    const { repoRoot, worktree, exec } = await createRepo({ bead: 'closed' });
    await git(repoRoot, ['worktree', 'lock', '--reason', 'worker still running', worktree]);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /locked: worker still running/);
    await stat(worktree);
  });

  it('removes an orphan worktree only when --remove-orphans is passed', async () => {
    const { repoRoot, origin, worktree, branch, exec } = await createRepo({ bead: 'missing' });

    const result = await pruneWorktrees({ repoRoot, exec, removeOrphans: true });

    assert.deepEqual(
      result.entries.map(({ classification, outcome }) => ({ classification, outcome })),
      [{ classification: 'orphan', outcome: 'removed' }],
    );
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree));
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '');
    assert.equal(
      (await git(origin, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])).trim(),
      '',
    );
  });

  it("keeps an orphan's unpublished branch even when --remove-orphans is passed", async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'missing', push: false });
    await writeFile(join(worktree, 'never-pushed.txt'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);

    const result = await pruneWorktrees({ repoRoot, exec, removeOrphans: true });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(
      result.entries[0].reasons.join(' '),
      /branch feature\/proj-1 has no remote-tracking branch and its bead is not closed/,
    );
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });

  it('treats a remote branch that is already gone as removed, not failed', async () => {
    const { repoRoot, origin, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await git(origin, ['branch', '-D', branch]);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(
      result.entries.map(({ classification, outcome, reasons }) => ({ classification, outcome, reasons })),
      [{ classification: 'closed-bead', outcome: 'removed', reasons: [] }],
    );
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree));
  });

  it('removes a landed closed-bead worktree whose remote branch is gone', async () => {
    const { repoRoot, origin, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'landed.txt'), 'the change\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'the change']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    await squashMergeOntoBase({ repoRoot, branch });
    await assert.rejects(
      git(worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
      'the fixture branch has no upstream left',
    );

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['removed']);
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '', 'the local branch is deleted');
    assert.equal(
      (await git(origin, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])).trim(),
      '',
      'no remote branch survives the merge',
    );
  });

  it('keeps a closed-bead worktree whose content the base branch does not have', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed', push: false });
    await writeFile(join(worktree, 'never-pushed.txt'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);
    await assert.rejects(
      git(worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
      'the fixture branch was never pushed',
    );

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    const reasons = result.entries[0].reasons.join(' ');
    assert.match(reasons, /branch feature\/proj-1 has no remote-tracking branch/);
    assert.match(reasons, /holds 1 path\(s\) that origin\/main does not/);
    assert.match(reasons, /may never have been pushed/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });

  it('keeps a closed-bead worktree when the base branch cannot be resolved', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'landed.txt'), 'the change\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'the change']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    await squashMergeOntoBase({ repoRoot, branch });

    // git cannot name the remote's default branch. The script must not fall back
    // to a hardcoded branch, so nothing proves the work landed.
    /** @type {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} */
    const gitWithoutDefaultBranch = async (cwd, args) =>
      args[0] === 'symbolic-ref'
        ? { ok: false, stderr: 'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref' }
        : gitResult(cwd, args);

    const result = await pruneWorktrees({ repoRoot, exec, git: gitWithoutDefaultBranch });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /the base branch cannot be resolved/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });

  it('compares content against the ref given as base, not the remote default', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    const forkPoint = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(worktree, 'landed.txt'), 'the change\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'the change']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    await squashMergeOntoBase({ repoRoot, branch });

    const result = await pruneWorktrees({ repoRoot, exec, base: forkPoint });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(
      result.entries[0].reasons.join(' '),
      new RegExp(`holds 1 path\\(s\\) that ${forkPoint} does not`),
    );
    await stat(worktree);
  });

  it('rejects --base with no ref', async () => {
    const { repoRoot, exec } = await createRepo({ bead: 'closed' });

    await assert.rejects(
      runCli({ argv: ['--base'], cwd: repoRoot, exec, write: () => {} }),
      /--base needs a git ref/,
    );
  });

  it('reports every worktree with its classification when run with no arguments', async () => {
    const { repoRoot, exec } = await createRepo({ bead: 'closed' });
    let output = '';

    const exitCode = await runCli({ argv: [], cwd: repoRoot, exec, write: (chunk) => { output += chunk; } });

    assert.match(output, /proj-1\s+closed-bead\s+removed/);
    assert.equal(exitCode, 0);
  });

  it('removes orphans on the command line only with the --remove-orphans flag', async () => {
    const { repoRoot, worktree, exec } = await createRepo({ bead: 'missing' });

    const exitCode = await runCli({ argv: ['--remove-orphans'], cwd: repoRoot, exec, write: () => {} });

    assert.equal(exitCode, 0);
    await assert.rejects(stat(worktree));
  });
});
