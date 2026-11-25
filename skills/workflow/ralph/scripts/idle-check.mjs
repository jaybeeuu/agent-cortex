// @ts-check
// Idle check: a digest of ready work and stalled beads, for the idle watch.
//
// Ralph's watch polls one command on a backing-off cadence and nudges ralph only when the
// answer changes. This script is that command. It runs two read-only `bd` queries and
// prints one JSON object:
//
//   { "ready":   [ { "id": "…", "priority": 1 } ],
//     "stalled": [ { "id": "…", "status": "in_progress", "quietMinutes": 12, "reason": "quiet" } ] }
//
// Both arrays are sorted by id, so a tracker that reorders its rows is not a change. A
// tick makes no model call and no network call beyond the tracker, and it writes nothing.
//
// Exit codes are the contract: 0 a digest was printed, 1 the tracker could not be read
// (no digest, so the watch stays silent), 2 the arguments were unusable.
//
// Each of the two reads is bounded in wall clock and in bytes: an answer that never comes
// and an answer past the byte ceiling both end as exit 1, so a wedged or a runaway tracker
// cannot hang the tick and cannot leave the watch silently blind either.
//
// A bead is stalled when it is `in_progress` and nobody has shown a sign of life for
// longer than the threshold — its lease, its heartbeat, its own row, or a trail entry.
// An expired lease is stalled immediately, whatever its age, because the lease is bd's
// own statement that the holder is gone.
//
// Zero dependencies: run with `node idle-check.mjs`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One ready bead, reduced to what a watch needs to notice it.
 * @typedef {object} ReadyEntry
 * @property {string} id
 * @property {number} priority
 */

/**
 * One stalled bead. `quietMinutes` is whole minutes since the last sign of life,
 * rounded down, or null when the bead carried no timestamp at all.
 * @typedef {object} StalledEntry
 * @property {string} id
 * @property {string} status
 * @property {number | null} quietMinutes
 * @property {string} reason  `quiet`, `lease-expired` or `no-activity`
 */

/**
 * The whole answer, and the only thing printed on stdout.
 * @typedef {object} Digest
 * @property {ReadyEntry[]} ready
 * @property {StalledEntry[]} stalled
 */

/** A child-process call that returns stdout. @typedef {(args: string[]) => Promise<string>} Runner */

/**
 * Injected collaborators, so a test can drive the check without the real bead database
 * or the real clock.
 * @typedef {object} CheckDeps
 * @property {Runner} [bd]
 */

// ─── Contract ─────────────────────────────────────────────────────────────────

/** Exit codes: 0 digest, 1 tracker unreadable, 2 unusable arguments.
 * @type {Record<'digest' | 'trackerFailed' | 'usageError', number>} */
export const EXIT_CODES = { digest: 0, trackerFailed: 1, usageError: 2 };

/**
 * The documented readiness query: ralph's own queue. A bead that is not ready for an
 * `execution:afk` agent is not work waiting, so it never enters the digest.
 */
export const READY_LABEL = 'execution:afk';

/**
 * Minutes of silence after which an in-progress bead is reported as stalled. Five, not
 * thirty: a worker silent for longer than a few minutes is more likely dead than busy,
 * and shortening exactly that silence is what the check is for.
 */
export const DEFAULT_STALL_MINUTES = 5;

/** The environment variable that overrides the threshold; `--stall-minutes` wins over it. */
export const STALL_MINUTES_ENV = 'AGENT_CORTEX_IDLE_STALL_MINUTES';

/** Rows read per query by default. A tick must stay cheap however long the backlog is. */
export const DEFAULT_LIMIT = 500;

/**
 * Wall-clock bound for one tracker read. A wedged `bd` would otherwise leave the read
 * running forever, and a watch whose command never exits has no exit code to report, so
 * the whole exit-code contract goes silent with it.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 30_000;

/**
 * Byte ceiling for one tracker answer. The readiness read asks for `--brief`, but the
 * in-progress read cannot: the stall rule needs each row's notes, so a busy tracker
 * returns tens of kilobytes per row and the child process default of 1 MiB is reachable.
 */
export const DEFAULT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** Environment override for the per-call wall-clock bound, documented in `--help`. */
export const CALL_TIMEOUT_ENV = 'AGENT_CORTEX_IDLE_BD_TIMEOUT_MS';

/** Environment override for the per-call byte ceiling, documented in `--help`. */
export const MAX_BUFFER_ENV = 'AGENT_CORTEX_IDLE_BD_MAX_BUFFER_BYTES';

/** bd's priority for a bead that carries none. */
const DEFAULT_PRIORITY = 2;

/**
 * A trail entry: `bd note` prefixes each append with an ISO-8601 instant in square
 * brackets, and every such marker in `notes` is a sign of life.
 */
const TRAIL_MARKER = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\]/g;

/** The closed vocabulary of stall reasons. */
const STALL_REASONS = /** @type {const} */ ({
  quiet: 'quiet',
  leaseExpired: 'lease-expired',
  noActivity: 'no-activity',
});

class UsageError extends Error {}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/**
 * A row's non-empty string field, or null when absent or not a string.
 * @param {Record<string, unknown>} row
 * @param {string} key
 * @returns {string | null}
 */
export function textOf(row, key) {
  const value = row[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A row's numeric field, or null when absent or not a finite number.
 * @param {Record<string, unknown>} row
 * @param {string} key
 * @returns {number | null}
 */
function numberOf(row, key) {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A timestamp field as epoch milliseconds, or null when absent or unparseable.
 * @param {Record<string, unknown>} row
 * @param {string} key
 * @returns {number | null}
 */
function instantOf(row, key) {
  return instantFrom(textOf(row, key));
}

/**
 * @param {string | null} value
 * @returns {number | null}
 */
function instantFrom(value) {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse `bd --json` output into rows. A payload that is not a JSON array of objects means
 * the tracker could not be read, which the caller reports rather than digesting.
 * @param {string} raw
 * @returns {Record<string, unknown>[]}
 */
export function parseRows(raw) {
  if (raw.trim() === '') return [];
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('bd returned output that is not JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('bd returned a JSON value that is not an array');
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (const row of parsed) {
    if (typeof row === 'object' && row !== null) rows.push(/** @type {Record<string, unknown>} */ (row));
  }
  return rows;
}

// ─── Stalls ───────────────────────────────────────────────────────────────────

/**
 * The latest sign of life a bead carries: its heartbeat, its claim, its own row, its
 * creation, or the last trail entry in `notes`. The maximum is the honest answer to
 * "when did anyone last touch this?" — a worker that appends a note without beating is
 * alive, and so is one that beats without writing a note.
 * @param {Record<string, unknown>} row
 * @returns {number | null} epoch milliseconds, or null when the row carries no timestamp
 */
export function lastSignOfLife(row) {
  /** @type {number[]} */
  const candidates = [
    instantOf(row, 'heartbeat_at'),
    instantOf(row, 'started_at'),
    instantOf(row, 'updated_at'),
    instantOf(row, 'created_at'),
  ].filter((value) => value !== null);
  const notes = textOf(row, 'notes');
  if (notes !== null) {
    for (const match of notes.matchAll(TRAIL_MARKER)) {
      const parsed = instantFrom(match[1] ?? null);
      if (parsed !== null) candidates.push(parsed);
    }
  }
  return candidates.length === 0 ? null : Math.max(...candidates);
}

/**
 * Whole minutes, rounded down, of a duration in milliseconds. Display data only: the
 * stall decision never runs on a rounded value.
 * @param {number} milliseconds
 * @returns {number}
 */
function wholeMinutes(milliseconds) {
  return Math.floor(milliseconds / 60_000);
}

/**
 * Milliseconds since the last sign of life, clamped at zero, or null when there is none.
 * The stall decision compares this against the threshold exactly: flooring to whole
 * minutes first would make the threshold fire on the next whole-minute boundary, up to a
 * minute late.
 * @param {Record<string, unknown>} row
 * @param {Date} now
 * @returns {number | null}
 */
export function quietMillisecondsOf(row, now) {
  const last = lastSignOfLife(row);
  if (last === null) return null;
  return Math.max(0, now.getTime() - last);
}

/**
 * Whole minutes since the last sign of life, rounded down, or null when there is none.
 * @param {Record<string, unknown>} row
 * @param {Date} now
 * @returns {number | null}
 */
export function quietMinutesOf(row, now) {
  const quiet = quietMillisecondsOf(row, now);
  return quiet === null ? null : wholeMinutes(quiet);
}

/**
 * Decide whether one bead is stalled, and why. Pure: the threshold and the clock are
 * arguments, so the rule is provable without waiting five minutes.
 *
 * An expired lease wins over the threshold: bd's lease is the tracker's own statement
 * that the holder is gone, so the bead is reported before the threshold elapses.
 *
 * @param {Record<string, unknown>} row  A bead as `bd list --json` reports it.
 * @param {{ thresholdMinutes: number, now: Date }} options
 * @returns {StalledEntry | null}
 */
export function stallOf(row, { thresholdMinutes, now }) {
  const id = textOf(row, 'id');
  const status = textOf(row, 'status');
  // The queries already filter these, but bd's payload is an external boundary: a row
  // that is not in progress cannot be a stalled worker, whatever asked for it.
  if (id === null || status !== 'in_progress') return null;

  const quietMilliseconds = quietMillisecondsOf(row, now);
  const quietMinutes = quietMilliseconds === null ? null : wholeMinutes(quietMilliseconds);
  const leaseExpiry = instantOf(row, 'lease_expires_at');
  if (leaseExpiry !== null && leaseExpiry <= now.getTime()) {
    return { id, status, quietMinutes, reason: STALL_REASONS.leaseExpired };
  }
  if (quietMilliseconds === null) return { id, status, quietMinutes, reason: STALL_REASONS.noActivity };
  // Exactly the threshold is still alive; one millisecond past it is stalled.
  if (quietMilliseconds > thresholdMinutes * 60_000) {
    return { id, status, quietMinutes, reason: STALL_REASONS.quiet };
  }
  return null;
}

// ─── Digest ───────────────────────────────────────────────────────────────────

/**
 * Sort by id, compared as code units. Locale-aware comparison would make the digest
 * depend on the machine's locale, and the digest must not change for that reason.
 * @param {{ id: string }} left
 * @param {{ id: string }} right
 * @returns {number}
 */
function byId(left, right) {
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/**
 * Reduce two tracker queries to the digest. Pure, so both halves of the answer stay
 * separately testable: this function never runs `bd`, and `readTracker` never formats.
 *
 * @param {object} input
 * @param {Record<string, unknown>[]} input.ready      Rows of the readiness query.
 * @param {Record<string, unknown>[]} input.inProgress Rows of the in-progress query.
 * @param {number} input.thresholdMinutes
 * @param {Date} input.now
 * @returns {Digest}
 */
export function buildDigest({ ready, inProgress, thresholdMinutes, now }) {
  /** @type {ReadyEntry[]} */
  const readyEntries = [];
  for (const row of ready) {
    const id = textOf(row, 'id');
    if (id === null) continue;
    readyEntries.push({ id, priority: numberOf(row, 'priority') ?? DEFAULT_PRIORITY });
  }

  /** @type {StalledEntry[]} */
  const stalledEntries = [];
  for (const row of inProgress) {
    const stalled = stallOf(row, { thresholdMinutes, now });
    if (stalled !== null) stalledEntries.push(stalled);
  }

  return { ready: readyEntries.sort(byId), stalled: stalledEntries.sort(byId) };
}

// ─── Tracker ──────────────────────────────────────────────────────────────────

/**
 * An environment value as a positive whole number, or the fallback when it is absent or
 * unusable. An unusable bound keeps the default on purpose: a typo in the environment
 * must not make the watch blind, which is the failure the bound exists to prevent.
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function positiveIntegerFrom(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The bounds one tracker read runs under: an environment override where it is usable, the
 * documented default otherwise. Exported so both bounds are provable without a wedged and
 * without a huge tracker.
 * @param {Record<string, string | undefined>} env
 * @returns {{ timeoutMs: number, maxBuffer: number }}
 */
export function resolveBdLimits(env = process.env) {
  return {
    timeoutMs: positiveIntegerFrom(env, CALL_TIMEOUT_ENV, DEFAULT_CALL_TIMEOUT_MS),
    maxBuffer: positiveIntegerFrom(env, MAX_BUFFER_ENV, DEFAULT_MAX_BUFFER_BYTES),
  };
}

/**
 * Whether a child-process error is the wall-clock bound firing rather than the tracker
 * answering with a failure.
 * @param {unknown} error
 * @returns {boolean}
 */
function isTimeout(error) {
  return error instanceof Error && 'killed' in error && error.killed === true;
}

/**
 * A runner that shells out to the tracker under the resolved bounds. Both a wedged `bd`
 * and a runaway one end as a tracker failure, so the watch stays silent instead of
 * nudging ralph on a half-read tracker.
 * @param {Record<string, string | undefined>} env
 * @returns {Runner}
 */
export function createBdRunner(env = process.env) {
  // BD_PATH lets a machine where `bd` is not on PATH pin a location; tests drive the same
  // seam with a fake binary.
  const binary = env.BD_PATH || 'bd';
  const { timeoutMs, maxBuffer } = resolveBdLimits(env);
  return async (args) => {
    try {
      const { stdout } = await execFileAsync(binary, args, {
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer,
        // The caller's environment view, plus the process environment so the child keeps
        // PATH and anything else the harness exported.
        env: { ...process.env, ...env },
      });
      return stdout;
    } catch (error) {
      // Name the bound that fired: "command failed" alone leaves an operator guessing why
      // the watch went quiet.
      if (isTimeout(error)) throw new Error(`${binary} did not answer within ${timeoutMs} ms`);
      throw error;
    }
  };
}

/**
 * Run the two read-only queries the digest needs. Sequential on purpose: a tick lands on
 * a tracker that other workers are using, and two concurrent `bd` processes cost more
 * than the tens of milliseconds a second round trip takes.
 *
 * @param {{ bd: Runner, limit?: number }} input
 * @returns {Promise<{ ready: Record<string, unknown>[], inProgress: Record<string, unknown>[] }>}
 */
export async function readTracker({ bd, limit = DEFAULT_LIMIT }) {
  // `--brief` keeps the readiness read small: the digest needs only ids and priorities,
  // and the free-form text is the bulk of a bead.
  const ready = parseRows(await bd(['ready', '-l', READY_LABEL, '--json', '--brief', '-n', String(limit)]));
  const inProgress = parseRows(await bd(['list', '-s', 'in_progress', '--json', '-n', String(limit)]));
  return { ready, inProgress };
}

/**
 * Read the tracker and build the digest. Throws when the tracker cannot be read; the CLI
 * turns that into a distinct exit code and prints no digest.
 *
 * @param {object} input
 * @param {CheckDeps} [input.deps]
 * @param {number} [input.thresholdMinutes]
 * @param {number} [input.limit]
 * @param {Date} [input.now]
 * @param {Record<string, string | undefined>} [input.env]
 * @returns {Promise<Digest>}
 */
export async function checkIdle({
  deps = {},
  thresholdMinutes = DEFAULT_STALL_MINUTES,
  limit,
  now = new Date(),
  env = process.env,
}) {
  const bd = deps.bd ?? createBdRunner(env);
  const tracker = await readTracker({ bd, limit });
  return buildDigest({ ...tracker, thresholdMinutes, now });
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node idle-check.mjs [--stall-minutes <minutes>] [--limit <rows>]
Prints the idle digest: the ready ids and the stalled in-progress ids, both sorted.
Exit codes: 0 digest printed, 1 the tracker could not be read (nothing is printed), 2 bad arguments.
  --stall-minutes <minutes>  minutes of silence before a bead counts as stalled
                             (default ${DEFAULT_STALL_MINUTES}; ${STALL_MINUTES_ENV} sets it too)
  --limit <rows>             rows read per query (default ${DEFAULT_LIMIT})
Each of the two queries is bounded:
  ${CALL_TIMEOUT_ENV}
                             per-call timeout in ms (default ${DEFAULT_CALL_TIMEOUT_MS})
  ${MAX_BUFFER_ENV}
                             per-call answer ceiling in bytes (default ${DEFAULT_MAX_BUFFER_BYTES})
  BD_PATH                    the bd binary (default: bd)
An unusable bound keeps its default, so a typo cannot blind the watch.
`;

/**
 * @typedef {object} CliOptions
 * @property {number} thresholdMinutes
 * @property {number} limit
 */

/**
 * Resolve the threshold: the flag wins, then the environment, then the default. Exported
 * so the precedence is provable on its own.
 * @param {{ flag?: string | undefined, env?: string | undefined }} input
 * @returns {number}
 */
export function resolveStallMinutes({ flag, env }) {
  const raw = flag ?? (env !== undefined && env !== '' ? env : undefined);
  if (raw === undefined) return DEFAULT_STALL_MINUTES;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new UsageError(`stall minutes must be a number of minutes, got "${raw}"`);
  }
  return minutes;
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {CliOptions}
 */
function parseArgs(argv, env) {
  /** @type {{ flag?: string, limit?: string }} */
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stall-minutes' && argv[i + 1] !== undefined) raw.flag = argv[++i];
    else if (arg === '--limit' && argv[i + 1] !== undefined) raw.limit = argv[++i];
    else throw new UsageError(`unexpected argument: ${arg}`);
  }
  const limit = raw.limit === undefined ? DEFAULT_LIMIT : Number(raw.limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new UsageError(`--limit needs a positive whole number of rows, got "${raw.limit}"`);
  }
  return { thresholdMinutes: resolveStallMinutes({ flag: raw.flag, env: env[STALL_MINUTES_ENV] }), limit };
}

/**
 * @param {object} input
 * @param {string[]} input.argv                                  CLI arguments (without node/script).
 * @param {(chunk: string) => void} [input.write]                stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [input.writeError]           stderr sink; injectable for tests.
 * @param {CheckDeps} [input.deps]                               Collaborators; injectable for tests.
 * @param {Date} [input.now]                                     Clock; injectable for tests.
 * @param {Record<string, string | undefined>} [input.env]       Environment; process.env by default.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({
  argv,
  write = (chunk) => process.stdout.write(chunk),
  writeError = (chunk) => process.stderr.write(chunk),
  deps = {},
  now = new Date(),
  env = process.env,
}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return EXIT_CODES.digest;
  }

  /** @type {CliOptions} */
  let options;
  try {
    options = parseArgs(argv, env);
  } catch (error) {
    // Unusable arguments are a caller mistake, not a tracker failure: a watch must not
    // read this as "the tracker is down" and back off for the wrong reason.
    writeError(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_CODES.usageError;
  }

  try {
    const digest = await checkIdle({
      deps,
      thresholdMinutes: options.thresholdMinutes,
      limit: options.limit,
      now,
      env,
    });
    write(`${JSON.stringify(digest, null, 2)}\n`);
    return EXIT_CODES.digest;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    // No digest at all: an unreadable tracker is not an empty queue, and a watch that
    // nudged on it would wake ralph to look at nothing.
    return EXIT_CODES.trackerFailed;
  }
}

// Only run the CLI when invoked directly, so tests can import the module.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = EXIT_CODES.trackerFailed;
    });
}
