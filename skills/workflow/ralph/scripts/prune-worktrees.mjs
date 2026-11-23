// Converges the ralph worktree set with bead state.
//
// Ralph runs each bead in `.agent-cortex/worktrees/<bead-id>` and leaves the
// worktree behind after the bead closes; crashed runs leave orphans. This pass
// reads bead state, not git ancestry: this repo squash-merges, so every ancestry
// test reports a landed branch as unmerged.
//
// A merge that deletes its branch also deletes the local branch's upstream, so a
// closed bead with no remote-tracking branch is the normal end of a landed branch.
// Only the content can tell that apart from a branch that was never pushed: the
// branch goes when the base holds the branch's own version of every path the
// branch changed since their merge base, and stays otherwise. The test is
// one-sided on purpose: this repo squash-merges, so a base that moved on after the
// branch was cut holds paths the branch never had, and demanding tree equality
// would keep every branch but the last one landed.
//
// A closed bead's upstream is never the arbiter. Ralph cuts its branch from the
// remote base (`git worktree add -b feature/<id> … origin/<base>`), and
// `branch.autoSetupMerge` then makes that base the branch's upstream. A squash
// merge rewrites the commits, so the branch stays ahead of its own upstream for
// ever: counting commits against it refuses every landed ralph worktree, which is
// the one case the content test exists to decide. A closed bead is therefore
// decided by content alone, whatever its upstream is. An open bead keeps the
// upstream refusal, because nothing about an open bead is proven.
//
// The test proves content, never history. A branch removed here is discarded
// together with every commit the base does not contain — a reverted change and a
// run of empty commits both go, and so do their messages. The base is the remote's
// default branch, never a hardcoded name.
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
 * @property {string | null} baseRef   Ref the content check compared against; null when none resolved.
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
 * Resolve the branch a worktree's content must be contained in before its local
 * branch may be dropped. The remote's default branch is the generic answer:
 * `origin/HEAD` is a symbolic ref to whatever the remote calls its default
 * branch, so no branch name is baked in here. The symbolic ref is returned as it
 * stands, so a report names `origin/HEAD` rather than the branch it points at
 * today.
 * @param {string} repoRoot
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} git
 * @returns {Promise<string | null>} the base ref, or null when git cannot name one.
 */
async function resolveBaseRef(repoRoot, git) {
  const result = await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  return result.ok ? 'origin/HEAD' : null;
}

/**
 * Split the output of `git diff --name-only -z` into paths. `-z` is what makes the
 * round trip lossless: without it git C-quotes a path holding a non-ASCII byte, a
 * double quote, a backslash or a newline, and a quoted name fed back as a
 * pathspec names no path. With it, every path arrives raw and NUL-terminated, so
 * a path holding a newline stays one path.
 * @param {string} stdout
 * @returns {string[]}
 */
function splitNulPaths(stdout) {
  // The output ends with a NUL, so the split leaves one empty entry to drop. A
  // path is never empty, so no real path is lost with it.
  return stdout.split('\0').filter((entry) => entry !== '');
}

/**
 * The opening clause of a content-proof refusal. Two situations reach the content
 * check — a closed bead whose branch has lost its upstream, and a closed bead whose
 * branch still tracks the base it was cut from — and both are refused for the same
 * reason: the base does not hold the branch's content. The clause states which
 * situation applies, so a reader can tell an unpublished branch from one whose
 * upstream cannot prove it.
 * @param {string} branch
 * @param {string | null} upstream the branch's remote-tracking ref, or null when it has none.
 * @returns {string}
 */
function contentLead(branch, upstream) {
  return upstream === null
    ? `branch ${branch} has no remote-tracking branch`
    : `branch ${branch} is not proven by ${upstream}`;
}

/**
 * True when `ref` names the worktree's own branch, locally or as its
 * remote-tracking ref. Comparing such a ref with the branch is a self-comparison:
 * the diff is empty whatever the branch holds, so it proves nothing.
 * @param {string} path
 * @param {string} ref
 * @param {string} branch
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} git
 * @returns {Promise<boolean>}
 */
async function namesOwnBranch(path, ref, branch, git) {
  const resolved = await git(path, ['rev-parse', '--symbolic-full-name', ref]);
  if (!resolved.ok) return false;
  const name = resolved.stdout.trim();
  if (name === `refs/heads/${branch}`) return true;
  // `refs/remotes/<remote>/<branch>`, whatever the remote is called.
  return name.startsWith('refs/remotes/') && name.endsWith(`/${branch}`);
}

/**
 * Decide whether a closed bead's branch still holds work. Removing such a branch is
 * only safe when the base holds the branch's own version of every path the branch
 * changed — the squash-merge case. Anything unprovable keeps the worktree.
 *
 * One-sided containment, in three steps: take the merge base of the base and the
 * branch, list the paths the branch changed since that merge base, then require the
 * base to agree with the branch on those paths alone. Paths only the base added or
 * changed lie outside that set and are ignored, so a base that advanced after the
 * branch was cut still proves the branch landed.
 *
 * A status filter on the two-sided diff would be simpler and is wrong: `D` is the
 * same status whether the branch deleted a path or the base never had it, so a
 * filter cannot tell a deletion the base already carries from one it does not.
 *
 * Restricting to the branch's own paths is what makes an overlap detectable: when
 * the base later changed a path the branch also changed, the two versions differ
 * and the branch is not proven landed. A deletion on both sides agrees, so it is
 * proven; a deletion on one side only is not.
 *
 * The branch's changed paths are read from git and then handed straight back to a
 * second git call as pathspecs, so that round trip has to be exact. Two escapes
 * make it inexact and both end in a false "proven": a path git would C-quote
 * prints as a quoted string that names no path, and a path starting with `:` is
 * read as pathspec magic instead of a name. Neither alone is sufficient to fix,
 * so the first diff reads with `-z` and the second is run with
 * `--literal-pathspecs`.
 * @param {{ path: string, branch: string, beadClosed: boolean, upstream: string | null }} target
 *   `upstream` is the branch's remote-tracking ref, or null when it has none.
 * @param {string | null} baseRef
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} git
 * @returns {Promise<string | null>} a refusal reason, or null when nothing is lost.
 */
async function findLostWork({ path, branch, beadClosed, upstream }, baseRef, git) {
  if (!beadClosed) {
    return `branch ${branch} has no remote-tracking branch and its bead is not closed`;
  }
  /** @param {string} clause @returns {string} */
  const refuse = (clause) => `${contentLead(branch, upstream)}: ${clause}`;
  if (baseRef === null) {
    return refuse('the base branch cannot be resolved, so its content cannot be proven landed');
  }
  const tip = await git(path, ['rev-parse', '--verify', 'HEAD']);
  if (!tip.ok) {
    const detail = tip.stderr.trim();
    const suffix = detail === '' ? '' : `: ${detail}`;
    return refuse(`its tip cannot be read${suffix}`);
  }
  const baseTip = await git(path, ['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]);
  if (!baseTip.ok) {
    const detail = baseTip.stderr.trim();
    const suffix = detail === '' ? '' : `: ${detail}`;
    return refuse(`${baseRef} cannot be compared with it${suffix}`);
  }
  // A base that names the branch being deleted compares the branch with itself,
  // whatever the branch holds. The test is on the ref, not on the tip: a branch cut
  // from the base and never committed to holds the base's own commit, and that is a
  // real proof — it has no content of its own to lose.
  if (await namesOwnBranch(path, baseRef, branch, git)) {
    return refuse(`${baseRef} names this branch, so the comparison would prove nothing`);
  }
  const mergeBase = await git(path, ['merge-base', baseRef, 'HEAD']);
  if (!mergeBase.ok) {
    const detail = mergeBase.stderr.trim();
    const suffix = detail === '' ? '' : `: ${detail}`;
    return refuse(`${baseRef} cannot be compared with it${suffix}`);
  }
  const touched = await git(path, ['diff', '--name-only', '-z', '--no-renames', mergeBase.stdout.trim(), 'HEAD', '--']);
  if (!touched.ok) {
    const detail = touched.stderr.trim();
    const suffix = detail === '' ? '' : `: ${detail}`;
    return refuse(`${baseRef} cannot be compared with it${suffix}`);
  }
  const changedPaths = splitNulPaths(touched.stdout);
  // Nothing but empty commits: no content to prove, and no content to lose.
  if (changedPaths.length === 0) return null;
  // `--literal-pathspecs` is a git global option, so it precedes the subcommand.
  // It keeps a leading `:` in a real filename from being read as pathspec magic.
  const unproven = await git(path, ['--literal-pathspecs', 'diff', '--name-only', '-z', '--no-renames', 'HEAD', baseRef, '--', ...changedPaths]);
  if (!unproven.ok) {
    const detail = unproven.stderr.trim();
    const suffix = detail === '' ? '' : `: ${detail}`;
    return refuse(`${baseRef} cannot be compared with it${suffix}`);
  }
  const unprovenPaths = splitNulPaths(unproven.stdout).length;
  if (unprovenPaths > 0) {
    return refuse(`${baseRef} does not hold this branch's version of ${unprovenPaths} path(s), so its content is not landed`);
  }
  return null;
}

/**
 * Reasons git refuses to tear a worktree down. A worktree removed anyway would
 * throw away uncommitted work or an unpushed branch, so every reason keeps the
 * worktree in place.
 * @param {{ path: string, registered: { branch: string | null, locked: string | null } | undefined, beadClosed: boolean }} target
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} git
 * @param {string | null} baseRef
 * @returns {Promise<{ branch: string | null, reasons: string[] }>}
 */
async function findRefusals({ path, registered, beadClosed }, git, baseRef) {
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
  const trackingRef = upstream.ok ? upstream.stdout.trim() : null;

  // A closed bead is decided by content alone, never by its upstream: a ralph
  // branch is cut from the remote base, so it tracks that base and stays ahead of
  // it after a squash merge rewrites its commits. Counting commits against such an
  // upstream refuses every landed ralph worktree. An open bead with no upstream has
  // nothing to prove, so it lands here too and refuses below.
  if (beadClosed || trackingRef === null) {
    const lost = await findLostWork({ path, branch: registered.branch, beadClosed, upstream: trackingRef }, baseRef, git);
    if (lost !== null) reasons.push(lost);
    return { branch: registered.branch, reasons };
  }
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
 * @param {string} [options.base]                                 Ref the content check compares against; defaults to the remote's default branch.
 * @param {(args: string[]) => Promise<string>} [options.exec]    bd runner; injectable for tests.
 * @param {(cwd: string, args: string[]) => Promise<{ ok: true, stdout: string } | { ok: false, stderr: string }>} [options.git]  git runner; injectable for tests.
 * @returns {Promise<PruneResult>}
 */
export async function pruneWorktrees({ repoRoot, exec = runBd, removeOrphans = false, git = runGit, base }) {
  const registered = await readRegisteredWorktrees(repoRoot);
  const baseRef = base ?? (await resolveBaseRef(repoRoot, git));
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
      const { branch, reasons } = await findRefusals(
        { path, registered: registered.get(path), beadClosed: classification === 'closed-bead' },
        git,
        baseRef,
      );
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

  return { entries, baseRef, exitCode: entries.some((entry) => entry.outcome !== 'removed') ? 1 : 0 };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node prune-worktrees.mjs [--remove-orphans] [--base <ref>]

Removes worktrees under .agent-cortex/worktrees whose bead is closed, then
reports the rest. A worktree whose bead is open or missing is an orphan: it is
only removed when --remove-orphans is passed. Run from anywhere inside the
repository.

A closed bead's branch is proven by content alone, whatever its upstream is: many
merge methods delete the remote branch when the work lands, and a branch cut from
the remote base tracks that base, which a squash merge leaves behind. Such a branch
is removed only when the base holds the branch's own version of every path the
branch changed since their merge base. That proves content and never history:
removal discards every commit the base does not contain, such as a reverted change
or an empty commit, together with its message. The report names the ref it tested
the content against, so a refusal names the ref that decided it. The base defaults
to the remote's default branch (origin/HEAD); --base names another ref, such as an
epic or release branch. A base that names the worktree's own branch compares the
branch with itself, so it proves nothing: the worktree is kept and refused, as it
is when no base resolves.

An open bead is proven by its upstream instead, and only with --remove-orphans: its
branch must carry an upstream and no commit unpushed to it. With no upstream it is
refused whatever its content says.
`;

/** Every flag the CLI accepts. */
const REMOVE_ORPHANS_FLAG = '--remove-orphans';
const BASE_FLAG = '--base';

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @returns {{ removeOrphans: boolean, base: string | undefined }}
 */
function parseArgs(argv) {
  let removeOrphans = false;
  /** @type {string | undefined} */
  let base;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === REMOVE_ORPHANS_FLAG) {
      removeOrphans = true;
      continue;
    }
    if (arg === BASE_FLAG) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) throw new UsageError(`${BASE_FLAG} needs a git ref`);
      base = value;
      index += 1;
      continue;
    }
    throw new UsageError(`unexpected argument: ${arg}`);
  }
  return { removeOrphans, base };
}

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
  const { removeOrphans, base } = parseArgs(argv);

  const repoRoot = await resolveRepoRoot(cwd);
  if (repoRoot === null) throw new Error('not inside a git repository');

  const { entries, baseRef, exitCode } = await pruneWorktrees({ repoRoot, exec, removeOrphans, git, base });

  write(`Scanning ${join(repoRoot, '.agent-cortex', 'worktrees')}\n`);
  write(
    baseRef === null
      ? 'Base: unresolved (no --base given, and origin/HEAD cannot be resolved)\n'
      : `Base: ${baseRef}\n`,
  );
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
