// @ts-check
// The ranked HITL queue: one flat list of the beads that are waiting for a human
// answer, ordered by how much each answer unblocks.
//
//   node queue.mjs queue [--file <strategy>] [--include-ideas] [--cwd <dir>] [--json]
//
// One multiplier does the load-bearing work: a bead that unblocks three others outranks
// an otherwise identical bead that unblocks none, and the count is **transitive** — a
// bead blocking A, which blocks B, which blocks C, unblocks three. The walk collects
// distinct beads, never paths, so a diamond (one bead reached by two routes) counts once.
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
// Exit codes: 0 the queue was built, 1 the tracker call failed, 2 the caller asked for
// something malformed.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { DEFAULT_FILE, resolveStrategyPath, validateStrategy } from '../../prioritise-work/scripts/strategy.mjs';
import { DEFAULT_DEADLINE_TIERS, deadlineMultiplier, parseDeadlineTiers } from '../../prioritise-work/scripts/strategy.mjs';
import { BD_PATH, RICE_KEY, errorMessage, makeRunner, storedRice } from '../../score-bead/scripts/rice.mjs';

/** @typedef {import('../../score-bead/scripts/rice.mjs').StoredRice} StoredRice */
/** @typedef {import('../../prioritise-work/scripts/strategy.mjs').DeadlineTier} DeadlineTier */
/** @typedef {(args: string[]) => Promise<string>} Runner */

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
 * One bead as `bd list` reports it.
 * @typedef {object} Candidate
 * @property {string} id
 * @property {string} title
 * @property {string} status
 * @property {StoredRice | undefined} rice
 * @property {number | undefined} dueAt       The `--due` moment, epoch milliseconds.
 * @property {number | undefined} deferUntil  The `--defer` wake moment, epoch milliseconds.
 */

/**
 * One line of the queue: a candidate plus everything the ranking derived from it.
 * @typedef {object} QueueRow
 * @property {number | undefined} rank           Undefined for an unscored row.
 * @property {string} id
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
 * The whole answer.
 * @typedef {object} QueueReport
 * @property {{ file: string, version: number | undefined, deadlineTiers: DeadlineTier[] }} strategy
 * @property {{ ranked: number, unscored: number, excludedIdeas: number, excludedDeferred: number }} counts
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
 * The candidates: every open bead carrying `execution:hitl`. Closed beads are bd's own
 * default filter; an idea is unshaped, so it is counted and left out unless asked for.
 *
 * A deferral is bd's own field and bd's own rule, so the queue reads it rather than
 * inventing a second one. `bd ready` wakes a bead whose `defer_until` has passed, but
 * `bd list` keeps reporting the stale `deferred` status the moment it was parked in, so
 * applying the wake rule to `defer_until` here keeps this list equal to bd's own view.
 * A `deferred` bead with no readable wake moment stays out: nothing says it woke.
 * @param {object} options
 * @param {Runner} options.bd
 * @param {boolean} options.includeIdeas
 * @param {number} options.now  Epoch milliseconds the deferral is judged against.
 * @returns {Promise<{ candidates: Candidate[], excludedIdeas: number, excludedDeferred: number }>}
 */
async function readCandidates({ bd, includeIdeas, now }) {
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

// ─── Queue ────────────────────────────────────────────────────────────────────

/**
 * Build the queue: read the candidates, derive each row, then order them.
 *
 * The order is total (desc), then stored score (desc), then id (asc). A tie is reachable
 * because the total is rounded and because the logarithm flattens: `ln` maps different
 * dependent counts onto the same one-decimal total. The tie-break is fixed, so two runs
 * over one backlog print byte-identical output — a queue that reordered itself between
 * reads could not be trusted to say what to do first.
 *
 * An unscored row keeps its place in the list, after the ranked rows, and carries the
 * reason. Nothing is dropped silently and no score is invented: the gap is the answer.
 *
 * @param {object} options
 * @param {Runner} options.bd
 * @param {string | undefined} [options.file]   Strategy path; defaults to the documented default.
 * @param {string} [options.cwd]
 * @param {boolean} [options.includeIdeas]
 * @param {number} [options.now]  Epoch milliseconds the deadlines are measured from.
 *                               Injectable so a tier boundary test is deterministic.
 * @returns {Promise<QueueReport>}
 */
export async function buildQueue({ bd, file, cwd = process.cwd(), includeIdeas = false, now = Date.now() }) {
  const [strategy, { candidates, excludedIdeas, excludedDeferred }] = await Promise.all([
    readStrategy({ file, cwd }),
    readCandidates({ bd, includeIdeas, now }),
  ]);
  const dependentsOf = createDependentReader(bd);

  /** @type {QueueRow[]} */
  const rows = [];
  for (const candidate of candidates) {
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
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });

  const unscored = rows
    .filter((row) => row.total === undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    strategy,
    counts: {
      ranked: ranked.length,
      unscored: unscored.length,
      excludedIdeas,
      excludedDeferred,
    },
    rows: [...ranked, ...unscored],
  };
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
 * The deadline as one clause: the factor, the distance, and the due moment, with the word
 * `OVERDUE` once the moment has passed. Empty for a bead with no deadline, which keeps the
 * factor 1 and is not ranked down for lacking one.
 * @param {QueueRow} row @returns {string}
 */
function deadlineClause(row) {
  if (row.dueAt === undefined || row.remainingMs === undefined) return '';
  const due = formatInstant(row.dueAt);
  const span = formatSpan(row.remainingMs);
  return row.overdue
    ? `  deadline ×${row.deadlineFactor} OVERDUE by ${span} (due ${due})`
    : `  deadline ×${row.deadlineFactor} in ${span} (due ${due})`;
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
 * Render the queue as text: a header naming the formula, then one block per row — its
 * numbers, then its title and what the answer unblocks.
 * @param {QueueReport} report @returns {string}
 */
export function renderQueue(report) {
  const { counts, strategy, rows } = report;
  const strategyLabel = strategy.version === undefined ? 'strategy unknown' : `strategy v${strategy.version}`;

  if (rows.length === 0) {
    const excluded = formatExcluded(counts);
    return `HITL decision queue · no open ${HITL_LABEL} beads\n${excluded}`;
  }

  const rankWidth = Math.max(1, String(counts.ranked).length);
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const totalWidth = Math.max(...rows.map((row) => (row.total === undefined ? 1 : row.total.toFixed(1).length)));

  const lines = [
    `HITL decision queue · ${counts.ranked} ranked, ${counts.unscored} unscored · ${strategyLabel}`,
    'total = rice × (1 + ln(1 + dependents)) × 1.5 in-progress × deadline tier · ties break on rice, then id · unscored last',
  ];
  const excluded = formatExcluded(counts);
  if (excluded !== '') lines.push(excluded.trimEnd());
  if (counts.ranked === 0) {
    lines.push(
      'no RICE score on any candidate — nothing can be ranked; score one with score-bead, then re-run',
    );
  }
  lines.push('');

  for (const row of rows) {
    const rank = row.rank === undefined ? '-' : String(row.rank);
    const total = row.total === undefined ? '—' : row.total.toFixed(1);
    const numbers = row.score === undefined
      ? `unscored — ${row.unscoredReason ?? 'no score'} (score it with score-bead)`
      : formatNumbers(row);
    const stale = row.stale ? `  (scored at strategy v${row.scoredAtVersion}, current v${strategy.version})` : '';
    lines.push(
      `${right(rank, rankWidth)}  ${row.id.padEnd(idWidth)}  ${right(total, totalWidth)}  ${numbers}${stale}`,
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

const USAGE = `Usage: node queue.mjs queue [--file <path>] [--include-ideas] [--cwd <dir>] [--json]

  queue   Rank the open ${HITL_LABEL} beads into one list: RICE × (1 + ln(1 + dependents))
          × 1.5 when in progress, × the strategy's deadline factor at the bead's --due.
          A bead with no score is listed as unscored, never guessed.

Options:
  --file <path>     Strategy file (default: ${DEFAULT_FILE}, relative to the repository root)
  --include-ideas   Rank ${IDEA_LABEL} beads too (they are excluded by default)
  --cwd <dir>       Directory the strategy path and bd resolve from
  --json            Print the report as JSON
  -h, --help        Show this text

Environment:
  BD_PATH   bd binary (default: bd)
`;

/**
 * Parse the CLI's argv.
 * @param {string[]} argv
 * @returns {{ command: string, file?: string, includeIdeas: boolean, cwd: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let command;
  /** @type {string | undefined} */
  let file;
  let cwd = process.cwd();
  let json = false;
  let includeIdeas = false;

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
    if (arg === '--file' || arg === '--cwd') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--cwd') cwd = value;
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
  return { command, ...(file === undefined ? {} : { file }), includeIdeas, cwd, json };
}

/**
 * @param {object} options
 * @param {string[]} options.argv                        CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]        stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError]   stderr sink; injectable for tests.
 * @param {{ bd?: Runner }} [options.deps]                 Collaborators; injectable for tests.
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

  const bd = deps.bd ?? makeRunner(BD_PATH, options.cwd);
  try {
    const report = await buildQueue({
      bd,
      cwd: options.cwd,
      includeIdeas: options.includeIdeas,
      ...(options.file === undefined ? {} : { file: options.file }),
    });
    write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderQueue(report));
    return 0;
  } catch (error) {
    writeError(`queue failed: ${errorMessage(error)}\n`);
    return 1;
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
