// @ts-check
// The dispatch set: which workers are in flight, derived from beads alone.
//
// Ralph dispatches by claiming a bead and appending one dispatch record to that bead's
// trail, so the in-flight set is a query over the tracker rather than a file beside it.
// This script is that query. It runs one read-only `bd list` and prints one JSON object:
//
//   { "inflight": [ { "id": "…", "kind": "stage", "parentId": "…", "worker": "…",
//                     "liveness": "running", "reason": null, "quietMinutes": 3 } ],
//     "parents":    [ "…" ],
//     "stalled":    [ "…" ],
//     "unrecorded": [ "…" ] }
//
// A bead is in flight when it is `in_progress` and the newest record on its trail is a
// `dispatched:` line. A `completed:` line after it takes the bead back out, which matters
// for a feature or task bead: a decomposition or expansion worker has no chore, so its
// record sits on a bead whose status stays `in_progress` after the worker is done. A stage
// chore needs no completion record — the worker closes it, and a closed bead never reaches
// the query at all.
//
// Liveness is the idle check's stall rule, not a second one: an expired lease, or silence
// past the same threshold, is a dead worker rather than a running one, so a worker that
// died mid-task is a bead a human can find instead of an invisible one. `unrecorded` names
// the other half of that: an in-progress bead with no dispatch record and no worker behind
// it — a claim nothing explains, which is exactly what a stale file used to hide.
//
// Exit codes are the same contract `idle-check.mjs` keeps: 0 a digest was printed, 1 the
// tracker could not be read (nothing is printed), 2 the arguments were unusable.
//
// Zero dependencies: run with `node inflight.mjs`.

import { pathToFileURL } from 'node:url';
import {
  DEFAULT_STALL_MINUTES,
  EXIT_CODES,
  STALL_MINUTES_ENV,
  createBdRunner,
  parseRows,
  quietMinutesOf,
  resolveStallMinutes,
  stallOf,
  textOf,
} from './idle-check.mjs';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One record ralph appended to a bead's trail. The trail is append-only, so the newest
 * record is the last one.
 * @typedef {object} TrailRecord
 * @property {string} at
 * @property {'dispatched' | 'completed'} type
 * @property {string} kind   `stage`, `decompose` or `expand`
 * @property {string} worker The agent or task id the spawn call returned
 * @property {string | null} cwd
 * @property {string | null} session
 */

/**
 * A dispatch record, as `parseDispatch` reports it.
 * @typedef {object} Dispatch
 * @property {string} at
 * @property {string} kind
 * @property {string} worker
 * @property {string | null} cwd
 * @property {string | null} session
 */

/**
 * One worker in flight, with the liveness the stall rule gave it. `reason` and
 * `quietMinutes` are the stall rule's own words, so a dead worker reads the same here as
 * it does in the idle digest.
 * @typedef {object} InflightEntry
 * @property {string} id
 * @property {string} kind
 * @property {string | null} parentId
 * @property {string} worker
 * @property {'running' | 'stalled'} liveness
 * @property {string | null} reason
 * @property {number | null} quietMinutes
 */

/**
 * The whole answer, and the only thing printed on stdout.
 * @typedef {object} Digest
 * @property {InflightEntry[]} inflight   Sorted by id
 * @property {string[]} parents           Parent ids of the workers in flight, sorted
 * @property {string[]} stalled           Ids of the entries that are not alive, sorted
 * @property {string[]} unrecorded        In-progress ids no record and no worker explains, sorted
 */

/** A child-process call that returns stdout. @typedef {(args: string[]) => Promise<string>} BdRunner */

/**
 * Injected collaborators, so a test can drive the query without the real bead database
 * or the real clock.
 * @typedef {object} DigestDeps
 * @property {BdRunner} [bd]
 */

// ─── Contract ─────────────────────────────────────────────────────────────────

/** Rows read by the query. One read answers every question, and a backlog is not a reason
 * for a digest to cost more. */
export const DEFAULT_LIMIT = 500;

/**
 * A record ralph appended: `[<ISO-8601>] dispatched: …` or `[<ISO-8601>] completed: …`.
 * Anchored at the start of a line, so a quoted record inside a worker's prose is not read
 * as one.
 */
const RECORD_LINE = /^\[([^\]]+)\]\s+(dispatched|completed):\s*(.*)$/;

// ─── Records ──────────────────────────────────────────────────────────────────

/**
 * The `key=value` pairs of a record's tail: `kind=… worker=…` first, then `; cwd=…;
 * session=…`. A pair whose key is not a record field is ignored, so a record that grows a
 * field stays readable by an older reader.
 * @param {string} tail
 * @returns {{ kind: string | null, worker: string | null, cwd: string | null, session: string | null }}
 */
function fieldsOf(tail) {
  /** @type {{ kind: string | null, worker: string | null, cwd: string | null, session: string | null }} */
  const fields = { kind: null, worker: null, cwd: null, session: null };
  /**
   * One `key=value`, where the value runs to the end of its segment — a working directory
   * contains spaces, so a value cannot be split on them.
   * @param {string} pair
   */
  const assign = (pair) => {
    const equals = pair.indexOf('=');
    if (equals === -1) return;
    const key = pair.slice(0, equals);
    const value = pair.slice(equals + 1);
    if (value === '') return;
    if (key === 'kind' || key === 'worker' || key === 'cwd' || key === 'session') fields[key] = value;
  };
  const [head = '', ...rest] = tail.split(';');
  // The head is `kind=… worker=…`, two pairs on one segment; every later segment is one pair.
  for (const pair of head.trim().split(/\s+/)) assign(pair);
  for (const segment of rest) assign(segment.trim());
  return fields;
}

/**
 * Every record on one bead's trail, oldest first. A line ralph did not write as a record —
 * a worker's own checkpoint, the prose between records — is not one.
 * @param {string | null} notes
 * @returns {TrailRecord[]}
 */
function recordLines(notes) {
  if (notes === null) return [];
  /** @type {TrailRecord[]} */
  const records = [];
  for (const line of notes.split('\n')) {
    const match = RECORD_LINE.exec(line.trim());
    if (match === null) continue;
    const at = match[1];
    const type = match[2];
    const fields = fieldsOf(match[3] ?? '');
    if (at === undefined || (type !== 'dispatched' && type !== 'completed')) continue;
    if (fields.kind === null || fields.worker === null) continue;
    records.push({ at, type, kind: fields.kind, worker: fields.worker, cwd: fields.cwd, session: fields.session });
  }
  return records;
}

/**
 * The newest dispatch record on one bead's trail, or null when it carries none. Exported
 * because the record is the contract between ralph's dispatch and this reader: the line
 * ralph writes is the line this parses.
 * @param {string | null} notes
 * @returns {Dispatch | null}
 */
export function parseDispatch(notes) {
  const dispatched = recordLines(notes).filter((record) => record.type === 'dispatched');
  const newest = dispatched[dispatched.length - 1];
  if (newest === undefined) return null;
  return {
    at: newest.at,
    kind: newest.kind,
    worker: newest.worker,
    cwd: newest.cwd,
    session: newest.session,
  };
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/**
 * The bead that owns a row's work: its `parent` field, or the `parent-child` dependency
 * when the field is absent, which is how a chore reports the feature it belongs to. Null
 * when the row carries neither.
 * @param {Record<string, unknown>} row
 * @returns {string | null}
 */
function parentOf(row) {
  const parent = textOf(row, 'parent');
  if (parent !== null) return parent;
  const dependencies = row.dependencies;
  if (!Array.isArray(dependencies)) return null;
  for (const dependency of dependencies) {
    if (typeof dependency !== 'object' || dependency === null) continue;
    const fields = /** @type {Record<string, unknown>} */ (dependency);
    const type = textOf(fields, 'dependency_type') ?? textOf(fields, 'type');
    if (type !== 'parent-child') continue;
    const id = textOf(fields, 'id') ?? textOf(fields, 'depends_on_id');
    if (id !== null) return id;
  }
  return null;
}

/**
 * Compare two ids as code units. Locale-aware comparison would make the digest depend on
 * the machine's locale, and a digest must not change for that reason.
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareIds(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

// ─── Digest ───────────────────────────────────────────────────────────────────

/**
 * Reduce the tracker's in-progress rows to the dispatch set. Pure: this function never
 * runs `bd`, and the CLI never decides what is in flight.
 *
 * @param {object} input
 * @param {Record<string, unknown>[]} input.inProgress Rows of the in-progress query.
 * @param {number} input.thresholdMinutes
 * @param {Date} input.now
 * @returns {Digest}
 */
export function buildInflight({ inProgress, thresholdMinutes, now }) {
  /** @type {InflightEntry[]} */
  const inflight = [];
  /** @type {string[]} */
  const unrecorded = [];
  /** @type {Set<string>} */
  const owners = new Set();

  for (const row of inProgress) {
    const id = textOf(row, 'id');
    // `bd`'s payload is an external boundary: a row that is not in progress cannot be a
    // worker in flight, whatever asked for it.
    if (id === null || textOf(row, 'status') !== 'in_progress') continue;

    const records = recordLines(textOf(row, 'notes'));
    const newest = records[records.length - 1];
    if (newest === undefined) {
      unrecorded.push(id);
      continue;
    }
    // A completion is the record that says this worker is done. A bead that stays in
    // progress afterwards — a decomposed feature, an expanded task — is work waiting, not
    // work running, so it leaves the dispatch set without any record being deleted.
    if (newest.type !== 'dispatched') continue;

    // A stage chore names its parent; a decomposition or expansion worker has no chore, so
    // its record sits on the parent itself and that bead is the parent.
    const parentId = newest.kind === 'stage' ? parentOf(row) : id;
    const stall = stallOf(row, { thresholdMinutes, now });
    inflight.push({
      id,
      kind: newest.kind,
      parentId,
      worker: newest.worker,
      liveness: stall === null ? 'running' : 'stalled',
      reason: stall === null ? null : stall.reason,
      quietMinutes: stall === null ? quietMinutesOf(row, now) : stall.quietMinutes,
    });
    if (parentId !== null) owners.add(parentId);
  }

  inflight.sort((left, right) => compareIds(left.id, right.id));
  return {
    inflight,
    parents: [...owners].sort(compareIds),
    stalled: inflight.filter((entry) => entry.liveness === 'stalled').map((entry) => entry.id),
    // A parent whose worker is in flight is owned, not unrecorded: only a claim with
    // nothing behind it belongs here.
    unrecorded: unrecorded.filter((id) => !owners.has(id)).sort(compareIds),
  };
}

// ─── Tracker ──────────────────────────────────────────────────────────────────

/**
 * Read the tracker and build the digest. Throws when the tracker cannot be read; the CLI
 * turns that into a distinct exit code and prints no digest.
 *
 * @param {object} input
 * @param {DigestDeps} [input.deps]
 * @param {number} [input.thresholdMinutes]
 * @param {number} [input.limit]
 * @param {Date} [input.now]
 * @param {Record<string, string | undefined>} [input.env]
 * @returns {Promise<Digest>}
 */
export async function checkInflight({
  deps = {},
  thresholdMinutes = DEFAULT_STALL_MINUTES,
  limit = DEFAULT_LIMIT,
  now = new Date(),
  env = process.env,
}) {
  const bd = deps.bd ?? createBdRunner(env);
  // One read: every record lives in `notes`, so the in-progress rows carry the whole
  // answer and no second query is needed.
  const inProgress = parseRows(await bd(['list', '-s', 'in_progress', '--json', '-n', String(limit)]));
  return buildInflight({ inProgress, thresholdMinutes, now });
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage: node inflight.mjs [--stall-minutes <minutes>] [--limit <rows>]
Prints the dispatch set as one JSON object: the workers in flight, the parents they belong
to, the ones that are no longer alive, and the in-progress beads no dispatch record explains.
Exit codes: 0 digest printed, 1 the tracker could not be read (nothing is printed), 2 bad arguments.
  --stall-minutes <minutes>  minutes of silence before a worker counts as stalled
                             (default ${DEFAULT_STALL_MINUTES}; ${STALL_MINUTES_ENV} sets it too)
  --limit <rows>             rows read by the query (default ${DEFAULT_LIMIT})
  BD_PATH                    the bd binary (default: bd)
`;

/**
 * @typedef {object} CliOptions
 * @property {number} thresholdMinutes
 * @property {number} limit
 */

/**
 * Resolve the flags: `--stall-minutes` wins over the environment, which wins over the
 * default, exactly as the idle check resolves the same threshold.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {CliOptions}
 */
function parseArgs(argv, env) {
  /** @type {{ stall?: string, limit?: string }} */
  const raw = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stall-minutes' && argv[i + 1] !== undefined) raw.stall = argv[++i];
    else if (arg === '--limit' && argv[i + 1] !== undefined) raw.limit = argv[++i];
    else throw new Error(`unexpected argument: ${arg}`);
  }
  const thresholdMinutes = resolveStallMinutes({ flag: raw.stall, env: env[STALL_MINUTES_ENV] });
  const limit = raw.limit === undefined ? DEFAULT_LIMIT : Number(raw.limit);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`--limit needs a positive whole number of rows, got "${raw.limit}"`);
  }
  return { thresholdMinutes, limit };
}

/**
 * @param {object} input
 * @param {string[]} input.argv                            CLI arguments (without node/script).
 * @param {(chunk: string) => void} [input.write]          stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [input.writeError]     stderr sink; injectable for tests.
 * @param {DigestDeps} [input.deps]                        Collaborators; injectable for tests.
 * @param {Date} [input.now]                               Clock; injectable for tests.
 * @param {Record<string, string | undefined>} [input.env] Environment; process.env by default.
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
    // Unusable arguments are a caller mistake, not a tracker failure: a caller must not
    // read this as "the tracker is down" and back off for the wrong reason.
    writeError(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return EXIT_CODES.usageError;
  }

  try {
    const digest = await checkInflight({ deps, ...options, now, env });
    write(`${JSON.stringify(digest, null, 2)}\n`);
    return EXIT_CODES.digest;
  } catch (error) {
    writeError(`${error instanceof Error ? error.message : String(error)}\n`);
    // No digest at all: an unreadable tracker is not an empty dispatch set, and a caller
    // that read it as one would conclude the run is idle while it is not.
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
