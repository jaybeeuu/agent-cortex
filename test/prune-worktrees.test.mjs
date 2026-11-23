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
import { dirname, join } from 'node:path';
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
 * @param {{ repoRoot: string, branch: string, baseRef?: string }} options  `baseRef` is the
 *   remote branch the work lands on, defaulting to the default branch's remote ref.
 */
async function squashMergeOntoBase({ repoRoot, branch, baseRef = 'main' }) {
  await git(repoRoot, ['merge', '--squash', '--quiet', branch]);
  await git(repoRoot, ['commit', '-m', 'landed']);
  await git(repoRoot, ['push', '--quiet', 'origin', `HEAD:refs/heads/${baseRef}`]);
  await git(repoRoot, ['push', '--quiet', 'origin', '--delete', branch]);
  await git(repoRoot, ['fetch', '--quiet', '--prune', 'origin']);
}

/**
 * A repository with a bare origin and one commit on the base branch: the shape
 * the content check reads its base from.
 */
async function createRepoRoot() {
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

  return { origin, repoRoot };
}
/**
 * Add one ralph worktree on its own `feature/<beadId>` branch, cut from the base
 * branch as it stands now. `push: false` leaves the branch unpublished, so it has
 * no upstream and no remote branch.
 * @param {{ repoRoot: string, beadId: string, push?: boolean }} options
 */
async function addWorktree({ repoRoot, beadId, push = true }) {
  const branch = `feature/${beadId}`;
  await mkdir(join(repoRoot, '.agent-cortex', 'worktrees'), { recursive: true });
  const worktree = join(repoRoot, '.agent-cortex', 'worktrees', beadId);
  await git(repoRoot, ['worktree', 'add', '--quiet', '-b', branch, worktree]);
  if (push) await git(worktree, ['push', '--quiet', '-u', 'origin', branch]);
  return { worktree, branch };
}
/**
 * Add a worktree the way ralph creates it: the branch starts at the remote's
 * default branch (`git worktree add -b feature/<id> … origin/main`), so
 * `branch.autoSetupMerge` makes that base the branch's upstream. A push with `-u`
 * would hide that shape, so these fixtures push without it.
 * @param {{ repoRoot: string, beadId: string }} options
 */
async function addRalphWorktree({ repoRoot, beadId }) {
  const branch = `feature/${beadId}`;
  await mkdir(join(repoRoot, '.agent-cortex', 'worktrees'), { recursive: true });
  const worktree = join(repoRoot, '.agent-cortex', 'worktrees', beadId);
  await git(repoRoot, ['worktree', 'add', '--quiet', '-b', branch, worktree, 'origin/HEAD']);
  return { worktree, branch };
}
/**
 * A `bd` runner that reports every given bead id as closed, and any other id as
 * missing.
 * @param {string[]} beadIds
 * @returns {(args: string[]) => Promise<string>}
 */
function closedBeadExec(beadIds) {
  return beadExec(beadIds, 'closed');
}
/**
 * A `bd` runner that reports every given bead id with `status`, and any other id as
 * missing.
 * @param {string[]} beadIds
 * @param {string} status
 * @returns {(args: string[]) => Promise<string>}
 */
function beadExec(beadIds, status) {
  return async (args) => {
    const [, id] = args;
    if (!beadIds.includes(id)) throw new Error(`Issue ${id} not found`);
    return JSON.stringify([{ id, status }]);
  };
}
/**
 * Land a branch on the remote epic branch the way a feature PR does: a squash
 * merge, made in a second clone, so no local branch in `repoRoot` moves. Only
 * `origin/epic/<epicId>` advances, and the remote feature branch is deleted.
 * @param {{ origin: string, repoRoot: string, branch: string, epicId: string }} options
 */
async function landOnRemoteEpicBranch({ origin, repoRoot, branch, epicId }) {
  const workspace = dirname(repoRoot);
  const clone = join(workspace, 'landing');
  await git(workspace, ['clone', '--quiet', origin, clone]);
  await git(clone, ['config', 'user.email', 'test@example.com']);
  await git(clone, ['config', 'user.name', 'Test']);
  await git(clone, ['config', 'commit.gpgsign', 'false']);
  await git(clone, ['checkout', '--quiet', `epic/${epicId}`]);
  await git(clone, ['merge', '--squash', '--quiet', `origin/${branch}`]);
  await git(clone, ['commit', '-m', 'landed']);
  await git(clone, ['push', '--quiet', 'origin', `HEAD:refs/heads/epic/${epicId}`]);
  await git(clone, ['push', '--quiet', 'origin', '--delete', branch]);
  await git(repoRoot, ['fetch', '--quiet', '--prune', 'origin']);
}
/**
 * A repository whose origin carries an `epic/<epicId>` branch, plus one ralph
 * worktree cut from that epic branch: the shape a feature of a multi-feature epic
 * has. The worktree's work is landed on the epic branch the way a squash merge
 * lands it, in a second clone, so only `origin/epic/<epicId>` advances and the
 * local epic branch stays where ralph created it. That gap is the whole point: the
 * local branch is created once and never fast-forwarded, so it never holds the
 * feature's own content.
 * @param {{ beadId?: string, epicId?: string }} [options]
 */
async function createLandedEpicRepo({ beadId = 'proj-1', epicId = 'e1' } = {}) {
  const { origin, repoRoot } = await createRepoRoot();
  await git(repoRoot, ['push', '--quiet', 'origin', `HEAD:refs/heads/epic/${epicId}`]);
  await git(repoRoot, ['fetch', '--quiet', 'origin']);
  // The epic branch is cut from the remote default branch, as ralph creates it.
  await git(repoRoot, ['branch', `epic/${epicId}`, `origin/epic/${epicId}`]);
  const branch = `feature/${beadId}`;
  await mkdir(join(repoRoot, '.agent-cortex', 'worktrees'), { recursive: true });
  const worktree = join(repoRoot, '.agent-cortex', 'worktrees', beadId);
  // Ralph bases the feature branch on the local epic branch, so it inherits no upstream.
  await git(repoRoot, ['worktree', 'add', '--quiet', '-b', branch, worktree, `epic/${epicId}`]);
  await writeFile(join(worktree, 'landed.txt'), 'the change\n');
  await git(worktree, ['add', '-A']);
  await git(worktree, ['commit', '-m', 'the change']);
  await git(worktree, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
  await landOnRemoteEpicBranch({ origin, repoRoot, branch, epicId });
  return { origin, repoRoot, worktree, branch, epicId };
}
/**
 * A repository with an origin and one ralph worktree on a feature branch. The
 * bead id is the worktree's directory name, and `bead` is the status the
 * injected `bd` reports for it, or `'missing'` for no bead at all. `push: false`
 * leaves the branch unpublished, so it has no upstream and no remote branch.
 * @param {{ beadId?: string, bead: string, push?: boolean }} options
 */
async function createRepo({ beadId = 'proj-1', bead, push = true }) {
  const { origin, repoRoot } = await createRepoRoot();
  const { worktree, branch } = await addWorktree({ repoRoot, beadId, push });
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

  it('refuses a closed-bead worktree whose pushed branch holds a commit the base does not have', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'unpushed.txt'), 'work in progress\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'unpushed work']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /does not hold this branch's version of 1 path\(s\)/);
    await stat(worktree);
  });

  it('removes a closed-bead worktree whose branch tracks the base it was squash-merged into', async () => {
    const beadId = 'proj-1';
    const { repoRoot } = await createRepoRoot();
    const { worktree, branch } = await addRalphWorktree({ repoRoot, beadId });
    const base = (await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    assert.equal(
      (await git(worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim(),
      base,
      'the fixture branch tracks the base branch, as every ralph worktree does',
    );
    await writeFile(join(worktree, 'landed.txt'), 'the change\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'the change']);
    await git(worktree, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
    await squashMergeOntoBase({ repoRoot, branch });

    const result = await pruneWorktrees({ repoRoot, exec: closedBeadExec([beadId]) });

    assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['removed']);
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '', 'the local branch is deleted');
  });

  it('refuses a closed-bead worktree that tracks the base when the base lacks its change', async () => {
    const beadId = 'proj-1';
    const { repoRoot } = await createRepoRoot();
    const { worktree, branch } = await addRalphWorktree({ repoRoot, beadId });
    const base = (await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    assert.equal(
      (await git(worktree, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim(),
      base,
      'the fixture branch tracks the base branch, as every ralph worktree does',
    );
    await writeFile(join(worktree, 'never-landed.txt'), 'work that never landed\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never landed']);
    await git(worktree, ['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);

    const result = await pruneWorktrees({ repoRoot, exec: closedBeadExec([beadId]) });

    assert.equal(result.entries[0].outcome, 'refused');
    const reasons = result.entries[0].reasons.join(' ');
    assert.match(reasons, /does not hold this branch's version of 1 path\(s\)/);
    assert.ok(
      reasons.includes(`branch ${branch} is not proven by ${base}`),
      `the reason names the upstream ${base} that cannot prove the branch`,
    );
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
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

  it('removes a closed-bead worktree whose landed path a later change rewrote, naming the commit that landed it', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'landed.txt'), 'branch version\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'the change']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    await squashMergeOntoBase({ repoRoot, branch });
    const landing = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    // A later pull request rewrites the same path, so the base holds neither the
    // branch's version nor the branch's commit. The work is landed all the same.
    await writeFile(join(repoRoot, 'landed.txt'), 'rewritten by a later pull request\n');
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'rewrite the landed path']);
    await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['removed']);
    assert.deepEqual(result.entries[0].proven, [`superseded at ${landing}`]);
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '', 'the local branch is deleted');
  });

  it('removes a closed-bead worktree whose landed path the base later renamed', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'before.md'), 'content the base keeps under another name\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'the change']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    await squashMergeOntoBase({ repoRoot, branch });
    const landing = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    await git(repoRoot, ['mv', 'before.md', 'after.md']);
    await git(repoRoot, ['commit', '-m', 'rename the landed path']);
    await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['removed']);
    assert.deepEqual(result.entries[0].proven, [`superseded at ${landing}`], 'a rename does not hide the landing');
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
  });

  it("keeps a closed-bead worktree when the base holds the branch's empty blob at another path", async () => {
    const { repoRoot, origin, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'never-landed.txt'), '');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'an empty file that never lands']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    // The base touches its own empty file. The empty blob is the same object in every
    // repository, so holding that blob elsewhere proves nothing about this path.
    await writeFile(join(repoRoot, 'unrelated.txt'), '');
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'add an empty file of its own']);
    await writeFile(join(repoRoot, 'unrelated.txt'), 'written by the base\n');
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'fill the empty file in']);
    await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(result.entries[0].proven, [], 'no commit holds the blob at the path');
    assert.equal(result.entries[0].outcome, 'refused');
    const reasons = result.entries[0].reasons.join(' ');
    assert.match(reasons, /does not hold this branch's version of 1 path\(s\)/);
    assert.match(reasons, /so its content is not landed/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
    assert.match(await git(origin, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]), new RegExp(branch));
  });

  it("keeps a closed-bead worktree when the base wrote the branch's bytes at another path", async () => {
    const { repoRoot, origin, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    const plan = '1. keep the branch\n2. prove the path landed\n3. never assume the blob\n';
    await mkdir(join(worktree, 'notes'), { recursive: true });
    await writeFile(join(worktree, 'notes', 'plan.md'), plan);
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'notes that never land']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    // The base independently writes the same bytes elsewhere, then rewrites them, so
    // its history adds and drops this blob without ever holding it at the path.
    await mkdir(join(repoRoot, 'other'), { recursive: true });
    await writeFile(join(repoRoot, 'other', 'plan.md'), plan);
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'the base writes its own plan']);
    await writeFile(join(repoRoot, 'other', 'plan.md'), 'the base changed its mind\n');
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'the base rewrites its plan']);
    await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.deepEqual(result.entries[0].proven, [], 'no commit holds the bytes at the path');
    assert.equal(result.entries[0].outcome, 'refused');
    const reasons = result.entries[0].reasons.join(' ');
    assert.match(reasons, /does not hold this branch's version of 1 path\(s\)/);
    assert.match(reasons, /so its content is not landed/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
    assert.match(await git(origin, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]), new RegExp(branch));
  });

  it('removes a closed-bead worktree whose changeset a release commit consumed, naming the release commit', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await mkdir(join(worktree, '.changeset'), { recursive: true });
    await writeFile(
      join(worktree, '.changeset', 'tidy-lions-go.md'),
      "---\n'agent-cortex': patch\n---\n\nTeach the pruner that a released changeset still proves landed work\n",
    );
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'add a changeset']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    await squashMergeOntoBase({ repoRoot, branch });
    // A release commit consumes the changeset: the path goes and its text is
    // recorded in the changelog, so the base holds the work and not the path.
    await git(repoRoot, ['rm', '--quiet', '.changeset/tidy-lions-go.md']);
    await writeFile(
      join(repoRoot, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.0.1\n\n- Teach the pruner that a released changeset still proves landed work\n',
    );
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'chore: version packages']);
    const release = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    let output = '';

    const exitCode = await runCli({
      argv: [],
      cwd: repoRoot,
      exec,
      write: (chunk) => {
        output += chunk;
      },
    });

    assert.equal(exitCode, 0);
    assert.match(output, new RegExp(`proj-1\\s+closed-bead\\s+removed — proven: changeset released in ${release}`));
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '', 'the local branch is deleted');
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
    assert.match(reasons, /does not hold this branch's version of 1 path\(s\)/);
    assert.match(reasons, /so its content is not landed/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });

  it('keeps a closed-bead worktree when its only change is a path git quotes (café.md)', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed', push: false });
    await writeFile(join(worktree, 'café.md'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /does not hold this branch's version of 1 path\(s\)/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });
  it('keeps a closed-bead worktree when its only change is a path git quotes (say"hi.txt)', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed', push: false });
    await writeFile(join(worktree, 'say"hi.txt'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /does not hold this branch's version of 1 path\(s\)/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });
  it('keeps a closed-bead worktree when its only change is a path that looks like pathspec magic (:notes.txt)', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed', push: false });
    await writeFile(join(worktree, ':notes.txt'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /does not hold this branch's version of 1 path\(s\)/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });
  it('keeps a closed-bead worktree when its only change is a path containing a newline', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed', push: false });
    await writeFile(join(worktree, 'two\nlines.md'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);

    const result = await pruneWorktrees({ repoRoot, exec });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /does not hold this branch's version of 1 path\(s\)/);
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
      new RegExp(`does not hold this branch's version of 1 path\\(s\\)`),
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
  it('removes every landed worktree when the base advanced after each branch was cut', async () => {
    const { repoRoot, origin } = await createRepoRoot();
    const beadIds = ['proj-1', 'proj-2', 'proj-3'];
    /** @type {{ worktree: string, branch: string }[]} */
    const cut = [];
    for (const beadId of beadIds) {
      const { worktree, branch } = await addWorktree({ repoRoot, beadId });
      await writeFile(join(worktree, `${beadId}.txt`), `${beadId} work\n`);
      await git(worktree, ['add', '-A']);
      await git(worktree, ['commit', '-m', `${beadId} work`]);
      await git(worktree, ['push', '--quiet', 'origin', branch]);
      cut.push({ worktree, branch });
    }
    // Land them one after another, so every branch but the last was cut from a
    // base that has since gained paths the branch never had. That drift is what a
    // run of squash-merged pull requests always leaves behind.
    for (const { branch } of cut) await squashMergeOntoBase({ repoRoot, branch });
    const result = await pruneWorktrees({ repoRoot, exec: closedBeadExec(beadIds) });
    assert.deepEqual(
      result.entries.map(({ id, outcome }) => ({ id, outcome })),
      [
        { id: 'proj-1', outcome: 'removed' },
        { id: 'proj-2', outcome: 'removed' },
        { id: 'proj-3', outcome: 'removed' },
      ],
    );
    assert.equal(result.exitCode, 0);
    for (const { worktree, branch } of cut) {
      await assert.rejects(stat(worktree), `the worktree for ${branch} is gone`);
      assert.equal(
        (await git(repoRoot, ['branch', '--list', branch])).trim(),
        '',
        `the local branch ${branch} is deleted`,
      );
    }
    assert.equal(
      (await git(origin, ['for-each-ref', '--format=%(refname)', 'refs/heads/feature/'])).trim(),
      '',
      'no remote feature branch survives the merges',
    );
  });
  it('keeps a closed-bead worktree when the base changed a path the branch changed', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await writeFile(join(worktree, 'shared.txt'), 'branch version\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'branch version']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    // The base lands a different change to the same path while the branch sits
    // behind it. Two versions of one path: the branch is not proven landed.
    await writeFile(join(repoRoot, 'shared.txt'), 'base version\n');
    await git(repoRoot, ['add', '-A']);
    await git(repoRoot, ['commit', '-m', 'base version']);
    await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    await git(repoRoot, ['push', '--quiet', 'origin', '--delete', branch]);
    await git(repoRoot, ['fetch', '--quiet', '--prune', 'origin']);
    const result = await pruneWorktrees({ repoRoot, exec });
    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(result.entries[0].reasons.join(' '), /does not hold this branch's version of 1 path\(s\)/);
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });
  it('removes a closed-bead worktree when the branch and the base both deleted the same path', async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed' });
    await git(worktree, ['rm', '--quiet', 'README.md']);
    await git(worktree, ['commit', '-m', 'drop the readme']);
    await git(worktree, ['push', '--quiet', 'origin', branch]);
    await git(repoRoot, ['rm', '--quiet', 'README.md']);
    await git(repoRoot, ['commit', '-m', 'drop the readme here too']);
    await git(repoRoot, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    await git(repoRoot, ['push', '--quiet', 'origin', '--delete', branch]);
    await git(repoRoot, ['fetch', '--quiet', '--prune', 'origin']);
    // The branch's one content change is the deletion, and the base carries that
    // same deletion. Nothing the branch holds is lost, so the branch goes.
    const result = await pruneWorktrees({ repoRoot, exec });
    assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['removed']);
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '');
  });
  it("refuses a --base that names the worktree's own branch", async () => {
    const { repoRoot, worktree, branch, exec } = await createRepo({ bead: 'closed', push: false });
    await writeFile(join(worktree, 'never-pushed.txt'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);
    const tip = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
    let output = '';
    const exitCode = await runCli({
      argv: ['--base', branch],
      cwd: repoRoot,
      exec,
      write: (chunk) => {
        output += chunk;
      },
    });
    assert.notEqual(exitCode, 0);
    assert.match(output, /names this branch/);
    assert.equal((await git(worktree, ['rev-parse', 'HEAD'])).trim(), tip, 'the commit survives');
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });
  it('prints the base ref it tested against and names it in an epic refusal', async () => {
    const { repoRoot, worktree, exec } = { ...(await createLandedEpicRepo()), exec: closedBeadExec(['proj-1']) };
    let output = '';

    const exitCode = await runCli({ argv: [], cwd: repoRoot, exec, write: (chunk) => { output += chunk; } });

    assert.notEqual(exitCode, 0);
    assert.match(output, /Base: origin\/HEAD/, 'the report names the ref the content test used');
    assert.match(output, /proj-1\s+closed-bead\s+refused/);
    assert.match(
      output,
      /origin\/HEAD does not hold this branch's version of 1 path\(s\)/,
      'the refusal names the ref that decided it',
    );
    await stat(worktree);
  });
  it('refuses an epic-landed worktree when --base names the stale local epic branch', async () => {
    const { repoRoot, worktree } = await createLandedEpicRepo();
    // The local epic branch never fast-forwards, so it is behind the remote one
    // that the squash merge landed on. A base that is behind does not hold the
    // branch's content, and the content test refuses.
    const localTip = (await git(repoRoot, ['rev-parse', 'epic/e1'])).trim();
    const remoteTip = (await git(repoRoot, ['rev-parse', 'origin/epic/e1'])).trim();
    assert.notEqual(localTip, remoteTip, 'the fixture leaves the local epic branch behind');
    let output = '';

    const exitCode = await runCli({
      argv: ['--base', 'epic/e1'],
      cwd: repoRoot,
      exec: closedBeadExec(['proj-1']),
      write: (chunk) => { output += chunk; },
    });

    assert.equal(exitCode, 1);
    assert.match(output, /proj-1\s+closed-bead\s+refused/);
    assert.match(
      output,
      /epic\/e1 does not hold this branch's version of 1 path\(s\)/,
      'the refusal names the stale local ref that decided it',
    );
    await stat(worktree);
  });
  it('removes an epic-landed closed-bead worktree when --base names the remote epic branch', async () => {
    const { repoRoot, origin, worktree, branch } = await createLandedEpicRepo();
    const base = 'origin/epic/e1';
    let output = '';

    const exitCode = await runCli({
      argv: ['--base', base],
      cwd: repoRoot,
      exec: closedBeadExec(['proj-1']),
      write: (chunk) => { output += chunk; },
    });

    assert.equal(exitCode, 0);
    assert.match(output, /Base: origin\/epic\/e1/, 'the report names the ref passed as --base');
    assert.match(output, /proj-1\s+closed-bead\s+removed/);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['branch', '--list', branch])).trim(), '', 'the local branch is deleted');
    assert.equal(
      (await git(origin, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])).trim(),
      '',
      'no remote feature branch survives',
    );
  });
  it('removes an epic-landed closed-bead worktree when no local epic branch exists', async () => {
    const { repoRoot, worktree } = await createLandedEpicRepo();
    // The epic branch exists on the remote only: the guard must key off
    // `refs/remotes/origin/epic/<id>`, not a local branch that may never exist here.
    await git(repoRoot, ['branch', '-D', 'epic/e1']);
    await assert.rejects(git(repoRoot, ['rev-parse', '--verify', 'epic/e1']), 'no local epic branch');

    const result = await pruneWorktrees({ repoRoot, exec: closedBeadExec(['proj-1']), base: 'origin/epic/e1' });

    assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['removed']);
    assert.equal(result.baseRef, 'origin/epic/e1');
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
  });
  it('keeps an open epic-bead worktree refused by its upstream even with --base', async () => {
    const { repoRoot, worktree, branch } = await createLandedEpicRepo();

    const result = await pruneWorktrees({
      repoRoot,
      exec: beadExec(['proj-1'], 'in_progress'),
      removeOrphans: true,
      base: 'origin/epic/e1',
    });

    assert.equal(result.entries[0].outcome, 'refused');
    assert.match(
      result.entries[0].reasons.join(' '),
      /branch feature\/proj-1 has no remote-tracking branch and its bead is not closed/,
      'an open bead is proven by its upstream, never by content',
    );
    assert.notEqual(result.exitCode, 0);
    await stat(worktree);
    assert.match(await git(repoRoot, ['branch', '--list', branch]), new RegExp(branch));
  });
  it('removes a closed-bead worktree when --base is a tag at its own tip', async () => {
    const { repoRoot, worktree, exec } = await createRepo({ bead: 'closed', push: false });
    await writeFile(join(worktree, 'never-pushed.txt'), 'work that never left this machine\n');
    await git(worktree, ['add', '-A']);
    await git(worktree, ['commit', '-m', 'never pushed']);
    await git(worktree, ['tag', 'own-tip']);
    const tip = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
    // A tag is not the branch's own ref, so it is a real base: it holds the
    // branch's content, and it keeps the commit reachable after the branch goes.
    const result = await pruneWorktrees({ repoRoot, exec, base: 'own-tip' });
    assert.deepEqual(result.entries.map(({ outcome }) => outcome), ['removed']);
    assert.equal(result.exitCode, 0);
    await assert.rejects(stat(worktree), 'the worktree directory is gone');
    assert.equal((await git(repoRoot, ['rev-parse', 'own-tip'])).trim(), tip, 'the tag still holds the commit');
  });
});
