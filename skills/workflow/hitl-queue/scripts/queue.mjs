// @ts-check
// The ranked HITL queue: one flat list of the beads that are waiting for a human
// answer, ordered by how much each answer unblocks.
//
//   node queue.mjs queue [--scopes <path>] [--shared] [--file <strategy>]
//                        [--include-ideas] [--cwd <dir>] [--json]
//
// The list spans several bd workspaces — the *scopes* — and tags every row with the scope
// it came from. See `scopes.mjs` for the list, the read-only guard and the daily note.
//
// One multiplier does the load-bearing work: a bead that unblocks three others outranks
// an otherwise identical bead that unblocks none, and the count is **transitive** — a
// bead blocking A, which blocks B, which blocks C, unblocks three. The walk collects
// distinct beads, never paths, so a diamond (one bead reached by two routes) counts once.
// The walk runs inside the candidate's own workspace, so two scopes may reuse a bead id
// without their graphs mixing.
//
// A bd `--due` date adds a second factor, and its numbers live in the strategy's
// `## Deadline tiers` table rather than here: the narrower the remaining time, the higher
// the factor, and a passed deadline is flagged `OVERDUE` in its row instead of being
// lifted in silence. `now` is a parameter of the build, never read deep inside the
// ranking, so a boundary case is deterministic.
//
// The RICE score is read from the bead's own metadata, written by the score-bead skill.
// This script never recomputes it and never invents one: a bead with no score is listed
// as `unscored` with the reason, because a queue that guessed would hide the gap.
//
// Zero runtime dependencies, async fs only, every child process with an argv array.
// `skills/*/scripts` sits outside the check-no-sync scan; this script stays async anyway,
// so the rule holds everywhere. BD_PATH pins a bd binary the way the score script does.
//
// Exit codes: 0 the queue was built — a scope it could not read is reported as
// `unavailable`, never fatal; 1 an internal failure; 2 the caller asked for something
// malformed.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { DEFAULT_FILE, resolveStrategyPath, validateStrategy } from '../../prioritise-work/scripts/strategy.mjs';
import { DEFAULT_DEADLINE_TIERS, deadlineMultiplier, parseDeadlineTiers } from '../../prioritise-work/scripts/strategy.mjs';
import { BD_PATH, RICE_KEY, errorMessage, makeRunner, storedRice } from '../../score-bead/scripts/rice.mjs';
import {
  DEFAULT_SCOPES_FILE,
  HOME_ENV,
  PERSONAL_KIND,
  SHARED_ENV,
  ScopeError,
  ScopeWriteError,
  emptyNote,
  guardRunner,
  readDailyNote,
  readScopeConfig,
  unavailableReason,
} from './scopes.mjs';

/** @typedef {import('../../score-bead/scripts/rice.mjs').StoredRice} StoredRice */
/** @typedef {import('../../prioritise-work/scripts/strategy.mjs').DeadlineTier} DeadlineTier */
/** @typedef {import('./scopes.mjs').DailyNote} DailyNote */
/** @typedef {import('./scopes.mjs').Scope} Scope */
/** @typedef {(args: string[]) => Promise<string>} Runner */
/** @typedef {(args: string[], scope: Scope) => Promise<string>} ScopedRunner */

// ─── Contract ─────────────────────────────────────────────────────────────────

/** The label that marks a bead as human-required. The queue is that label's backlog. */
export const HITL_LABEL = 'execution:hitl';

/** Ideas are HITL by convention, and ranked only when asked for. */
export const IDEA_LABEL = 'kind:idea';

/** The status that says work has started, and so earns the work-in-progress multiplier. */
export const IN_PROGRESS_STATUS = 'in_progress';

/** A bead the owner has parked. Deferring is an answer, so the queue leaves it out. */
export const DEFERRED_STATUS = 'deferred';

/** Work already finished cannot be unblocked, so it never counts toward the multiplier. */
export const CLOSED_STATUS = 'closed';

/** An in-progress bead outranks an equal not-started one: the queue drains WIP first. */
export const WIP_MULTIPLIER = 1.5;

/** The dependency type that blocks. A "related" edge is not an answer anyone waits on. */
export const BLOCKS_TYPE = 'blocks';

/** How many dependent ids a row names before it summarises the rest as a count. */
const NAMED_DEPENDENTS = 5;

/** How many milliseconds a minute holds, for showing a deadline as days and hours. */
const MS_PER_MINUTE = 60_000;

/** A usage mistake: the caller asked for something malformed. Exit code 2. */
export class UsageError extends Error {}

/** The run refused: the tracker printed something this script cannot read. Exit code 1. */
export class QueueError extends Error {}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * One bead as `bd list` reports it, plus the scope it was read from.
 * @typedef {object} Candidate
 * @property {string} id
 * @property {string} title
 * @property {string} status
 * @property {string} scope
 * @property {StoredRice | undefined} rice
 * @property {number | undefined} dueAt       The `--due` moment, epoch milliseconds.
 * @property {number | undefined} deferUntil  The `--defer` wake moment, epoch milliseconds.
 */

/**
 * One line of the queue: a candidate plus everything the ranking derived from it.
 * @typedef {object} QueueRow
 * @property {number | undefined} rank           Undefined for an unscored row.
 * @property {string} id
 * @property {string} scope
 * @property {string} title
 * @property {string} status
 * @property {boolean} inProgress
 * @property {number | undefined} score          The stored RICE total, when there is one.
 * @property {StoredRice | undefined} rice
 * @property {number} dependents                 Distinct transitive dependents, unclosed.
 * @property {string[]} dependentIds             Those dependents, sorted, closed excluded.
 * @property {number} dependentMultiplier        1 + ln(1 + dependents).
 * @property {number} wipMultiplier              WIP_MULTIPLIER, or 1.
 * @property {number | undefined} dueAt          The `--due` moment, epoch milliseconds.
 * @property {number | undefined} remainingMs    Distance to the deadline; negative once past.
 * @property {number} deadlineFactor             The strategy's factor; 1 without a deadline.
 * @property {boolean} overdue                   The deadline has passed.
 * @property {number | undefined} total          The rounded ranking key; undefined if unscored.
 * @property {number | undefined} scoredAtVersion
 * @property {boolean} stale                     Scored against an older strategy version.
 * @property {string | undefined} unscoredReason Why this bead holds no rank.
 */

/**
 * One configured scope, as the report publishes it.
 * @typedef {object} ScopeStatus
 * @property {string} name
 * @property {string} kind
 * @property {boolean} readOnly
 * @property {boolean} writable
 * @property {string} path
 * @property {'available' | 'unavailable' | 'withheld'} status
 * @property {string | undefined} reason
 */

/**
 * The whole answer.
 * @typedef {object} QueueReport
 * @property {{ file: string, version: number | undefined, deadlineTiers: DeadlineTier[] }} strategy
 * @property {'local' | 'shared'} invocation
 * @property {ScopeStatus[]} scopes
 * @property {DailyNote} today
 * @property {{ ranked: number, unscored: number, excludedIdeas: number, excludedDeferred: number, availableScopes: number, unavailableScopes: number, withheldScopes: number }} counts
 * @property {QueueRow[]} rows                   Ranked rows first, then unscored rows.
 */

// ─── Arithmetic ───────────────────────────────────────────────────────────────

/** @param {number} value @returns {number} */
function round1(value) {
  return Math.round(value * 10) / 10;
}

/**
 * How much one answer is worth in dependents: 1 + ln(1 + n). Zero dependents scores 1,
 * so a bead that unblocks nothing is not penalised — it is simply not lifted. The curve
 * is logarithmic so unblocking thirty chores does not drown the queue under one row.
 * @param {number} count Distinct transitively blocked beads.
 * @returns {number}
 */
export function dependentMultiplier(count) {
  return 1 + Math.log1p(count);
}

/**
 * The ranking key: RICE × dependent multiplier × work-in-progress multiplier × deadline
 * multiplier, rounded to one decimal. The rounded figure is the sort key as well as the
 * printed one, so the number a reader sees is the number the order was decided by.
 * @param {object} input
 * @param {number} input.score
 * @param {number} input.dependents
 * @param {boolean} input.inProgress
 * @param {number} [input.deadline]  The strategy's factor at the bead's remaining time; 1
 *                                   when the bead has no deadline.
 * @returns {number}
 */
export function queueTotal({ score, dependents, inProgress, deadline = 1 }) {
  return round1(score * dependentMultiplier(dependents) * (inProgress ? WIP_MULTIPLIER : 1) * deadline);
}

// ─── Tracker ──────────────────────────────────────────────────────────────────

/**
 * @param {string} stdout @param {string} what @returns {unknown[]}
 */
function parseJsonArray(stdout, what) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new QueueError(`${what} did not print JSON`);
  }
  if (!Array.isArray(parsed)) throw new QueueError(`${what} did not print a JSON array`);
  return parsed;
}

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
function asRecord(value) {
  return typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : undefined;
}

/** @param {unknown} value @returns {string | undefined} */
function asString(value) {
  return typeof value === 'string' ? value : undefined;
}

/**
 * An ISO instant as epoch milliseconds, or undefined when the field is absent or unreadable.
 * `bd` writes both `due_at` and `defer_until` as UTC ISO strings.
 * @param {unknown} value @returns {number | undefined}
 */
function instantOf(value) {
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * A dependent edge: the bead, and the status it is in, so the count can drop finished work.
 * @typedef {object} Dependent
 * @property {string} id
 * @property {string} status
 */

/**
 * Read the dependency graph upwards, once per bead.
 *
 * `bd dep list <id> --direction up` names the beads that depend on `<id>` — the ones an
 * answer unblocks. The walk is transitive: from every dependent it asks again, so a chain
 * of three counts three rather than one. Two properties are deliberate:
 *
 *   • **Distinct, not paths.** The result is a map keyed by bead id, so a diamond — one
 *     bead reached by two routes — is counted once. Paths would inflate a reconverging
 *     graph, and the multiplier would then measure the shape rather than the work.
 *   • **Walked through everything, counted only while live.** A closed bead is still a
 *     link in the chain, so the walk passes through it; but a closed bead is not work an
 *     answer unblocks, so it is left out of the result.
 *
 * Only `blocks` edges count: a "related" edge is not something anyone waits on. Each
 * bead's direct edges are read once and remembered, so a shared subtree is fetched once
 * however many roots reach it.
 *
 * @param {Runner} bd
 * @returns {(beadId: string) => Promise<Map<string, Dependent>>}
 */
export function createDependentReader(bd) {
  /** @type {Map<string, Promise<Dependent[]>>} */
  const edges = new Map();

  /** @param {string} beadId @returns {Promise<Dependent[]>} */
  function direct(beadId) {
    const cached = edges.get(beadId);
    if (cached !== undefined) return cached;
    const pending = bd(['dep', 'list', beadId, '--direction', 'up', '--json']).then((stdout) => {
      const rows = parseJsonArray(stdout, `bd dep list ${beadId} --direction up --json`);
      /** @type {Dependent[]} */
      const out = [];
      for (const row of rows) {
        const record = asRecord(row);
        if (record === undefined) continue;
        if (record.dependency_type !== BLOCKS_TYPE) continue;
        const id = asString(record.id);
        if (id === undefined) continue;
        out.push({ id, status: asString(record.status) ?? 'open' });
      }
      return out;
    });
    edges.set(beadId, pending);
    return pending;
  }

  /**
   * Every bead that depends on `beadId`, directly or through another bead. Level by level
   * so one level's edges are fetched together; the frontier is a set, so a reconverging
   * graph cannot make the walk repeat itself.
   * @param {string} beadId
   * @returns {Promise<Map<string, Dependent>>}
   */
  return async function dependentsOf(beadId) {
    /** @type {Map<string, Dependent>} */
    const found = new Map();
    const seen = new Set([beadId]);
    let frontier = [beadId];

    while (frontier.length > 0) {
      const level = await Promise.all(frontier.map((id) => direct(id)));
      /** @type {string[]} */
      const next = [];
      for (const list of level) {
        for (const dependent of list) {
          found.set(dependent.id, dependent);
          if (seen.has(dependent.id)) continue;
          seen.add(dependent.id);
          next.push(dependent.id);
        }
      }
      frontier = next;
    }

    found.delete(beadId);
    return found;
  };
}

/**
 * The candidates in one scope: every open bead carrying `execution:hitl`. Closed beads are
 * bd's own default filter; an idea is unshaped, so it is counted and left out unless asked
 * for.
 *
 * A deferral is bd's own field and bd's own rule, so the queue reads it rather than
 * inventing a second one. `bd ready` wakes a bead whose `defer_until` has passed, but
 * `bd list` keeps reporting the stale `deferred` status the moment it was parked in, so
 * applying the wake rule to `defer_until` here keeps this list equal to bd's own view.
 * A `deferred` bead with no readable wake moment stays out: nothing says it woke.
 * @param {object} options
 * @param {Runner} options.bd
 * @param {string} options.scope                  The scope name every row is tagged with.
 * @param {boolean} options.includeIdeas
 * @param {number} options.now  Epoch milliseconds the deferral is judged against.
 * @returns {Promise<{ candidates: Candidate[], excludedIdeas: number, excludedDeferred: number }>}
 */
async function readCandidates({ bd, scope, includeIdeas, now }) {
  const stdout = await bd(['list', '-l', HITL_LABEL, '--json', '--limit', '0']);
  const rows = parseJsonArray(stdout, `bd list -l ${HITL_LABEL} --json`);

  /** @type {Candidate[]} */
  const candidates = [];
  let excludedIdeas = 0;
  let excludedDeferred = 0;

  for (const row of rows) {
    const record = asRecord(row);
    if (record === undefined) continue;
    const id = asString(record.id);
    if (id === undefined) continue;
    const status = asString(record.status) ?? 'open';
    if (status === CLOSED_STATUS) continue;
    const labels = Array.isArray(record.labels) ? record.labels.filter((label) => typeof label === 'string') : [];
    const deferUntil = instantOf(record.defer_until);
    if (!includeIdeas && labels.includes(IDEA_LABEL)) {
      excludedIdeas += 1;
      continue;
    }
    if (status === DEFERRED_STATUS && (deferUntil === undefined || deferUntil > now)) {
      excludedDeferred += 1;
      continue;
    }
    candidates.push({
      id,
      scope,
      title: asString(record.title) ?? id,
      status,
      rice: storedRice(record.metadata),
      dueAt: instantOf(record.due_at),
      deferUntil,
    });
  }

  return { candidates, excludedIdeas, excludedDeferred };
}

/**
 * The strategy a run ranks against: the version a score is compared with, and the deadline
 * tiers its factor comes from. A missing or malformed strategy does not stop the queue:
 * the scores are already on the beads, and refusing to rank them would hide the backlog
 * behind a file. The version is then reported for what it is — unknown — and the tiers
 * fall back to their documented default, which is a value a reader can look up.
 * @param {object} options
 * @param {string | undefined} options.file
 * @param {string} options.cwd
 * @returns {Promise<{ file: string, version: number | undefined, deadlineTiers: DeadlineTier[] }>}
 */
async function readStrategy({ file, cwd }) {
  const path = await resolveStrategyPath({ ...(file === undefined ? {} : { file }), cwd });
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) {
    return { file: path, version: undefined, deadlineTiers: [...DEFAULT_DEADLINE_TIERS] };
  }
  const strategy = validateStrategy(text);
  const tiers = parseDeadlineTiers(text);
  return {
    file: path,
    version: strategy.ok ? strategy.version : undefined,
    deadlineTiers: tiers.ok ? tiers.tiers : [...DEFAULT_DEADLINE_TIERS],
  };
}

// ─── Scopes ───────────────────────────────────────────────────────────────────

/**
 * One scope's half of the report: what it contributed, or why it contributed nothing.
 * @typedef {object} ScopeRead
 * @property {Scope} scope
 * @property {'available' | 'unavailable' | 'withheld'} status
 * @property {string | undefined} reason
 * @property {Candidate[]} candidates
 * @property {number} excludedIdeas
 * @property {number} excludedDeferred
 */

/**
 * Read every configured scope.
 *
 * Two scopes never reach the tracker: a scope whose workspace is missing or uninitialised
 * is `unavailable` with the reason, and a personal scope is `withheld` in a shared
 * invocation — not read, so nothing personal is even loaded, let alone printed. A bd call
 * that fails marks its own scope unavailable and leaves the other scopes alone. A refused
 * write is the one error that propagates: it is a defect in this script, not in the machine.
 *
 * @param {object} options
 * @param {ScopedRunner} options.bd
 * @param {Scope[]} options.scopes
 * @param {boolean} options.includeIdeas
 * @param {number} options.now                  Epoch milliseconds the deferral is judged against.
 * @param {boolean} options.shared
 * @returns {Promise<ScopeRead[]>}
 */
async function readScopes({ bd, scopes, includeIdeas, now, shared }) {
  /** @type {ScopeRead[]} */
  const reads = [];

  for (const scope of scopes) {
    /** @type {ScopeRead} */
    const empty = { scope, status: 'unavailable', reason: undefined, candidates: [], excludedIdeas: 0, excludedDeferred: 0 };

    if (shared && scope.kind === PERSONAL_KIND) {
      reads.push({ ...empty, status: 'withheld', reason: 'personal scope, withheld in a shared invocation' });
      continue;
    }

    const reason = await unavailableReason(scope);
    if (reason !== undefined) {
      reads.push({ ...empty, reason });
      continue;
    }

    try {
      const read = await readCandidates({ bd: guardRunner(scope, bd), scope: scope.name, includeIdeas, now });
      reads.push({ ...empty, ...read, status: 'available' });
    } catch (error) {
      if (error instanceof ScopeWriteError) throw error;
      reads.push({ ...empty, reason: `bd failed: ${errorMessage(error)}` });
    }
  }

  return reads;
}

// ─── Queue ────────────────────────────────────────────────────────────────────

/**
 * Build the queue: read every scope, derive each row, then order them.
 *
 * The order is total (desc), then stored score (desc), then scope name, then id (both
 * asc). A tie is reachable because the total is rounded and because the logarithm
 * flattens: `ln` maps different dependent counts onto the same one-decimal total. The
 * tie-break is fixed, and the scope name breaks it before the id because two workspaces
 * may hold the same bead id, so two runs over one backlog print byte-identical output — a
 * queue that reordered itself between reads could not be trusted to say what to do first.
 *
 * An unscored row keeps its place in the list, after the ranked rows, and carries the
 * reason. Nothing is dropped silently and no score is invented: the gap is the answer.
 *
 * @param {object} options
 * @param {ScopedRunner} [options.bd]           The tracker; defaults to one bd call per scope.
 * @param {string | undefined} [options.file]   Strategy path; defaults to the documented default.
 * @param {string | undefined} [options.scopesFile] Scope list; defaults to the documented default.
 * @param {string} [options.cwd]
 * @param {boolean} [options.includeIdeas]
 * @param {number} [options.now]  Epoch milliseconds the deadlines are measured from.
 *                               Injectable so a tier boundary test is deterministic.
 * @param {Scope[]} [options.scopes]            An already-resolved scope list, for a caller.
 * @param {boolean} [options.shared]            Output that will leave this machine.
 * @returns {Promise<QueueReport>}
 */
export async function buildQueue({
  bd,
  file,
  scopesFile,
  cwd = process.cwd(),
  includeIdeas = false,
  scopes,
  shared = false,
  now = Date.now(),
}) {
  const runBd = bd ?? (async (args, scope) => await makeRunner(BD_PATH, scope.path)(args));
  const scopeList = scopes ??
    (await readScopeConfig({ cwd, ...(scopesFile === undefined ? {} : { file: scopesFile }) })).scopes;

  const [strategy, reads, today] = await Promise.all([
    readStrategy({ file, cwd }),
    readScopes({ bd: runBd, scopes: scopeList, includeIdeas, shared, now }),
    shared ? Promise.resolve({ ...emptyNote('withheld in a shared invocation'), withheld: true }) : readDailyNote(scopeList),

  ]);

  /** @type {Map<string, ReturnType<typeof createDependentReader>>} */
  const readers = new Map();
  for (const read of reads) {
    if (read.status !== 'available') continue;
    readers.set(read.scope.name, createDependentReader(guardRunner(read.scope, runBd)));
  }

  const candidates = reads.flatMap((read) => read.candidates);
  const excludedIdeas = reads.reduce((total, read) => total + read.excludedIdeas, 0);
  const excludedDeferred = reads.reduce((total, read) => total + read.excludedDeferred, 0);

  /** @type {QueueRow[]} */
  const rows = [];
  for (const candidate of candidates) {
    const dependentsOf = /** @type {ReturnType<typeof createDependentReader>} */ (readers.get(candidate.scope));
    const dependents = await dependentsOf(candidate.id);
    const live = [...dependents.values()]
      .filter((dependent) => dependent.status !== CLOSED_STATUS)
      .map((dependent) => dependent.id)
      .sort();
    const inProgress = candidate.status === IN_PROGRESS_STATUS;
    const score = candidate.rice?.score;
    const remainingMs = candidate.dueAt === undefined ? undefined : candidate.dueAt - now;
    const deadline = remainingMs === undefined
      ? { factor: 1, overdue: false }
      : deadlineMultiplier(remainingMs, strategy.deadlineTiers);
    const scoredAtVersion = candidate.rice?.strategyVersion;
    const stale =
      score !== undefined &&
      scoredAtVersion !== undefined &&
      strategy.version !== undefined &&
      scoredAtVersion !== strategy.version;

    rows.push({
      rank: undefined,
      id: candidate.id,
      scope: candidate.scope,
      title: candidate.title.replace(/\s+/g, ' ').trim(),
      status: candidate.status,
      inProgress,
      score,
      rice: candidate.rice,
      dependents: live.length,
      dependentIds: live,
      dependentMultiplier: dependentMultiplier(live.length),
      wipMultiplier: inProgress ? WIP_MULTIPLIER : 1,
      dueAt: candidate.dueAt,
      remainingMs,
      deadlineFactor: deadline.factor,
      overdue: deadline.overdue,
      total: score === undefined
        ? undefined
        : queueTotal({ score, dependents: live.length, inProgress, deadline: deadline.factor }),
      scoredAtVersion,
      stale,
      unscoredReason: score === undefined
        ? candidate.rice === undefined
          ? `no ${RICE_KEY} metadata`
          : `no score in its ${RICE_KEY} record`
        : undefined,
    });
  }

  const ranked = rows
    .filter((row) => row.total !== undefined)
    .sort((a, b) => {
      const byTotal = /** @type {number} */ (b.total) - /** @type {number} */ (a.total);
      if (byTotal !== 0) return byTotal;
      const byScore = /** @type {number} */ (b.score) - /** @type {number} */ (a.score);
      if (byScore !== 0) return byScore;
      return compareScopeThenId(a, b);
    });
  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });

  const unscored = rows
    .filter((row) => row.total === undefined)
    .sort(compareScopeThenId);

  const available = reads.filter((read) => read.status === 'available').length;

  return {
    strategy,
    invocation: shared ? 'shared' : 'local',
    scopes: reads.map((read) => ({
      name: read.scope.name,
      kind: read.scope.kind,
      readOnly: read.scope.readOnly,
      writable: read.scope.writable,
      path: read.scope.path,
      status: read.status,
      reason: read.reason,
    })),
    today,
    counts: {
      ranked: ranked.length,
      unscored: unscored.length,
      excludedIdeas,
      excludedDeferred,
      availableScopes: available,
      unavailableScopes: reads.filter((read) => read.status === 'unavailable').length,
      withheldScopes: reads.filter((read) => read.status === 'withheld').length,
    },
    rows: [...ranked, ...unscored],
  };
}

/**
 * The tie-break two workspaces both reach: the scope name first, because two workspaces may
 * hold the same bead id, then the id. Stable and total, so one backlog prints one order.
 * @param {QueueRow} a @param {QueueRow} b @returns {number}
 */
function compareScopeThenId(a, b) {
  if (a.scope !== b.scope) return a.scope < b.scope ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ─── Render ───────────────────────────────────────────────────────────────────

/** @param {number} count @param {string} noun @returns {string} */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** @param {string} text @param {number} width @returns {string} */
function right(text, width) {
  return text.padStart(width);
}

/**
 * The components as the score record holds them, so a reader can check the arithmetic
 * without opening the bead. Exported so the one-item recommendation prints the same
 * breakdown rather than a second copy of it that could drift.
 * @param {StoredRice} rice @returns {string}
 */
export function formatComponents(rice) {
  const part = (/** @type {number | undefined} */ value, /** @type {string} */ letter) =>
    `${letter}${value === undefined ? '?' : value}`;
  return `${part(rice.reach, 'R')} · ${part(rice.impact, 'I')} · ${part(rice.confidence, 'C')} · ${part(rice.effort, 'E')}`;
}

/**
 * A span of milliseconds as the largest units that fit, so a row reads `2d 23h` instead of
 * a count of milliseconds. Rounded down: the row shows the time left, never a figure the
 * deadline has not reached.
 * @param {number} ms @returns {string}
 */
function formatSpan(ms) {
  const totalMinutes = Math.floor(Math.abs(ms) / MS_PER_MINUTE);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (parts.length === 0) parts.push(`${totalMinutes % 60}m`);
  return parts.join(' ');
}

/**
 * The due moment in UTC, to the minute: a fixed form, so two runs print it identically.
 * @param {number} instant @returns {string}
 */
function formatInstant(instant) {
  return `${new Date(instant).toISOString().slice(0, 16)}Z`;
}

/**
 * The distance and the due moment, with the word `OVERDUE` once the moment has passed.
 * Empty for a bead with no deadline. No factor here: the scored clause adds one.
 * @param {QueueRow} row @returns {string}
 */
function dueClause(row) {
  if (row.dueAt === undefined || row.remainingMs === undefined) return '';
  const due = formatInstant(row.dueAt);
  const span = formatSpan(row.remainingMs);
  return row.overdue ? `OVERDUE by ${span} (due ${due})` : `in ${span} (due ${due})`;
}

/**
 * The deadline as one clause: the factor and the due clause. Empty for a bead with no
 * deadline, which keeps the factor 1 and is not ranked down for lacking one.
 * @param {QueueRow} row @returns {string}
 */
function deadlineClause(row) {
  const due = dueClause(row);
  return due === '' ? '' : `  deadline ×${row.deadlineFactor} ${due}`;
}

/**
 * The same moment for a row with no total. An unscored row has no product to scale, so it
 * shows the due moment and the slip and claims no factor — the deadline is still visible.
 * @param {QueueRow} row @returns {string}
 */
function unscoredDueClause(row) {
  const due = dueClause(row);
  if (due === '') return '';
  return row.overdue ? `  ${due}` : `  due ${due}`;
}

/**
 * What the answer unblocks, in one clause: named ids while they fit, a count after that.
 * @param {QueueRow} row @returns {string}
 */
export function formatUnblocks(row) {
  if (row.dependentIds.length === 0) return 'unblocks nothing';
  const named = row.dependentIds.slice(0, NAMED_DEPENDENTS);
  const rest = row.dependentIds.length - named.length;
  return `unblocks ${named.join(', ')}${rest > 0 ? ` +${rest} more` : ''}`;
}

/**
 * The scope summary for the header: how many scopes the run had, and how many it could not
 * read. A scope that could not be read is counted in the open, never quietly dropped.
 * @param {QueueReport['counts']} counts @returns {string}
 */
function scopeSummary(counts) {
  const total = counts.availableScopes + counts.unavailableScopes + counts.withheldScopes;
  const parts = [plural(total, 'scope')];
  if (counts.unavailableScopes > 0) parts.push(`${counts.unavailableScopes} unavailable`);
  if (counts.withheldScopes > 0) parts.push(`${counts.withheldScopes} withheld`);
  return parts.join(', ');
}

/**
 * The daily scope note, above the list: which scopes the day belongs to, and the strategy
 * line that says so. A shared invocation withholds it, because the quote is personal
 * strategy text; nothing personal is read, let alone printed, off this machine.
 * @param {DailyNote} today @returns {string}
 */
export function renderToday(today) {
  if (today.withheld === true) return 'today · withheld (shared invocation) — personal strategy text';
  if (today.reason !== undefined) return `today · no daily note — ${today.reason}`;

  const names = today.scopes.length === 0 ? 'unnamed scopes' : today.scopes.join(', ');
  const version = today.strategyVersion === undefined ? 'strategy unknown' : `strategy v${today.strategyVersion}`;
  const section = today.section === undefined ? '' : `, "## ${today.section}"`;
  return `today · ${names} — "${today.line}" (${version}${section}, scope ${today.scopeName})`;
}

/**
 * The scopes that contributed nothing, one clause each, so a missing personal workspace is
 * visible instead of looking like an empty backlog.
 * @param {QueueReport} report @returns {string}
 */
function unavailableLine(report) {
  const quiet = report.scopes.filter((scope) => scope.status === 'unavailable');
  if (quiet.length === 0) return '';
  return `unavailable: ${quiet.map((scope) => `${scope.name} (${scope.path}) — ${scope.reason ?? 'unknown'}`).join('; ')}\n`;
}

/**
 * Render the queue as text: a header naming the formula and the scopes, the daily scope
 * note, then one block per row — its scope tag and numbers, then its title and what the
 * answer unblocks.
 * @param {QueueReport} report @returns {string}
 */
export function renderQueue(report) {
  const { counts, strategy, rows, today } = report;
  const strategyLabel = strategy.version === undefined ? 'strategy unknown' : `strategy v${strategy.version}`;
  const scopes = scopeSummary(counts);

  const head = rows.length === 0
    ? [`HITL decision queue · no open ${HITL_LABEL} beads · ${scopes}`, renderToday(today)]
    : [
        `HITL decision queue · ${counts.ranked} ranked, ${counts.unscored} unscored · ${scopes} · ${strategyLabel}`,
        'total = rice × (1 + ln(1 + dependents)) × 1.5 in-progress × deadline tier · ties break on rice, then scope, then id · unscored last',
        renderToday(today),
      ];

  const excluded = formatExcluded(counts);
  const unavailable = unavailableLine(report);
  const hasNoScore = counts.ranked === 0 && rows.length > 0;
  for (const line of [excluded, unavailable]) if (line !== '') head.push(line.trimEnd());
  if (hasNoScore) {
    head.push('no RICE score on any candidate — nothing can be ranked; score one with score-bead, then re-run');
  }
  if (rows.length === 0) return `${head.join('\n')}\n`;

  const rankWidth = Math.max(1, String(counts.ranked).length);
  const scopeWidth = Math.max(...rows.map((row) => row.scope.length));
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const totalWidth = Math.max(...rows.map((row) => (row.total === undefined ? 1 : row.total.toFixed(1).length)));

  const lines = [...head, ''];

  for (const row of rows) {
    const rank = row.rank === undefined ? '-' : String(row.rank);
    const total = row.total === undefined ? '—' : row.total.toFixed(1);
    const numbers = row.score === undefined
      ? `unscored — ${row.unscoredReason ?? 'no score'} (score it with score-bead)` +
        unscoredDueClause(row)
      : formatNumbers(row);
    const stale = row.stale ? `  (scored at strategy v${row.scoredAtVersion}, current v${strategy.version})` : '';
    lines.push(
      `${right(rank, rankWidth)}  ${row.scope.padEnd(scopeWidth)}  ${row.id.padEnd(idWidth)}  ` +
        `${right(total, totalWidth)}  ${numbers}${stale}`,
    );
    lines.push(`    ${row.title} — ${formatUnblocks(row)}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * The score line of one row: the stored RICE total, the four components it was computed
 * from, and both multipliers. Exported so the one-item recommendation prints the queue's
 * own numbers instead of deriving them a second time.
 * @param {QueueRow} row @returns {string}
 */
export function formatNumbers(row) {
  return `rice ${/** @type {number} */ (row.score).toFixed(1)} = ${formatComponents(/** @type {StoredRice} */ (row.rice))}` +
    `  ×${row.dependentMultiplier.toFixed(2)} dependents(${row.dependents})` +
    `  ×${row.wipMultiplier.toFixed(1)}${row.inProgress ? ' in-progress' : ''}` +
    deadlineClause(row);
}

/**
 * The excluded counts, so nothing leaves the list without a trace.
 * @param {QueueReport['counts']} counts @returns {string}
 */
export function formatExcluded(counts) {
  if (counts.excludedIdeas === 0 && counts.excludedDeferred === 0) return '';
  const parts = [];
  if (counts.excludedIdeas > 0) {
    parts.push(`${plural(counts.excludedIdeas, IDEA_LABEL + ' bead')} (--include-ideas ranks them)`);
  }
  if (counts.excludedDeferred > 0) {
    parts.push(`${plural(counts.excludedDeferred, DEFERRED_STATUS + ' bead')}`);
  }
  return `excluded: ${parts.join('; ')}\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['queue']);

const USAGE = `Usage: node queue.mjs queue [--scopes <path>] [--shared] [--file <path>]
                            [--include-ideas] [--cwd <dir>] [--json]

  queue   Rank the open ${HITL_LABEL} beads from every configured scope into one list:
          RICE × (1 + ln(1 + dependents)) × 1.5 when in progress, × the strategy's
          deadline factor at the bead's --due. Each row carries the scope it came from.
          A bead with no score is listed as unscored, never guessed.

Options:
  --scopes <path>   Scope list (default: ${DEFAULT_SCOPES_FILE} from the repository root,
                    then ~/.agent-cortex/scopes.json, then the current workspace alone)
  --shared          Output that leaves this machine: personal scopes are not read
  --file <path>     Strategy file (default: ${DEFAULT_FILE}, relative to the repository root)
  --include-ideas   Rank ${IDEA_LABEL} beads too (they are excluded by default)
  --cwd <dir>       Directory the strategy, scope paths and bd resolve from
  --json            Print the report as JSON
  -h, --help        Show this text

Environment:
  BD_PATH                    bd binary (default: bd)
  ${HOME_ENV}         Install root the user-level scope list is read from
  ${SHARED_ENV}   Set to 1 to run as a shared invocation
`;

/**
 * Parse the CLI's argv.
 * @param {string[]} argv
 * @returns {{ command: string, file?: string, scopesFile?: string, includeIdeas: boolean, shared: boolean, cwd: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let command;
  /** @type {string | undefined} */
  let file;
  /** @type {string | undefined} */
  let scopesFile;
  let cwd = process.cwd();
  let json = false;
  let includeIdeas = false;
  let shared = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--include-ideas') {
      includeIdeas = true;
      continue;
    }
    if (arg === '--shared') {
      shared = true;
      continue;
    }
    if (arg === '--file' || arg === '--cwd' || arg === '--scopes') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--cwd') cwd = value;
      else if (arg === '--scopes') scopesFile = value;
      else file = value;
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`unexpected argument: ${arg}`);
    if (command === undefined) {
      if (!COMMANDS.includes(arg)) throw new UsageError(`unknown command "${arg}"`);
      command = arg;
      continue;
    }
    throw new UsageError(`unexpected argument: ${arg}`);
  }

  if (command === undefined) throw new UsageError(`a command is required: ${COMMANDS.join(', ')}`);
  return {
    command,
    ...(file === undefined ? {} : { file }),
    ...(scopesFile === undefined ? {} : { scopesFile }),
    includeIdeas,
    shared,
    cwd,
    json,
  };
}

/**
 * @param {object} options
 * @param {string[]} options.argv                        CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]        stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError]   stderr sink; injectable for tests.
 * @param {{ bd?: ScopedRunner }} [options.deps]           Collaborators; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({
  argv,
  write = (chunk) => process.stdout.write(chunk),
  writeError = (chunk) => process.stderr.write(chunk),
  deps = {},
}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return 0;
  }

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`queue: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }

  const bd = deps.bd ?? (async (args, scope) => await makeRunner(BD_PATH, scope.path)(args));
  const shared = options.shared || isTruthy(process.env[SHARED_ENV]);

  try {
    const report = await buildQueue({
      bd,
      cwd: options.cwd,
      includeIdeas: options.includeIdeas,
      shared,
      ...(options.file === undefined ? {} : { file: options.file }),
      ...(options.scopesFile === undefined ? {} : { scopesFile: options.scopesFile }),
    });
    write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderQueue(report));
    return 0;
  } catch (error) {
    // A scope list that cannot be read is the caller's mistake; anything else is a defect.
    writeError(`queue failed: ${errorMessage(error)}\n`);
    return error instanceof ScopeError ? 2 : 1;
  }
}

/** @param {string | undefined} value @returns {boolean} */
function isTruthy(value) {
  return value !== undefined && ['1', 'true', 'yes'].includes(value.trim().toLowerCase());
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
