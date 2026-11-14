// @ts-check
// The one writer for the bead trail: append a stage checkpoint to a bead's notes and
// record the refs it names as provenance events.
//
// The bead trail is the recovery contract: a fresh session must resume from
// `bd show <id>` alone. Every entry therefore carries the three mandatory fields in a
// fixed shape — Outcome, Evidence, What is left — so a reader greps one line each
// instead of parsing prose.
//
// Zero dependencies. Run:
//
//   node trail-entry.mjs --bead <id> --stage <stage> --outcome <done|blocked|partial> \
//     --evidence "<test or lint result, commit, command output>" \
//     --remaining "<what is left>" [--commit <ref>] [--branch <name>] [--pr <url>] \
//     [--work-id <id>] [--at <rfc3339>] [--cwd <dir>] [--json]
//
// Full SHA. `bd provenance record --ref-kind git-sha` rejects anything that is not 40
// lowercase hex, so a caller-supplied commit ref is resolved through `git rev-parse`
// and validated before anything is recorded. A resolution failure records nothing.
//
// Bounded retry. embeddeddolt serialises writers, so a concurrent ralph loop makes a
// write fail with `failed to open database ... context canceled`. Every bd call is one
// short-lived process, never a lock held across a long operation, and a transient
// failure is retried with bounded backoff. A retried note append re-reads the bead
// first, so a write that landed before its call reported failure is never duplicated.
//
// Idempotent. The entry text carries a fingerprint of its own content, so a double
// fire finds it already present and appends nothing. Provenance recording is
// idempotent in bd itself: the event id is computed from source:issue:kind:ref, so
// re-recording the same event is a no-op.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

// ─── Contract ─────────────────────────────────────────────────────────────────

/** The three accepted outcomes. The trail says what happened, not how it felt. @typedef {'done' | 'blocked' | 'partial'} Outcome */

/** @type {readonly Outcome[]} */
export const OUTCOMES = /** @type {const} */ (['done', 'blocked', 'partial']);

/** `--source` on every provenance event this script records. */
export const TRAIL_SOURCE = 'trail-entry';

/** Every ref a trail entry names is recorded as a stage handover. */
export const PROVENANCE_KIND = 'handoff';

/** Default attempts per bd call: the first try plus three retries. */
export const DEFAULT_ATTEMPTS = 4;

/** Default first backoff step, in milliseconds. Doubles on each retry. */
export const DEFAULT_BACKOFF_MS = 100;

/** Default per-call timeout, so a wedged bd process cannot stall a worker forever. */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/** The fingerprint width embedded in each entry. */
const FINGERPRINT_LENGTH = 16;

/**
 * Failure shapes that mean "the database was busy, try again", not "this request is
 * wrong". embeddeddolt serialises writers, so a second ralph loop surfaces the first
 * two shapes routinely.
 */
export const TRANSIENT_PATTERNS = [
  /context canceled/i,
  /failed to open database/i,
  /database is locked/i,
  /could not acquire lock/i,
  /lock acquisition/i,
  /deadlock/i,
  /connection reset by peer/i,
  /connection refused/i,
  /unexpected EOF/i,
  /temporarily unavailable/i,
  /server is shutting down/i,
];

// ─── Types ────────────────────────────────────────────────────────────────────

/** A child-process call that returns stdout. @typedef {(args: string[]) => Promise<string>} Runner */

/**
 * Refs the caller names, already resolved to the value provenance stores.
 * @typedef {object} ResolvedRefs
 * @property {string} [commit]  Full 40-character lowercase SHA
 * @property {string} [branch]
 * @property {string} [pr]      Full URL
 * @property {string} [workId]
 */

/** A ref as `bd provenance record` takes it.
 * @typedef {object} ProvenanceRef
 * @property {'git-sha' | 'branch' | 'pr' | 'work-id'} refKind
 * @property {string} ref
 */

/**
 * Injected collaborators, so a test drives the script without a real bead database.
 * @typedef {object} TrailDeps
 * @property {Runner} [bd]
 * @property {Runner} [git]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

/**
 * What the run did, printed by the CLI and returned to tests.
 * @typedef {object} TrailReport
 * @property {string} bead
 * @property {string} stage
 * @property {Outcome} outcome
 * @property {string} fingerprint
 * @property {boolean} recorded         False when an identical entry was already present.
 * @property {string} entry             The note text, appended or found.
 * @property {ProvenanceRef[]} provenance  Events recorded on this run.
 * @property {number} attempts           Total bd attempts spent on the note append.
 */

/** A usage mistake: the caller asked for something malformed. Exit code 2. */
export class UsageError extends Error {}

/** A bd or git call that failed for good. Exit code 1. */
export class TrailError extends Error {
  /** @param {string} message @param {{ step: string, attempts: number }} detail */
  constructor(message, { step, attempts }) {
    super(message);
    this.name = 'TrailError';
    this.step = step;
    this.attempts = attempts;
  }
}

// ─── Value helpers ────────────────────────────────────────────────────────────

/** Read a non-negative integer from the environment, falling back to `fallback`.
 * @param {string} name @param {number} fallback @returns {number} */
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

/** The full message of a thrown error, including a child process's stderr.
 * @param {unknown} error @returns {string} */
export function errorMessage(error) {
  if (typeof error !== 'object' || error === null) return String(error);
  const parts = [];
  for (const key of /** @type {const} */ (['message', 'stderr'])) {
    const value = /** @type {Record<string, unknown>} */ (error)[key];
    if (typeof value === 'string' && value.trim() !== '') parts.push(value.trim());
  }
  return parts.join(': ');
}

/** Is this failure worth retrying? @param {string} message @returns {boolean} */
export function isTransient(message) {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

/** Collapse a value onto one line, so a field never breaks the entry's shape.
 * @param {string} value @returns {string} */
export function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/** The default backoff wait. @param {number} ms @returns {Promise<void>} */
const defaultSleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

// ─── Runners ──────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

// BD_PATH / GIT_PATH env overrides let machines where a binary is not on PATH pin a
// location. Nothing here names a repository, a branch or a host.
const BD_PATH = process.env.BD_PATH || 'bd';
const GIT_PATH = process.env.GIT_PATH || 'git';

/**
 * Build a runner for one binary. argv arrays only — never a shell string, so a value
 * carrying spaces or quotes reaches the binary unmangled.
 * @param {string} bin @param {string} cwd @returns {Runner}
 */
export function makeRunner(bin, cwd) {
  return async (args) => {
    const { stdout } = await execFileAsync(bin, args, {
      cwd,
      encoding: 'utf-8',
      timeout: envInt('TRAIL_ENTRY_CALL_TIMEOUT_MS', DEFAULT_CALL_TIMEOUT_MS),
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  };
}

// ─── Retry ────────────────────────────────────────────────────────────────────

/**
 * Run one step, retrying only a transient failure, with bounded backoff.
 *
 * `run` is replayed from the top on every attempt, so a caller that must not repeat a
 * side effect makes `run` itself detect whether the side effect already landed.
 *
 * @template T
 * @param {object} options
 * @param {string} options.step                                   Human-readable label for errors.
 * @param {() => Promise<T>} options.run
 * @param {number} options.attempts
 * @param {number} options.backoffMs
 * @param {(ms: number) => Promise<void>} options.sleep
 * @param {(attempt: number, message: string, waitMs: number) => void} [options.onRetry]
 * @returns {Promise<{ value: T, attempts: number }>}
 */
export async function withRetry({ step, run, attempts, backoffMs, sleep, onRetry }) {
  const limit = Math.max(1, attempts);
  /** @type {unknown} */
  let lastError;
  let spent = 0;

  for (let attempt = 1; attempt <= limit; attempt++) {
    spent = attempt;
    try {
      return { value: await run(), attempts: attempt };
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      const retriable = isTransient(message);
      if (!retriable || attempt === limit) {
        const why = retriable ? `gave up after ${attempt} attempt(s)` : 'failed and is not transient';
        throw new TrailError(`${step} ${why}: ${message}`, { step, attempts: attempt });
      }
      const waitMs = backoffMs * 2 ** (attempt - 1);
      onRetry?.(attempt, message, waitMs);
      await sleep(waitMs);
    }
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new TrailError(`${step} failed: ${errorMessage(lastError)}`, { step, attempts: spent });
}

// ─── Refs ─────────────────────────────────────────────────────────────────────

/** 40 lowercase hex characters, exactly what `--ref-kind git-sha` accepts. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/** A provenance `pr` ref must be a whole URL, not a number or a path. */
const FULL_URL = /^https?:\/\/\S+$/;

/**
 * Resolve a git ref to the full 40-character lowercase SHA.
 *
 * A short SHA, a branch name and `HEAD` all reach the same full value. Anything that
 * does not resolve to 40 lowercase hex characters is rejected before a single bead is
 * touched, because `bd provenance record --ref-kind git-sha` refuses it.
 *
 * @param {object} options
 * @param {string} options.ref
 * @param {Runner} options.git
 * @returns {Promise<string>}
 */
export async function resolveCommitSha({ ref, git }) {
  const stdout = await withRetry({
    step: `git rev-parse ${ref}`,
    run: () => git(['rev-parse', '--verify', `${ref}^{commit}`]),
    attempts: 1,
    backoffMs: 0,
    sleep: defaultSleep,
  }).then(({ value }) => value);

  const sha = stdout.trim();
  if (!FULL_SHA.test(sha)) {
    throw new TrailError(
      `git rev-parse ${ref} did not resolve to a 40-character lowercase SHA (got ${JSON.stringify(sha)})`,
      { step: 'git rev-parse', attempts: 1 },
    );
  }
  return sha;
}

/**
 * One provenance ref per supplied field, in a stable order.
 * @param {ResolvedRefs} refs @returns {ProvenanceRef[]}
 */
export function provenanceRefs(refs) {
  /** @type {ProvenanceRef[]} */
  const out = [];
  if (refs.commit !== undefined) out.push({ refKind: 'git-sha', ref: refs.commit });
  if (refs.branch !== undefined) out.push({ refKind: 'branch', ref: refs.branch });
  if (refs.pr !== undefined) out.push({ refKind: 'pr', ref: refs.pr });
  if (refs.workId !== undefined) out.push({ refKind: 'work-id', ref: refs.workId });
  return out;
}

// ─── Entry ────────────────────────────────────────────────────────────────────

/**
 * A stable id for one transition: the same fields fired twice are the same entry.
 * @param {object} input
 * @param {string} input.beadId
 * @param {string} input.stage
 * @param {Outcome} input.outcome
 * @param {string} input.evidence
 * @param {string} input.remaining
 * @param {ResolvedRefs} input.refs
 * @returns {string}
 */
export function fingerprintEntry({ beadId, stage, outcome, evidence, remaining, refs }) {
  const key = [
    beadId,
    stage,
    outcome,
    evidence,
    remaining,
    refs.commit ?? '',
    refs.branch ?? '',
    refs.pr ?? '',
    refs.workId ?? '',
  ].join('\u0000');
  return createHash('sha256').update(key).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

/**
 * The note text for one entry: a timestamped header carrying the fingerprint, then the
 * three mandatory fields, then the refs when the caller named any.
 * @param {object} input
 * @param {string} input.at
 * @param {string} input.stage
 * @param {Outcome} input.outcome
 * @param {string} input.evidence
 * @param {string} input.remaining
 * @param {ResolvedRefs} input.refs
 * @param {string} input.fingerprint
 * @returns {string}
 */
export function buildEntry({ at, stage, outcome, evidence, remaining, refs, fingerprint }) {
  const lines = [
    `[${at}] [${stage}] trail:${fingerprint}`,
    `Outcome: ${outcome}`,
    `Evidence: ${oneLine(evidence)}`,
    `What is left: ${oneLine(remaining)}`,
  ];

  const refLine = provenanceRefs(refs)
    .map(({ refKind, ref }) => `${refKind}:${ref}`)
    .join(', ');
  if (refLine !== '') lines.push(`Refs: ${refLine}`);

  return lines.join('\n');
}

/**
 * The notes a bead already carries. `bd show <id> --json` prints a one-element array;
 * a bare object is accepted too, because the shape is bd's to change.
 * @param {object} options
 * @param {string} options.beadId
 * @param {Runner} options.bd
 * @returns {Promise<string>}
 */
export async function readNotes({ beadId, bd }) {
  const stdout = await bd(['show', beadId, '--json']);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new TrailError(`bd show ${beadId} --json did not print JSON`, { step: 'bd show', attempts: 1 });
  }
  const bead = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof bead !== 'object' || bead === null) {
    throw new TrailError(`bd show ${beadId} --json printed no bead`, { step: 'bd show', attempts: 1 });
  }
  const notes = /** @type {{ notes?: unknown }} */ (bead).notes;
  return typeof notes === 'string' ? notes : '';
}

/**
 * Validate the fields a caller supplies, so a malformed entry is rejected before any bd
 * call rather than written in a shape no reader expects.
 * @param {object} input
 * @param {string} input.beadId
 * @param {string} input.stage
 * @param {string} input.outcome
 * @param {string} input.evidence
 * @param {string} input.remaining
 * @param {{ commit?: string, branch?: string, pr?: string, workId?: string }} input.refs
 * @returns {{ outcome: Outcome, evidence: string, remaining: string }}
 */
export function validateFields({ beadId, stage, outcome, evidence, remaining, refs }) {
  if (beadId.trim() === '') throw new UsageError('--bead is required');
  if (stage.trim() === '') throw new UsageError('--stage is required');
  if (!OUTCOMES.includes(/** @type {Outcome} */ (outcome))) {
    throw new UsageError(`--outcome must be one of ${OUTCOMES.join('|')} (got ${JSON.stringify(outcome)})`);
  }
  if (oneLine(evidence) === '') throw new UsageError('--evidence is required: a test or lint result, a commit, or command output');
  if (oneLine(remaining) === '') throw new UsageError('--remaining is required: say what is left, or "none"');
  if (refs.pr !== undefined && !FULL_URL.test(refs.pr)) {
    throw new UsageError(`--pr must be a full URL (got ${JSON.stringify(refs.pr)})`);
  }
  for (const [flag, value] of /** @type {const} */ ([
    ['--branch', refs.branch],
    ['--work-id', refs.workId],
  ])) {
    if (value !== undefined && value.trim() === '') throw new UsageError(`${flag} must not be empty`);
  }
  return {
    outcome: /** @type {Outcome} */ (outcome),
    evidence: oneLine(evidence),
    remaining: oneLine(remaining),
  };
}

// ─── Record ───────────────────────────────────────────────────────────────────

/**
 * Append one trail entry and record its refs.
 *
 * The note is written before provenance: the note is the recovery contract, so a run
 * that fails between the two leaves a readable trail and a reported error rather than a
 * provenance event pointing at a checkpoint nobody can read.
 *
 * @param {object} input
 * @param {string} input.beadId
 * @param {string} input.stage
 * @param {string} input.outcome
 * @param {string} input.evidence
 * @param {string} input.remaining
 * @param {{ commit?: string, branch?: string, pr?: string, workId?: string }} [input.refs]
 * @param {string} [input.at]     Entry timestamp; defaults to now, UTC.
 * @param {string} [input.cwd]    Directory bd and git read; defaults to the process cwd.
 * @param {TrailDeps} [input.deps]
 * @param {number} [input.attempts]
 * @param {number} [input.backoffMs]
 * @param {(attempt: number, message: string, waitMs: number) => void} [input.onRetry]
 * @returns {Promise<TrailReport>}
 */
export async function recordTrailEntry({
  beadId,
  stage,
  outcome,
  evidence,
  remaining,
  refs = {},
  at = new Date().toISOString(),
  cwd = process.cwd(),
  deps = {},
  attempts = envInt('TRAIL_ENTRY_ATTEMPTS', DEFAULT_ATTEMPTS),
  backoffMs = envInt('TRAIL_ENTRY_BACKOFF_MS', DEFAULT_BACKOFF_MS),
  onRetry,
}) {
  const { outcome: cleanOutcome, evidence: cleanEvidence, remaining: cleanRemaining } = validateFields({
    beadId,
    stage,
    outcome,
    evidence,
    remaining,
    refs,
  });

  const bd = deps.bd ?? makeRunner(BD_PATH, cwd);
  const git = deps.git ?? makeRunner(GIT_PATH, cwd);
  const sleep = deps.sleep ?? defaultSleep;

  /** @type {ResolvedRefs} */
  const resolvedRefs = {
    ...(refs.branch === undefined ? {} : { branch: refs.branch }),
    ...(refs.pr === undefined ? {} : { pr: refs.pr }),
    ...(refs.workId === undefined ? {} : { workId: refs.workId }),
    // A commit ref is resolved before the first bead call: a bad ref must record
    // nothing at all, not a note whose provenance is then refused.
    ...(refs.commit === undefined ? {} : { commit: await resolveCommitSha({ ref: refs.commit, git }) }),
  };

  const fingerprint = fingerprintEntry({
    beadId,
    stage,
    outcome: cleanOutcome,
    evidence: cleanEvidence,
    remaining: cleanRemaining,
    refs: resolvedRefs,
  });
  const entry = buildEntry({
    at,
    stage,
    outcome: cleanOutcome,
    evidence: cleanEvidence,
    remaining: cleanRemaining,
    refs: resolvedRefs,
    fingerprint,
  });
  const marker = `trail:${fingerprint}`;

  // The append is replayed from the top on retry. Reading first means an attempt whose
  // outcome is unknown — the call died after the write landed — is detected instead of
  // appended a second time.
  const note = await withRetry({
    // One step covers the read and the write, because a retry must judge the pair.
    step: `trail append on ${beadId}`,
    attempts,
    backoffMs,
    sleep,
    onRetry,
    run: async () => {
      const notes = await readNotes({ beadId, bd });
      if (notes.includes(marker)) return false;
      await bd(['note', beadId, entry]);
      return true;
    },
  });

  /** @type {ProvenanceRef[]} */
  const provenance = [];
  for (const ref of provenanceRefs(resolvedRefs)) {
    await withRetry({
      step: `bd provenance record ${ref.refKind}:${ref.ref}`,
      attempts,
      backoffMs,
      sleep,
      onRetry,
      run: () => bd([
        'provenance', 'record',
        '--issue', beadId,
        '--kind', PROVENANCE_KIND,
        '--source', TRAIL_SOURCE,
        '--ref-kind', ref.refKind,
        '--ref', ref.ref,
      ]),
    });
    provenance.push(ref);
  }

  return {
    bead: beadId,
    stage,
    outcome: cleanOutcome,
    fingerprint,
    recorded: note.value,
    entry,
    provenance,
    attempts: note.attempts,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node trail-entry.mjs --bead <id> --stage <stage> --outcome <done|blocked|partial> \\
  --evidence "<test or lint result, commit, or command output>" --remaining "<what is left>" \\
  [--commit <ref>] [--branch <name>] [--pr <url>] [--work-id <id>] [--at <rfc3339>] \\
  [--cwd <dir>] [--json]

Appends one checkpoint to the bead's notes and records its refs as provenance events.
The entry carries three mandatory fields — Outcome, Evidence, What is left.
--commit is resolved to a full 40-character lowercase SHA before anything is written.
A transient bd failure is retried; a double fire records nothing twice.

Environment:
  BD_PATH                  bd binary (default: bd)
  GIT_PATH                 git binary (default: git)
  TRAIL_ENTRY_ATTEMPTS     attempts per bd call (default: ${DEFAULT_ATTEMPTS})
  TRAIL_ENTRY_BACKOFF_MS   first backoff step in ms (default: ${DEFAULT_BACKOFF_MS})
  TRAIL_ENTRY_CALL_TIMEOUT_MS  per-call timeout in ms (default: ${DEFAULT_CALL_TIMEOUT_MS})
`;

/**
 * Parse the CLI's argv into `recordTrailEntry` options.
 * @param {string[]} argv @returns {{ beadId: string, stage: string, outcome: string, evidence: string, remaining: string, refs: { commit?: string, branch?: string, pr?: string, workId?: string }, at?: string, cwd: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {{ commit?: string, branch?: string, pr?: string, workId?: string }} */
  const refs = {};
  /** @type {Record<string, string>} */
  const values = {};
  let cwd = process.cwd();
  let json = false;

  const FLAGS = new Map([
    ['--bead', 'bead'],
    ['--stage', 'stage'],
    ['--outcome', 'outcome'],
    ['--evidence', 'evidence'],
    ['--remaining', 'remaining'],
    ['--at', 'at'],
    ['--cwd', 'cwd'],
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') { json = true; continue; }
    if (arg === '--commit') { refs.commit = argv[++i]; continue; }
    if (arg === '--branch') { refs.branch = argv[++i]; continue; }
    if (arg === '--pr') { refs.pr = argv[++i]; continue; }
    if (arg === '--work-id') { refs.workId = argv[++i]; continue; }
    const name = FLAGS.get(arg);
    if (name === undefined) throw new UsageError(`unexpected argument: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new UsageError(`${arg} needs a value`);
    if (name === 'cwd') cwd = value;
    else values[name] = value;
  }

  for (const [flag, name] of /** @type {const} */ ([
    ['--bead', 'bead'],
    ['--stage', 'stage'],
    ['--outcome', 'outcome'],
    ['--evidence', 'evidence'],
    ['--remaining', 'remaining'],
  ])) {
    if (values[name] === undefined) throw new UsageError(`${flag} is required`);
  }
  for (const ref of Object.entries(refs)) {
    if (ref[1] === undefined) throw new UsageError(`--${ref[0]} needs a value`);
  }

  return {
    beadId: values.bead,
    stage: values.stage,
    outcome: values.outcome,
    evidence: values.evidence,
    remaining: values.remaining,
    refs,
    ...(values.at === undefined ? {} : { at: values.at }),
    cwd,
    json,
  };
}

/**
 * @param {object} options
 * @param {string[]} options.argv                              CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]             stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError]        stderr sink; injectable for tests.
 * @param {TrailDeps} [options.deps]                            Collaborators; injectable for tests.
 * @param {(attempt: number, message: string, waitMs: number) => void} [options.onRetry]
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({
  argv,
  write = (chunk) => process.stdout.write(chunk),
  writeError = (chunk) => process.stderr.write(chunk),
  deps = {},
  onRetry,
}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return 0;
  }

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`trail-entry: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }

  try {
    const report = await recordTrailEntry({
      beadId: options.beadId,
      stage: options.stage,
      outcome: options.outcome,
      evidence: options.evidence,
      remaining: options.remaining,
      refs: options.refs,
      cwd: options.cwd,
      deps,
      onRetry,
      ...(options.at === undefined ? {} : { at: options.at }),
    });

    if (options.json) {
      write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      const verb = report.recorded ? 'recorded' : 'already recorded';
      const refs = report.provenance.length === 0
        ? 'no refs'
        : report.provenance.map(({ refKind, ref }) => `${refKind}:${ref}`).join(', ');
      write(`✓ trail entry ${verb} on ${report.bead} (trail:${report.fingerprint}; ${refs})\n`);
    }
    return 0;
  } catch (error) {
    const kind = error instanceof UsageError ? 'usage' : 'failed';
    writeError(`trail-entry ${kind}: ${errorMessage(error)}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

// Only run the CLI when invoked directly, so tests can import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${errorMessage(error)}\n`);
      process.exitCode = 1;
    });
}
