// @ts-check
// A boundary re-rank: the theme's next item against the queue's top item, both scores on screen.
//
//   node boundary.mjs boundary --theme <epic-id> [--next <id>] [--decide <stay|switch|move>]
//                               [--reason "<what the decision buys>"] [--file <path>]
//                               [--include-ideas] [--cwd <dir>] [--json]
//
// guppi works one theme — one epic — and re-ranks at every item boundary. The comparison is the
// only thing that may justify leaving: this script prints the theme's next item and the queue's
// top item with the totals the queue computed, and says which way those two numbers point.
// It adds no arithmetic, so the number a reader checks is the number the queue ranked by.
//
// It recommends; it does not switch. A run with no `--decide` writes nothing, and a run that
// names a decision writes exactly one trail entry on the theme bead, carrying the timestamp,
// both scores and the reason, so a later session reads the comparison rather than a claim.
// A decision that contradicts the recommendation needs `--reason`: a move is a judgement about
// what the break buys, and a switch against the scores is a Strategy change, not a queue result.
//
// Zero runtime dependencies, async fs only, every child process with an argv array.
//
// Exit codes: 0 an answer was printed (a comparison or a stated condition), 1 a tracker call
// failed, 2 the caller asked for something malformed.

import { pathToFileURL } from 'node:url';

import { DEFAULT_FILE } from '../../strategise/scripts/strategy.mjs';
import { BD_PATH, errorMessage, makeRunner } from '../../score-bead/scripts/rice.mjs';
import { HITL_LABEL, IDEA_LABEL, UsageError, buildQueue } from './queue.mjs';

/** @typedef {Awaited<ReturnType<typeof buildQueue>>} QueueReport */
/** @typedef {QueueReport['rows'][number]} QueueRow */

// ─── Contract ─────────────────────────────────────────────────────────────────

/**
 * The three outcomes of one boundary decision, and no fourth. `stay` continues in the theme,
 * `switch` leaves it because higher-priority work waits elsewhere, and `move` leaves it because
 * a break improves the next item. Only the first two can be read off the scores; `move` is a
 * judgement the contributor makes, so it always carries a reason of its own.
 */
export const BOUNDARY_OUTCOME = /** @type {const} */ ({
  stay: 'stay',
  switch: 'switch',
  move: 'move',
});

/**
 * The answers that are stated rather than guessed: an empty queue, a theme with nothing
 * scored, and a next item the queue does not hold. Each names its condition and one next step.
 */
export const BOUNDARY_STATE = /** @type {const} */ ({
  boundary: 'boundary',
  empty: 'empty',
  noThemeItem: 'no-theme-item',
  nextNotQueued: 'next-not-queued',
});

/**
 * The whole answer.
 * @typedef {object} BoundaryDecision
 * @property {'stay' | 'switch' | 'move'} outcome
 * @property {string} reason
 * @property {string} note       The trail entry as it was written.
 * @property {string} at         The timestamp the entry carries, ISO 8601 UTC.
 */

/**
 * @typedef {object} BoundaryAnswer
 * @property {string} state                          One of BOUNDARY_STATE.
 * @property {string} theme                          The epic the session is working in.
 * @property {string} [next]                         The next item the caller named.
 * @property {QueueReport} report
 * @property {number | undefined} strategyVersion
 * @property {QueueRow} [row]                        The theme's next item.
 * @property {QueueRow} [top]                        The queue's top item.
 * @property {'stay' | 'switch'} [recommendation]    Which way the two scores point.
 * @property {string} [reason]                       Why the scores point that way.
 * @property {BoundaryDecision} [decided]            The decision the human made, when one was named.
 */

/** The three outcome names, for reading a caller's argument against them. @type {string[]} */
const OUTCOMES = Object.values(BOUNDARY_OUTCOME);

// ─── Numbers the queue already computed ───────────────────────────────────────

/**
 * The stored total of a ranked row. A row with no total is not ranked and never reaches here;
 * the cast is the filter's promise, not a second computation.
 * @param {QueueRow} row @returns {number}
 */
function totalOf(row) {
  return /** @type {number} */ (row.total);
}

/**
 * The score as the queue prints it: one decimal, the number the rank was decided by.
 * @param {QueueRow} row @returns {string}
 */
function formatTotal(row) {
  return `total ${totalOf(row).toFixed(1)}`;
}

/** @param {string} value @returns {string} */
function collapse(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Why the two scores point where they point, in words that carry both numbers. A reader can
 * check the sentence against the two totals on the block; nothing here decides a priority the
 * block has not displayed.
 * @param {QueueRow} row @param {QueueRow} top @returns {string}
 */
export function compareReason(row, top) {
  const mine = totalOf(row).toFixed(1);
  const theirs = totalOf(top).toFixed(1);
  if (row.id === top.id) {
    return `the theme's next item is the queue's top item at ${mine}, so higher-priority work waits nowhere else`;
  }
  if (totalOf(top) > totalOf(row)) {
    return `the queue's top item scores ${theirs} against the theme's next ${mine}, so higher-priority work waits elsewhere`;
  }
  return `the theme's next item scores ${mine} against the queue's top ${theirs}, so nothing outside the theme outranks it`;
}

// ─── The theme ────────────────────────────────────────────────────────────────

/**
 * The ids of one theme's children, read from the tracker. The theme's next item is the
 * highest-ranked of these in the queue, so the comparison cannot be steered by naming a weak
 * item: the item compared is the one the theme itself would do next.
 * @param {(args: string[]) => Promise<string>} bd @param {string} theme
 * @returns {Promise<Set<string>>}
 */
async function readThemeItems(bd, theme) {
  const stdout = await bd(['children', theme, '--json']);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stdout === '' ? '[]' : stdout);
  } catch {
    throw new UsageError(`bd children ${theme} --json did not print JSON`);
  }
  if (!Array.isArray(parsed)) throw new UsageError(`bd children ${theme} --json did not print a list`);
  return new Set(parsed.flatMap((entry) => {
    const id = typeof entry === 'object' && entry !== null ? /** @type {Record<string, unknown>} */ (entry).id : undefined;
    return typeof id === 'string' ? [id] : [];
  }));
}

// ─── The comparison ───────────────────────────────────────────────────────────

/**
 * Read the queue, place the theme's next item against the queue's top item, and record the
 * decision when the caller names one.
 *
 * The recommendation is derived from the two stored totals and nothing else. The decision is
 * the caller's: it is written as one trail entry on the theme bead, which is the parent of the
 * items, so the reason survives the session that made it.
 *
 * @param {object} options
 * @param {(args: string[], scope?: { name: string }) => Promise<string>} options.bd
 * @param {string} options.theme                The epic the session is working in.
 * @param {string | undefined} [options.next]   The next item, when the caller names it.
 * @param {'stay' | 'switch' | 'move' | undefined} [options.decide]
 * @param {string | undefined} [options.reason]
 * @param {string | undefined} [options.file]   Strategy path; defaults to the documented default.
 * @param {string} [options.cwd]
 * @param {boolean} [options.includeIdeas]
 * @param {number} [options.now]                Epoch milliseconds the trail entry is stamped with.
 * @returns {Promise<BoundaryAnswer>}
 */
export async function buildBoundary({
  bd,
  theme,
  next,
  decide,
  reason,
  file,
  cwd = process.cwd(),
  includeIdeas = false,
  now = Date.now(),
}) {
  const report = await buildQueue({ bd, cwd, includeIdeas, ...(file === undefined ? {} : { file }) });
  const strategyVersion = report.strategy.version;
  const ranked = report.rows.filter((row) => row.total !== undefined);

  if (ranked.length === 0) {
    return { state: BOUNDARY_STATE.empty, theme, report, strategyVersion };
  }

  const top = /** @type {QueueRow} */ (ranked[0]);

  /** @type {QueueRow | undefined} */
  let row;
  if (next !== undefined) {
    row = ranked.find((each) => each.id === next);
    if (row === undefined) {
      return { state: BOUNDARY_STATE.nextNotQueued, theme, next, report, top, strategyVersion };
    }
  } else {
    const items = await readThemeItems(bd, theme);
    row = ranked.find((each) => items.has(each.id));
    if (row === undefined) {
      return { state: BOUNDARY_STATE.noThemeItem, theme, report, top, strategyVersion };
    }
  }

  const recommendation = top.id !== row.id && totalOf(top) > totalOf(row) ? 'switch' : 'stay';
  const derived = compareReason(row, top);

  if (decide === undefined) {
    return {
      state: BOUNDARY_STATE.boundary,
      theme,
      report,
      strategyVersion,
      row,
      top,
      recommendation,
      reason: derived,
    };
  }

  if (!OUTCOMES.includes(decide)) {
    throw new UsageError(`--decide takes ${OUTCOMES.join(', ')}, not "${decide}"`);
  }

  const given = reason === undefined ? '' : collapse(reason);
  const chosen = given === '' ? (decide === recommendation ? derived : undefined) : given;
  if (chosen === undefined) {
    throw new UsageError(
      `--decide ${decide} contradicts the recommendation (${recommendation}), so it needs --reason: name what the decision buys`,
    );
  }

  const at = new Date(now).toISOString();
  const note = `[${at}] boundary: ${decide} · theme next ${row.id} ${formatTotal(row)}` +
    ` vs queue top ${top.id} ${formatTotal(top)} · reason: ${chosen}`;
  await bd(['note', theme, note]);

  return {
    state: BOUNDARY_STATE.boundary,
    theme,
    report,
    strategyVersion,
    row,
    top,
    recommendation,
    reason: derived,
    decided: { outcome: decide, reason: chosen, note, at },
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * One side of the comparison: the bead, its total and its title. Both sides are printed on
 * every comparison, so leaving the theme is always a choice between two numbers on screen.
 * @param {string} label @param {QueueRow} row @returns {string}
 */
function side(label, row) {
  return `${label} ${row.id} · ${formatTotal(row)} · ${row.title}`;
}

/**
 * Render one answer. A comparison is the recommendation with its reason, both scores, and
 * then either the decision that was recorded or the one step that asks for it. Every other
 * state leads with `No boundary`, names the condition and offers the one step that clears it.
 * @param {BoundaryAnswer} answer @returns {string}
 */
export function renderBoundary(answer) {
  const version = answer.strategyVersion === undefined
    ? 'strategy unknown'
    : `strategy v${answer.strategyVersion}`;

  if (answer.state === BOUNDARY_STATE.boundary) {
    const row = /** @type {QueueRow} */ (answer.row);
    const top = /** @type {QueueRow} */ (answer.top);
    const lines = [
      `Boundary · theme ${answer.theme} · ${version}`,
      `recommendation: ${answer.recommendation} — ${answer.reason}`,
      side('theme next ', row),
      side('queue top  ', top),
    ];
    if (answer.decided === undefined) {
      lines.push("next: stay, switch or move is the human's call — nothing is recorded until they answer");
    } else {
      lines.push(
        `decision: ${answer.decided.outcome} — ${answer.decided.reason}`,
        `trail: ${answer.theme} · ${answer.decided.note}`,
      );
    }
    return `${lines.join('\n')}\n`;
  }

  if (answer.state === BOUNDARY_STATE.empty) {
    return `${
      [
        'No boundary · the queue is empty',
        `  no open ${HITL_LABEL} beads`,
        `next: file the theme's next item as an ${HITL_LABEL} bead, or lift a deferral with bd update <id> --status open`,
      ].join('\n')
    }\n`;
  }

  if (answer.state === BOUNDARY_STATE.nextNotQueued) {
    const named = answer.next ?? 'that bead';
    const top = /** @type {QueueRow} */ (answer.top);
    return `${
      [
        `No boundary · ${named} is not in the queue`,
        `  ${named} is not an open ${HITL_LABEL} bead carrying a score — check it with bd show ${named}`,
        `  ${side('queue top  ', top)}`,
        `next: name a scored bead from the queue, or score ${named} with score-bead`,
      ].join('\n')
    }\n`;
  }

  const top = /** @type {QueueRow} */ (answer.top);
  return `${
    [
      `No boundary · theme ${answer.theme} has no ranked item`,
      `  no scored ${HITL_LABEL} bead sits under ${answer.theme}`,
      `  ${side('queue top  ', top)}`,
      `next: name the theme's next item with --next <id>, or score it with score-bead`,
    ].join('\n')
  }\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['boundary']);

const USAGE = `Usage: node boundary.mjs boundary --theme <epic-id> [--next <id>] [--decide <outcome>]
                                      [--reason "<what the decision buys>"] [--file <path>]
                                      [--include-ideas] [--cwd <dir>] [--json]

  boundary   Compare the theme's next item against the queue's top item, print both totals and
              the recommendation the two numbers point to, and record the decision on the theme
              bead when one is named. Without --decide nothing is written: the human decides.

Options:
  --theme <epic-id>  The theme the session is working in; its children are the theme's items
  --next <id>        The theme's next item, when the caller names it instead
  --decide <outcome> ${Object.values(BOUNDARY_OUTCOME).join(', ')} — record the human's decision as a trail entry
  --reason "<text>"  Why that decision: required when it contradicts the recommendation
  --file <path>      Strategy file (default: ${DEFAULT_FILE}, relative to the repository root)
  --include-ideas    Rank ${IDEA_LABEL} beads too (they are excluded by default)
  --cwd <dir>        Directory the strategy path and bd resolve from
  --json             Print the answer as JSON
  -h, --help         Show this text

Environment:
  BD_PATH   bd binary (default: bd)
`;

/**
 * Parse the CLI's argv.
 * @param {string[]} argv
 * @returns {{ command: string, theme: string, next?: string, decide?: 'stay' | 'switch' | 'move', reason?: string, file?: string, includeIdeas: boolean, cwd: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let command;
  /** @type {string | undefined} */
  let theme;
  /** @type {string | undefined} */
  let next;
  /** @type {string | undefined} */
  let decide;
  /** @type {string | undefined} */
  let reason;
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
    if (arg === '--file' || arg === '--cwd' || arg === '--theme' || arg === '--next' || arg === '--decide' || arg === '--reason') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--cwd') cwd = value;
      else if (arg === '--theme') theme = value;
      else if (arg === '--next') next = value;
      else if (arg === '--decide') decide = value;
      else if (arg === '--reason') reason = value;
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
  if (theme === undefined) throw new UsageError('--theme is required: the epic the session is working in');
  if (decide !== undefined && !OUTCOMES.includes(decide)) {
    throw new UsageError(`--decide takes ${Object.values(BOUNDARY_OUTCOME).join(', ')}, not "${decide}"`);
  }

  return {
    command,
    theme,
    ...(next === undefined ? {} : { next }),
    ...(decide === undefined ? {} : { decide: /** @type {'stay' | 'switch' | 'move'} */ (decide) }),
    ...(reason === undefined ? {} : { reason }),
    ...(file === undefined ? {} : { file }),
    includeIdeas,
    cwd,
    json,
  };
}

/**
 * @param {object} options
 * @param {string[]} options.argv                        CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]        stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError]   stderr sink; injectable for tests.
 * @param {{ bd?: (args: string[], scope?: { name: string }) => Promise<string> }} [options.deps]
 *   Collaborators; injectable for tests.
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

  /** @type {ReturnType<typeof parseArgs>} */
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`boundary: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }

  const bd = deps.bd ?? makeRunner(BD_PATH, options.cwd);
  try {
    const answer = await buildBoundary({
      bd,
      theme: options.theme,
      cwd: options.cwd,
      includeIdeas: options.includeIdeas,
      ...(options.next === undefined ? {} : { next: options.next }),
      ...(options.decide === undefined ? {} : { decide: options.decide }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...(options.file === undefined ? {} : { file: options.file }),
    });
    write(options.json ? `${JSON.stringify(answer, null, 2)}\n` : renderBoundary(answer));
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      writeError(`boundary: ${errorMessage(error)}\n`);
      return 2;
    }
    writeError(`boundary failed: ${errorMessage(error)}\n`);
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
