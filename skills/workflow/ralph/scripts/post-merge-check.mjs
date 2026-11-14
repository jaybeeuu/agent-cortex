// @ts-check
// Post-merge check: did the CI run for the merge commit pass?
//
// Ralph's post-merge stage runs after a human merges the feature PR and closes the
// `lifecycle:feature-pr` gate. This script reads `gh run list` for the base branch's
// tip commit and answers one question with an exit code:
//
//   0  passed        every run for the commit concluded successfully
//   1  failed        a run concluded in failure; one P1 escalation bead is filed
//                    carrying the run URL and the failing job (a re-run files nothing)
//   2  inconclusive  no run for the commit on the base branch, a run still on the wait
//                    window, a conclusion that is neither pass nor failure, or a
//                    repository `gh` cannot see as GitHub. Nothing is filed.
//
// The check never retries a run, never re-runs a workflow, and never touches the
// parent bead: a failure is reported to a human, not repaired by the pipeline.
//
// GitHub-only in v1: a remote `gh` cannot resolve to a GitHub repository is
// inconclusive. The repository slug and base branch come from `gh repo view`, never
// from a hardcoded constant, because this ships to arbitrary consuming repos.
//
// Zero dependencies: run with `node post-merge-check.mjs`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

// GH_PATH / BD_PATH env overrides let machines where a binary is not on PATH pin a
// location. git lives beside them conceptually, so GIT_PATH follows the same shape.
const GH_PATH = process.env.GH_PATH || 'gh';
const BD_PATH = process.env.BD_PATH || 'bd';
const GIT_PATH = process.env.GIT_PATH || 'git';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A workflow run as `gh run list --json` reports it.
 * @typedef {object} WorkflowRun
 * @property {number} databaseId
 * @property {string} url
 * @property {string} workflowName
 * @property {string} headBranch
 * @property {string} headSha
 * @property {string} status       `completed` once the run settled
 * @property {string | null} conclusion
 */

/**
 * A job that concluded in failure, as reported in the escalation bead.
 * @typedef {object} FailingJob
 * @property {string} name
 * @property {string} url
 */

/** @typedef {'passed' | 'failed' | 'inconclusive'} Outcome */

/** A child-process call that returns stdout. @typedef {(args: string[]) => Promise<string>} Runner */

/**
 * The one escalation bead a failing run files, and whether this run filed it.
 * @typedef {object} Escalation
 * @property {boolean} filed
 * @property {string} [beadId]    Set when this run created the bead.
 * @property {string} [existing]  Set when a bead for this run was already filed.
 * @property {string} [detail]    Set when the bead could not be filed.
 */

/**
 * The machine-readable result, printed by the CLI and returned to tests.
 * @typedef {object} CheckReport
 * @property {Outcome} outcome
 * @property {number} exitCode
 * @property {string} reason
 * @property {string} base
 * @property {string | null} repository
 * @property {string | null} commit
 * @property {WorkflowRun[]} runs        Runs for the commit on the base branch.
 * @property {string[]} ignoredBranches  Branches with runs for the same commit, not read.
 * @property {FailingJob[]} failingJobs
 * @property {Escalation} escalation
 */

/**
 * Injected collaborators, so a test can drive the check without a GitHub account,
 * a network, or the real bead database.
 * @typedef {object} CheckDeps
 * @property {Runner} [gh]
 * @property {Runner} [bd]
 * @property {Runner} [git]
 */

// ─── Contract ─────────────────────────────────────────────────────────────────

/** Exit codes are the contract: 0 passed, 1 failed, 2 inconclusive.
 * @type {Record<Outcome, number>} */
export const EXIT_CODES = { passed: 0, failed: 1, inconclusive: 2 };

/** The label that keys the escalation search, so a re-run finds the bead it filed. */
export const ESCALATION_LABEL = 'lifecycle:post-merge-escalation';

/** Seconds the check waits for a run to appear and settle before it reports inconclusive. */
export const DEFAULT_WAIT_SECONDS = 300;

/** Used only when `gh` reports no default branch for the repository. */
const DEFAULT_BASE_BRANCH = 'main';

/** Seconds between two `gh run list` calls while a run is still in flight. */
const POLL_INTERVAL_MS = 10_000;

/** Every field the check reads from a run, and nothing else. */
const RUN_FIELDS = 'databaseId,url,workflowName,headBranch,headSha,status,conclusion';

/**
 * Conclusions that mean the commit is good. `skipped` and `neutral` are not failures:
 * this repository's release job is skipped on every non-release run.
 */
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

/**
 * Conclusions that mean the commit is bad. `cancelled`, `stale` and `action_required`
 * are deliberately absent: they report no verdict on the commit, so they are
 * inconclusive rather than a failure a human must be paged for.
 */
const FAILING_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

class UsageError extends Error {}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * @param {WorkflowRun[]} runs
 * @returns {string[]} The distinct conclusions in `runs`, in run order.
 */
function conclusionsOf(runs) {
  return [...new Set(runs.map((run) => run.conclusion ?? 'null'))];
}

/**
 * Classify the runs for one commit. Pure: the exit-code contract is decided here,
 * so the three outcomes are readable in one place.
 *
 * An empty run set is inconclusive, never passed — a commit with no run has not been
 * verified, and reporting that as a pass would hide a broken workflow.
 *
 * @param {WorkflowRun[]} runs  Completed runs for the commit on the base branch.
 * @returns {{ outcome: Outcome, reason: string, failingRuns: WorkflowRun[], conclusions: string[] }}
 */
export function classifyRuns(runs) {
  if (runs.length === 0) {
    return { outcome: 'inconclusive', reason: 'no-run', failingRuns: [], conclusions: [] };
  }

  const failingRuns = runs.filter((run) => FAILING_CONCLUSIONS.has(run.conclusion ?? ''));
  if (failingRuns.length > 0) {
    return { outcome: 'failed', reason: 'run-failed', failingRuns, conclusions: conclusionsOf(runs) };
  }

  const unrecognised = runs.filter((run) => !PASSING_CONCLUSIONS.has(run.conclusion ?? ''));
  if (unrecognised.length > 0) {
    return {
      outcome: 'inconclusive',
      reason: 'unrecognised-conclusion',
      failingRuns: [],
      conclusions: conclusionsOf(unrecognised),
    };
  }

  return { outcome: 'passed', reason: 'runs-passed', failingRuns: [], conclusions: conclusionsOf(runs) };
}

// ─── Runners ──────────────────────────────────────────────────────────────────

/** @type {Runner} */
async function runGh(args) {
  const { stdout } = await execFileAsync(GH_PATH, args, { encoding: 'utf-8' });
  return stdout;
}

/** @type {Runner} */
async function runBd(args) {
  const { stdout } = await execFileAsync(BD_PATH, args, { encoding: 'utf-8' });
  return stdout;
}

/**
 * A git runner bound to one working tree, so the check reads the repository it was
 * pointed at rather than the process's own directory.
 * @param {string} cwd
 * @returns {Runner}
 */
function gitRunner(cwd) {
  return async (args) => {
    const { stdout } = await execFileAsync(GIT_PATH, args, { cwd, encoding: 'utf-8' });
    return stdout;
  };
}

// ─── Repository and commit ────────────────────────────────────────────────────

/**
 * Read the repository slug and its default branch through `gh`, so the check works in
 * any consuming repository instead of assuming one slug and one branch. `gh` resolves
 * the remote itself, which is also the GitHub-only test: a remote it cannot map to a
 * GitHub host exits non-zero.
 *
 * @param {Runner} gh
 * @param {string} [base]  Caller-supplied base branch, overriding the default branch.
 * @returns {Promise<{ nameWithOwner: string, base: string } | null>} null when `gh`
 *          cannot see a GitHub repository.
 */
async function readRepository(gh, base) {
  try {
    const raw = await gh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef']);
    const parsed = JSON.parse(raw);
    const defaultBranch = parsed?.defaultBranchRef?.name;
    return {
      nameWithOwner: typeof parsed?.nameWithOwner === 'string' ? parsed.nameWithOwner : '',
      base: base ?? (typeof defaultBranch === 'string' && defaultBranch !== '' ? defaultBranch : DEFAULT_BASE_BRANCH),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the full SHA of the merge commit. `gh run list --commit` matches on the full
 * SHA and returns nothing for a short revision, so every caller-supplied revision is
 * expanded through git before it reaches gh.
 *
 * The fetch is what makes the check read the merge that just landed rather than a stale
 * local ref. A failed fetch is not fatal: the local ref still resolves, and the report
 * carries `fetchFailed`.
 *
 * @param {Runner} git
 * @param {{ commit?: string, base: string, fetch: boolean }} options
 * @returns {Promise<{ sha: string, fetchFailed: boolean } | null>} null when no revision
 *          resolves to a commit.
 */
async function resolveCommit(git, { commit, base, fetch }) {
  let fetchFailed = false;
  if (fetch) {
    try {
      await git(['fetch', '--quiet', 'origin', base]);
    } catch {
      fetchFailed = true;
    }
  }

  const revisions = commit === undefined ? [`origin/${base}`, base] : [commit];
  for (const revision of revisions) {
    try {
      const sha = (await git(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])).trim();
      if (sha !== '') return { sha, fetchFailed };
    } catch {
      // Try the next candidate revision.
    }
  }
  return null;
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

/**
 * @param {Runner} gh
 * @param {string} sha
 * @returns {Promise<WorkflowRun[]>}
 */
async function listRuns(gh, sha) {
  const raw = await gh(['run', 'list', '--commit', sha, '--limit', '30', '--json', RUN_FIELDS]);
  const parsed = raw.trim() === '' ? [] : JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * @param {WorkflowRun} run
 * @returns {boolean}
 */
function isSettled(run) {
  return run.status === 'completed';
}

/**
 * Wait for a run to appear for the commit on the base branch and to settle. Runs for
 * other branches are ignored: a `pull_request` run on a release branch shares no
 * verdict about the base branch, and gh keeps no such run for a merged commit.
 *
 * @param {object} options
 * @param {Runner} options.gh
 * @param {string} options.sha
 * @param {string} options.base
 * @param {number} options.waitSeconds  `0` checks once instead of polling.
 * @returns {Promise<{ runs: WorkflowRun[], ignoredBranches: string[], reason: string }>}
 */
async function awaitRuns({ gh, sha, base, waitSeconds }) {
  const deadline = Date.now() + waitSeconds * 1000;

  for (;;) {
    const all = await listRuns(gh, sha);
    const runs = all.filter((run) => run.headBranch === base);
    const ignoredBranches = [
      ...new Set(all.filter((run) => run.headBranch !== base).map((run) => run.headBranch)),
    ];

    if (runs.length > 0 && runs.every(isSettled)) {
      return { runs, ignoredBranches, reason: 'settled' };
    }

    if (Date.now() >= deadline) {
      return { runs, ignoredBranches, reason: runs.length === 0 ? 'no-run' : 'still-running' };
    }

    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, deadline - Date.now())));
  }
}

/**
 * Read the jobs of a failing run and keep the ones that concluded in failure.
 * @param {Runner} gh
 * @param {WorkflowRun} run
 * @returns {Promise<FailingJob[]>}
 */
async function readFailingJobs(gh, run) {
  const raw = await gh(['run', 'view', String(run.databaseId), '--json', 'jobs']);
  const parsed = JSON.parse(raw);
  /** @type {Array<{ name?: unknown, url?: unknown, conclusion?: unknown }>} */
  const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  return jobs
    .filter((job) => FAILING_CONCLUSIONS.has(typeof job.conclusion === 'string' ? job.conclusion : ''))
    .map((job) => ({
      name: typeof job.name === 'string' ? job.name : 'unnamed job',
      url: typeof job.url === 'string' ? job.url : run.url,
    }));
}

// ─── Escalation ───────────────────────────────────────────────────────────────

/**
 * The marker that keeps escalation filing from paging the same human twice for one run: every
 * escalation bead carries it in its description, so a second run of the check finds the bead and
 * files nothing. A run id is immutable, so one bead per run is the intent; `bd list` omits closed
 * beads, so the guarantee is one **open** bead per run and a resolved run can be escalated again.
 * See `findFiledEscalation` for the limit this leaves.
 * @param {WorkflowRun} run
 * @returns {string}
 */
export function runMarker(run) {
  return `post-merge-run:${run.databaseId}`;
}

/**
 * @param {WorkflowRun} run
 * @param {string} commit
 * @param {string} base
 * @returns {string}
 */
function escalationTitle(run, commit, base) {
  return `[post-merge] ${run.workflowName || 'workflow'} failed for ${commit.slice(0, 7)} on ${base}`;
}

/**
 * @param {object} input
 * @param {WorkflowRun} input.run
 * @param {FailingJob[]} input.jobs
 * @param {string} input.commit
 * @param {string} input.base
 * @returns {string}
 */
function escalationDescription({ run, jobs, commit, base }) {
  const failingJobs =
    jobs.length > 0
      ? jobs.map((job) => `- Failing job: ${job.name} — ${job.url}`).join('\n')
      : '- Failing job: none reported by the run';

  return [
    `The CI run for merge commit ${commit} on ${base} concluded \`${run.conclusion ?? 'unknown'}\`.`,
    '',
    `- Workflow: ${run.workflowName || 'workflow'} (run ${run.databaseId})`,
    `- Run: ${run.url}`,
    failingJobs,
    '',
    runMarker(run),
    '',
    '## Steps to Reproduce',
    '',
    `1. Open ${run.url} and read the failing job log.`,
    `2. Check out ${commit} and run the failing job's commands locally.`,
    '',
    '## Acceptance Criteria',
    '',
    `- [ ] The failing job is green on a later commit of ${base}, or the merge is reverted.`,
    '- [ ] This bead is closed by the human who resolved it.',
  ].join('\n');
}

/**
 * Find an **open** escalation this check already filed for the run.
 *
 * `bd list` omits closed beads, so a bead a human already resolved is not found and a later check
 * of the same run files a fresh one. That repeats a signal for a run someone closed; it never
 * loses one. Tracked as a known limitation — do not read this as one bead per run forever.
 * @param {Runner} bd
 * @param {string} marker
 * @returns {Promise<string | null>} The bead id, or null when nothing was filed yet.
 */
async function findFiledEscalation(bd, marker) {
  const raw = await bd(['list', '--json', '--limit', '0', '-l', ESCALATION_LABEL]);
  const beads = raw.trim() === '' ? [] : JSON.parse(raw);
  const filed = (Array.isArray(beads) ? beads : []).find(
    (bead) => typeof bead?.description === 'string' && bead.description.includes(marker),
  );
  return filed ? String(filed.id) : null;
}

/**
 * File the P1 escalation bead for a failed run — at most one **open** bead per run, whatever the
 * number of check invocations. A bead a human has closed is not found again, so this can repeat
 * an escalation for a run already resolved (see `findFiledEscalation`). The bead is independent:
 * it carries no parent, so the feature bead is never reopened and never gains a child.
 *
 * @param {object} input
 * @param {Runner} input.bd
 * @param {WorkflowRun} input.run
 * @param {FailingJob[]} input.jobs
 * @param {string} input.commit
 * @param {string} input.base
 * @returns {Promise<Escalation>}
 */
export async function fileEscalation({ bd, run, jobs, commit, base }) {
  const existing = await findFiledEscalation(bd, runMarker(run));
  if (existing !== null) return { filed: false, existing };

  try {
    const beadId = (
      await bd([
        'create',
        escalationTitle(run, commit, base),
        '--type', 'bug',
        '--priority', '1',
        '--description', escalationDescription({ run, jobs, commit, base }),
        '--labels', `execution:hitl,${ESCALATION_LABEL}`,
        // The bead is human-owned, so it never inherits an executor label from a parent.
        '--no-inherit-labels',
        '--validate',
        '--silent',
      ])
    ).trim();
    return { filed: true, beadId };
  } catch (error) {
    return { filed: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

// ─── Check ────────────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {string} input.outcome
 * @param {string} input.reason
 * @param {Partial<CheckReport>} [input.rest]
 * @returns {CheckReport}
 */
function buildReport({ outcome, reason, rest = {} }) {
  /** @type {Outcome} */
  const settled = outcome === 'passed' || outcome === 'failed' ? outcome : 'inconclusive';
  return {
    outcome: settled,
    exitCode: EXIT_CODES[settled],
    reason,
    base: DEFAULT_BASE_BRANCH,
    repository: null,
    commit: null,
    runs: [],
    ignoredBranches: [],
    failingJobs: [],
    escalation: { filed: false },
    ...rest,
  };
}

/**
 * Run the check and return its report. Every expected failure — no repository, no run,
 * a run still in flight — is a report, not a thrown error.
 *
 * @param {object} input
 * @param {string} input.cwd     Directory of the repository checkout to read.
 * @param {string} [input.base]  Base branch; the repository default when omitted.
 * @param {string} [input.commit] Merge commit; the base branch tip when omitted.
 * @param {number} [input.waitSeconds]
 * @param {boolean} [input.fetch] Fetch the base branch before resolving it. Default true.
 * @param {CheckDeps} [input.deps]
 * @returns {Promise<CheckReport>}
 */
export async function checkPostMerge({
  cwd,
  base,
  commit,
  waitSeconds = DEFAULT_WAIT_SECONDS,
  fetch = true,
  deps = {},
}) {
  const gh = deps.gh ?? runGh;
  const bd = deps.bd ?? runBd;
  const git = deps.git ?? gitRunner(cwd);

  const repository = await readRepository(gh, base);
  if (repository === null) {
    return buildReport({
      outcome: 'inconclusive',
      reason: 'no-github-repository',
      rest: { base: base ?? DEFAULT_BASE_BRANCH },
    });
  }

  const resolved = await resolveCommit(git, { commit, base: repository.base, fetch });
  if (resolved === null) {
    return buildReport({
      outcome: 'inconclusive',
      reason: 'unresolved-commit',
      rest: { base: repository.base, repository: repository.nameWithOwner },
    });
  }

  const sha = resolved.sha;
  const baseReport = { base: repository.base, repository: repository.nameWithOwner, commit: sha };

  let settled;
  try {
    settled = await awaitRuns({ gh, sha, base: repository.base, waitSeconds });
  } catch (error) {
    return buildReport({
      outcome: 'inconclusive',
      reason: 'gh-failed',
      rest: { ...baseReport, escalation: { filed: false, detail: error instanceof Error ? error.message : String(error) } },
    });
  }

  const { runs, ignoredBranches } = settled;

  if (settled.reason !== 'settled') {
    return buildReport({
      outcome: 'inconclusive',
      reason: settled.reason,
      rest: { ...baseReport, runs, ignoredBranches },
    });
  }

  const classification = classifyRuns(runs);
  const runsReport = { ...baseReport, runs, ignoredBranches };

  if (classification.outcome !== 'failed') {
    return buildReport({
      outcome: classification.outcome,
      reason: classification.reason,
      rest: runsReport,
    });
  }

  // One escalation per failing run, keyed on the first failing run's id. The check
  // reports every failing run, and files for the first so a repeated run converges.
  const failingRun = classification.failingRuns[0];
  const jobs = await readFailingJobs(gh, failingRun).catch(() => []);
  const escalation = await fileEscalation({ bd, run: failingRun, jobs, commit: sha, base: repository.base });

  return buildReport({
    outcome: 'failed',
    reason: classification.reason,
    rest: { ...runsReport, failingJobs: jobs, escalation },
  });
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node post-merge-check.mjs [--base <branch>] [--commit <sha>] [--wait <seconds>] [--no-fetch]

Checks the CI runs for the base branch's merge commit and prints a JSON report.

Exit codes: 0 passed, 1 failed (one P1 escalation bead is filed), 2 inconclusive.

  --base <branch>     base branch; the repository's default branch when omitted
  --commit <sha>      commit to check; the base branch tip when omitted
  --wait <seconds>    how long to wait for a run to appear and settle (default ${DEFAULT_WAIT_SECONDS});
                      --wait 0 checks once
  --no-fetch          read the local base branch ref instead of fetching it first
`;

/**
 * @typedef {object} CliOptions
 * @property {string} [base]
 * @property {string} [commit]
 * @property {number} [waitSeconds]
 * @property {boolean} fetch
 */

/**
 * @param {string[]} argv
 * @returns {CliOptions}
 */
function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = { fetch: true };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--base' && argv[i + 1] !== undefined) { options.base = argv[++i]; }
    else if (arg === '--commit' && argv[i + 1] !== undefined) { options.commit = argv[++i]; }
    else if (arg === '--wait' && argv[i + 1] !== undefined) { options.waitSeconds = Number(argv[++i]); }
    else if (arg === '--no-fetch') { options.fetch = false; }
    else { throw new UsageError(`unexpected argument: ${arg}`); }
  }

  if (options.waitSeconds !== undefined && !Number.isFinite(options.waitSeconds)) {
    throw new UsageError('--wait needs a number of seconds');
  }
  return options;
}

/**
 * @param {object} options
 * @param {string[]} options.argv                              CLI arguments (without node/script).
 * @param {string} [options.cwd]                              Repository checkout to read.
 * @param {(chunk: string) => void} [options.write]           stdout sink; injectable for tests.
 * @param {CheckDeps} [options.deps]                          Collaborators; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({ argv, cwd = process.cwd(), write = (chunk) => process.stdout.write(chunk), deps = {} }) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return 0;
  }

  const { base, commit, waitSeconds, fetch } = parseArgs(argv);
  const report = await checkPostMerge({ cwd, base, commit, waitSeconds, fetch, deps });
  write(`${JSON.stringify(report, null, 2)}\n`);
  return report.exitCode;
}

// Only run the CLI when invoked directly, so tests can import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      // A check that never reached a verdict is inconclusive, never a pass and never a
      // failure a human must be paged for.
      process.exitCode = EXIT_CODES.inconclusive;
    });
}
