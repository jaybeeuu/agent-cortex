// Converges the ralph worktree set with bead state.
//
// Ralph runs each bead in `.agent-cortex/worktrees/<bead-id>` and leaves the
// worktree behind after the bead closes; crashed runs leave orphans. This pass
// reads bead state, not git ancestry: this repo squash-merges, so every ancestry
// test reports a landed branch as unmerged.
//
// Zero dependencies: run with `node prune-worktrees.mjs`.

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

// BD_PATH env override lets machines where bd is not on PATH pin a location.
const BD_PATH = process.env.BD_PATH || 'bd';

/** @typedef {'closed-bead' | 'open-bead' | 'orphan' | 'unclassified'} Classification */
/** @typedef {'removed' | 'kept' | 'refused'} Outcome */

/**
 * @typedef {object} WorktreeEntry
 * @property {string} id                  Bead id, taken from the directory name.
 * @property {string} path                Absolute path of the worktree.
 * @property {string | null} branch       Checked-out branch, or null when unknown.
 * @property {Classification} classification
 * @property {string} beadStatus          Raw `bd` status, or `'missing'`.
 * @property {Outcome} outcome
 * @property {string[]} reasons           Why the worktree was not removed.
 */

/**
 * @typedef {object} PruneResult
 * @property {WorktreeEntry[]} entries
 * @property {number} exitCode
 */

/**
 * The text of a failed child-process call: git's stderr when it has one, the
 * error message otherwise.
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  if (typeof error === 'object' && error !== null) {
    const { stderr, message } = /** @type {{ stderr?: unknown, message?: unknown }} */ (error);
    if (typeof stderr === 'string' && stderr.trim() !== '') return stderr;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

/**
 * @param {unknown} error
 * @returns {boolean} true when the error is a missing path, not a failure.
 */
function isMissingPath(error) {
  return typeof error === 'object' && error !== null && /** @type {{ code?: unknown }} */ (error).code === 'ENOENT';
}

/** @type {(args: string[]) => Promise<string>} */
async function runBd(args) {
  const { stdout } = await execFileAsync(BD_PATH, args, { encoding: 'utf-8' });
  return stdout;
}

/**
 * Run git in `cwd` and report the outcome rather than throwing: a refusal is an
 * expected domain result here, not an emergency.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>}
 */
async function runGit(cwd, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8' });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, stderr: errorText(error) };
  }
}

/**
 * List the worktree directories under `.agent-cortex/worktrees`, ignoring
 * everything else on disk. A missing directory means nothing to prune.
 * @param {string} repoRoot
 * @returns {Promise<string[]>} absolute paths, sorted for stable output.
 */
async function listWorktreePaths(repoRoot) {
  const worktreesDir = join(repoRoot, '.agent-cortex', 'worktrees');
  /** @type {import('node:fs').Dirent[]} */
  let dirents;
  try {
    dirents = await readdir(worktreesDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPath(error)) return [];
    throw error;
  }
  return dirents
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => join(worktreesDir, dirent.name))
    .sort();
}

/**
 * Map each registered worktree path to its checked-out branch and lock state.
 * @param {string} repoRoot
 * @returns {Promise<Map<string, { branch: string | null, locked: string | null }>>}
 */
async function readRegisteredWorktrees(repoRoot) {
  const result = await runGit(repoRoot, ['worktree', 'list', '--porcelain']);
  /** @type {Map<string, { branch: string | null, locked: string | null }>} */
  const registered = new Map();
  if (!result.ok) return registered;

  for (const block of result.stdout.split('\n\n')) {
    const lines = block.split('\n');
    const pathLine = lines.find((line) => line.startsWith('worktree '));
    if (pathLine === undefined) continue;
    const branchLine = lines.find((line) => line.startsWith('branch '));
    const lockedLine = lines.find((line) => line.startsWith('locked'));
    registered.set(pathLine.slice('worktree '.length), {
      branch: branchLine === undefined ? null : branchLine.slice('branch refs/heads/'.length),
      locked: lockedLine === undefined ? null : lockedLine.slice('locked'.length).trim(),
    });
  }
  return registered;
}

/**
 * Resolve one worktree's bead and classify it.
 * @param {string} id
 * @param {(args: string[]) => Promise<string>} exec
 * @returns {Promise<{ classification: Classification, beadStatus: string }>}
 */
async function classifyBead(id, exec) {
  let stdout;
  try {
    stdout = await exec(['show', id, '--json']);
  } catch (error) {
    const message = errorText(error);
    if (/not found|no issues found/i.test(message)) {
      return { classification: 'orphan', beadStatus: 'missing' };
    }
    return { classification: 'unclassified', beadStatus: `error: ${message.trim()}` };
  }

  const beads = JSON.parse(stdout);
  const bead = (Array.isArray(beads) ? beads[0] : beads) ?? {};
  const status = String(bead.status ?? 'unknown');
  return { classification: status === 'closed' ? 'closed-bead' : 'open-bead', beadStatus: status };
}

/**
 * Reasons git refuses to tear a worktree down. A worktree removed anyway would
 * throw away uncommitted work or an unpushed branch, so every reason keeps the
 * worktree in place.
 * @param {{ path: string, registered: { branch: string | null, locked: string | null } | undefined }} target
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} git
 * @returns {Promise<{ branch: string | null, reasons: string[] }>}
 */
async function findRefusals({ path, registered }, git) {
  /** @type {string[]} */
  const reasons = [];

  if (registered === undefined) {
    return { branch: null, reasons: ['not a registered git worktree'] };
  }
  if (registered.locked !== null) {
    reasons.push(registered.locked === '' ? 'worktree is locked' : `worktree is locked: ${registered.locked}`);
  }
  if (registered.branch === null) {
    return { branch: null, reasons: [...reasons, 'worktree is not on a branch'] };
  }

  const status = await git(path, ['status', '--porcelain']);
  if (!status.ok) return { branch: registered.branch, reasons: [...reasons, `worktree cannot be read: ${status.stderr.trim()}`] };
  const dirtyPaths = status.stdout.split('\n').filter((line) => line !== '').length;
  if (dirtyPaths > 0) reasons.push(`worktree is dirty: ${dirtyPaths} uncommitted path(s)`);

  const upstream = await git(path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok) {
    reasons.push(`branch ${registered.branch} has no remote-tracking branch`);
    return { branch: registered.branch, reasons };
  }
  const trackingRef = upstream.stdout.trim();
  const unpushed = await git(path, ['rev-list', '--count', `${trackingRef}..HEAD`]);
  if (!unpushed.ok) return { branch: registered.branch, reasons: [...reasons, `branch ${registered.branch} cannot be compared with ${trackingRef}: ${unpushed.stderr.trim()}`] };
  const unpushedCommits = Number.parseInt(unpushed.stdout.trim(), 10);
  if (unpushedCommits > 0) {
    reasons.push(`branch ${registered.branch} has ${unpushedCommits} commit(s) not pushed to ${trackingRef}`);
  }

  return { branch: registered.branch, reasons };
}

/**
 * Remove a worktree and its branch, locally and on the remote.
 * @param {string} repoRoot
 * @param {{ path: string, branch: string }} target
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} git
 * @returns {Promise<{ ok: true } | { ok: false, reasons: string[] }>}
 */
async function removeWorktree(repoRoot, { path, branch }, git) {
  /** @type {string[]} */
  const reasons = [];

  const removed = await git(repoRoot, ['worktree', 'remove', path]);
  if (!removed.ok) {
    return { ok: false, reasons: [`git worktree remove failed: ${removed.stderr.trim()}`] };
  }

  const local = await git(repoRoot, ['branch', '-D', branch]);
  if (!local.ok) reasons.push(`local branch ${branch} could not be deleted: ${local.stderr.trim()}`);

  const remote = await git(repoRoot, ['push', 'origin', '--delete', branch]);
  const remoteGone = /remote ref does not exist/i.test(remote.ok ? '' : remote.stderr);
  if (!remote.ok && !remoteGone) {
    reasons.push(`remote branch ${branch} could not be deleted: ${remote.stderr.trim()}`);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/**
 * Converge `.agent-cortex/worktrees` with bead state: remove closed-bead
 * worktrees, report everything else.
 * @param {object} options
 * @param {string} options.repoRoot                              Repository to prune.
 * @param {boolean} [options.removeOrphans]                       Also remove worktrees whose bead is open or missing.
 * @param {(args: string[]) => Promise<string>} [options.exec]    bd runner; injectable for tests.
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} [options.git]  git runner; injectable for tests.
 * @returns {Promise<PruneResult>}
 */
export async function pruneWorktrees({ repoRoot, exec = runBd, removeOrphans = false, git = runGit }) {
  const registered = await readRegisteredWorktrees(repoRoot);
  /** @type {WorktreeEntry[]} */
  const entries = [];

  for (const path of await listWorktreePaths(repoRoot)) {
    const id = path.slice(dirname(path).length + 1);
    const { classification, beadStatus } = await classifyBead(id, exec);

    /** @type {WorktreeEntry} */
    const entry = { id, path, branch: registered.get(path)?.branch ?? null, classification, beadStatus, outcome: 'kept', reasons: [] };

    // A closed bead is the proof. Anything else — an open bead, a missing bead,
    // a bead bd could not answer for — is only removed on explicit request, and
    // an unreadable bead is never removed at all.
    const wanted = classification === 'closed-bead' || (classification !== 'unclassified' && removeOrphans);
    if (wanted) {
      const { branch, reasons } = await findRefusals({ path, registered: registered.get(path) }, git);
      entry.branch = branch;
      if (reasons.length > 0) {
        entry.outcome = 'refused';
        entry.reasons = reasons;
      } else if (branch === null) {
        entry.outcome = 'refused';
        entry.reasons = ['worktree is not on a branch'];
      } else {
        const removal = await removeWorktree(repoRoot, { path, branch }, git);
        entry.outcome = removal.ok ? 'removed' : 'refused';
        if (!removal.ok) entry.reasons = removal.reasons;
      }
    }

    entries.push(entry);
  }

  return { entries, exitCode: entries.some((entry) => entry.outcome !== 'removed') ? 1 : 0 };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node prune-worktrees.mjs [--remove-orphans]

Removes worktrees under .agent-cortex/worktrees whose bead is closed, then
reports the rest. A worktree whose bead is open or missing is an orphan: it is
only removed when --remove-orphans is passed. Run from anywhere inside the
repository.
`;

/** Every flag the CLI accepts. */
const REMOVE_ORPHANS_FLAG = '--remove-orphans';

class UsageError extends Error {}

/**
 * Resolve the repository root from any directory inside it — the main checkout
 * or a linked worktree. The shared `.git` directory is one level below the root
 * in both cases.
 * @param {string} cwd
 * @returns {Promise<string | null>}
 */
async function resolveRepoRoot(cwd) {
  const result = await runGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return result.ok ? dirname(result.stdout.trim()) : null;
}

/**
 * @param {object} options
 * @param {string[]} options.argv                                  CLI arguments (without node/script).
 * @param {string} [options.cwd]                                   Directory the CLI was invoked from. * @param {(args: string[]) => Promise<string>} [options.exec]      bd runner; injectable for tests.
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} [options.git]
 * @param {(chunk: string) => void} [options.write]                  stdout sink; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({ argv, cwd = process.cwd(), exec = runBd, git = runGit, write = (chunk) => process.stdout.write(chunk) }) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return 0;
  }
  const unknown = argv.filter((arg) => arg !== REMOVE_ORPHANS_FLAG);
  if (unknown.length > 0) throw new UsageError(`unexpected argument: ${unknown[0]}`);
  const removeOrphans = argv.includes(REMOVE_ORPHANS_FLAG);

  const repoRoot = await resolveRepoRoot(cwd);
  if (repoRoot === null) throw new Error('not inside a git repository');

  const { entries, exitCode } = await pruneWorktrees({ repoRoot, exec, removeOrphans, git });

  write(`Scanning ${join(repoRoot, '.agent-cortex', 'worktrees')}\n`);
  for (const entry of entries) {
    const detail = entry.reasons.length > 0 ? ` — ${entry.reasons.join('; ')}` : '';
    write(`  ${entry.id.padEnd(24)} ${entry.classification.padEnd(13)} ${entry.outcome}${detail}\n`);
  }
  const removed = entries.filter((entry) => entry.outcome === 'removed').length;
  write(`Removed ${removed} of ${entries.length} worktree(s).\n`);

  return exitCode;
}

// Only run the CLI when invoked directly, so tests can import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    });
}
