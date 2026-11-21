// @ts-check
// One recommendation: the queue's top row, and the line of the strategy that justifies it.
//
//   node recommend.mjs recommend [--why "<strategy line>"] [--bead <id>] [--file <path>]
//                                [--include-ideas] [--cwd <dir>] [--json]
//
// The queue ranks; this script names one row of that ranking to a session that has to decide.
// It adds no arithmetic: the total, the four components, both multipliers and the dependent
// list are the ones `buildQueue` already derived, so there is one definition of the score and
// no second copy of it to drift. The one thing it adds is the justification — a quote from the
// committed strategy, which must appear in that file. A quote the file does not contain is
// refused (exit 2), so an invented reason fails here instead of reaching the human.
//
// Nothing is recommended unless it is ranked and justified. A missing strategy, no scores at
// all, an empty queue, a bead the human named that the queue does not hold, and a queue whose
// every scored bead an open bead blocks are five stated conditions, each with one next step,
// and none of them guesses a bead. A row the queue withheld is named as withheld, never
// printed as the answer: a gate nobody can close yet is not the one item to say out loud.
//
// Zero runtime dependencies, async fs only, every child process with an argv array.
//
// Exit codes: 0 an answer was printed (a recommendation or a stated condition), 1 a tracker
// call failed, 2 the caller asked for something malformed.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { DEFAULT_FILE, resolveStrategyPath, validateStrategy } from '../../strategise/scripts/strategy.mjs';
import { BD_PATH, errorMessage, makeRunner } from '../../score-bead/scripts/rice.mjs';
import {
  HITL_LABEL,
  IDEA_LABEL,
  UsageError,
  buildQueue,
  formatExcluded,
  formatNumbers,
  formatUnblocks,
} from './queue.mjs';

/** @typedef {ReturnType<typeof buildQueue> extends Promise<infer R> ? R : never} QueueReport */
/** @typedef {QueueReport['rows'][number]} QueueRow */

// ─── Contract ─────────────────────────────────────────────────────────────────

/**
 * The five states are deliberately different answers, not five shades of failure: a reader can
 * tell "write a strategy" from "score a bead" from "there is nothing to decide" from "the only
 * scored beads are blocked" by the first line alone, and each one offers the step that clears it.
 */
export const RECOMMEND_STATE = /** @type {const} */ ({
  recommend: 'recommend',
  noStrategy: 'no-strategy',
  unscored: 'unscored',
  empty: 'empty',
  blocked: 'blocked',
  notInQueue: 'not-in-queue',
});

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The whole answer.
 * @typedef {object} Recommendation
 * @property {string} state                    One of RECOMMEND_STATE.
 * @property {string} file                     The strategy file the run looked for.
 * @property {string[]} [strategyErrors]       Why no line could be quoted from it.
 * @property {number} [strategyVersion]        The rubric version, when the file parsed.
 * @property {QueueReport} [report]            The queue the answer was read from.
 * @property {QueueRow} [row]                  The bead presented, when one is.
 * @property {QueueRow} [top]                  The queue's own top row, when it differs from `row`.
 * @property {string} [named]                  The bead id the caller named.
 * @property {string} [why]                    The strategy line, reused verbatim from the file.
 * @property {string} [whySection]             The section that line sits under.
 */

// ─── Strategy ─────────────────────────────────────────────────────────────────

/**
 * The strategy text, or the reasons no line can be quoted from it. A missing file and an
 * invalid one are the same state to a reader — there is no usable rubric — but the reason
 * names which one happened, so the next step is obvious.
 * @param {string} file
 * @returns {Promise<{ text: string } | { errors: string[] }>}
 */
async function readStrategy(file) {
  /** @type {string} */
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      return { errors: ['no file at that path — write one with strategise'] };
    }
    throw error;
  }
  const report = validateStrategy(text);
  return report.ok ? { text } : { errors: report.errors };
}

/** @param {string} value @returns {string} */
function collapse(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Every line of the file that states a rule, with the section it sits under. Comment blocks
 * hold guidance for the owner writing the rubric, not the rubric itself, so they are skipped:
 * a quote must be the owner's own words or it justifies nothing.
 * @param {string} text
 * @returns {{ text: string, section: string | undefined }[]}
 */
export function quotableLines(text) {
  /** @type {{ text: string, section: string | undefined }[]} */
  const out = [];
  /** @type {string | undefined} */
  let section;
  let inComment = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      continue;
    }
    if (line.startsWith('<!--')) {
      inComment = !line.includes('-->');
      continue;
    }
    const heading = /^##\s+(.*?)\s*$/.exec(line);
    if (heading !== null) {
      section = heading[1];
      continue;
    }
    if (line === '') continue;
    out.push({ text: line.replace(/^[-*]\s+/, ''), section });
  }
  return out;
}

/**
 * The line a quote names, and the section it sits under. The match is on collapsed
 * whitespace, so a quote wraps the way the reader's terminal does; the returned line is the
 * file's own text, so the recommendation repeats the rubric rather than a paraphrase of it.
 * @param {string} text @param {string} quote
 * @returns {{ line: string, section: string | undefined } | undefined}
 */
export function findQuote(text, quote) {
  const wanted = collapse(quote);
  if (wanted === '') return undefined;
  for (const candidate of quotableLines(text)) {
    if (collapse(candidate.text).includes(wanted)) {
      return { line: candidate.text, section: candidate.section };
    }
  }
  return undefined;
}

// ─── Recommendation ───────────────────────────────────────────────────────────

/**
 * Read the queue, then name the one row the session should say out loud.
 *
 * The row is the queue's own: `report.rows[0]` for a cold start, or the row carrying the id
 * the human named. Naming a bead outside the queue is not silently replaced by the queue's
 * choice — it is stated, with the top choice beside it, because the human's choice stands and
 * only the disagreement needs saying. A row the queue withheld — a scored bead an open bead
 * blocks — is never named as the answer: when every scored candidate is withheld, or when the
 * human names one of them, the answer is the `blocked` condition, which says what holds it and
 * what closes it.
 *
 * @param {object} options
 * @param {(args: string[]) => Promise<string>} options.bd
 * @param {string | undefined} [options.file]   Strategy path; defaults to the documented default.
 * @param {string} [options.cwd]
 * @param {string | undefined} [options.why]    The strategy line that justifies the choice.
 * @param {string | undefined} [options.bead]   A bead the human named.
 * @param {boolean} [options.includeIdeas]
 * @returns {Promise<Recommendation>}
 */
export async function buildRecommendation({ bd, file, cwd = process.cwd(), why, bead, includeIdeas = false }) {
  const strategyFile = await resolveStrategyPath({ ...(file === undefined ? {} : { file }), cwd });
  const strategy = await readStrategy(strategyFile);
  if ('errors' in strategy) {
    return { state: RECOMMEND_STATE.noStrategy, file: strategyFile, strategyErrors: strategy.errors };
  }

  const report = await buildQueue({ bd, cwd, includeIdeas, ...(file === undefined ? {} : { file }) });
  const top = report.rows[0];
  const held = report.withheld;

  /** @type {QueueRow} */
  let row;
  if (bead === undefined) {
    // The only scored candidates an open bead holds: there is no answerable row, so the run
    // states the blockage instead of naming a row nobody can act on.
    if (report.counts.ranked === 0 && held.length > 0) {
      return { state: RECOMMEND_STATE.blocked, file: strategyFile, report, strategyVersion: report.strategy.version };
    }
    if (report.rows.length === 0) {
      return { state: RECOMMEND_STATE.empty, file: strategyFile, report, strategyVersion: report.strategy.version };
    }
    if (report.counts.ranked === 0) {
      return { state: RECOMMEND_STATE.unscored, file: strategyFile, report, strategyVersion: report.strategy.version };
    }
    row = /** @type {QueueRow} */ (top);
  } else {
    const named = report.rows.find((each) => each.id === bead);
    if (named === undefined) {
      if (held.some((each) => each.id === bead)) {
        return {
          state: RECOMMEND_STATE.blocked,
          file: strategyFile,
          report,
          strategyVersion: report.strategy.version,
          named: bead,
        };
      }
      const ranked = top !== undefined && top.score !== undefined;
      return {
        state: RECOMMEND_STATE.notInQueue,
        file: strategyFile,
        report,
        strategyVersion: report.strategy.version,
        named: bead,
        ...(ranked ? { top } : {}),
      };
    }
    if (named.score === undefined) {
      return {
        state: RECOMMEND_STATE.unscored,
        file: strategyFile,
        report,
        strategyVersion: report.strategy.version,
        named: bead,
        row: named,
      };
    }
    row = named;
  }

  if (why === undefined || collapse(why) === '') {
    // A caller reading the queue structurally (`--json`) may name the row before choosing the
    // line; the text render refuses to print a recommendation without one.
    return {
      state: RECOMMEND_STATE.recommend,
      file: strategyFile,
      strategyVersion: report.strategy.version,
      report,
      row,
      ...(top === undefined || top.id === row.id ? {} : { top }),
      ...(bead === undefined ? {} : { named: bead }),
    };
  }
  const quote = findQuote(strategy.text, why);
  if (quote === undefined) {
    throw new UsageError(
      `no line of ${strategyFile} contains "${collapse(why)}" — quote the rubric itself, never a summary of it`,
    );
  }

  return {
    state: RECOMMEND_STATE.recommend,
    file: strategyFile,
    strategyVersion: report.strategy.version,
    report,
    row,
    ...(top === undefined || top.id === row.id ? {} : { top }),
    ...(bead === undefined ? {} : { named: bead }),
    why: quote.line,
    ...(quote.section === undefined ? {} : { whySection: quote.section }),
  };
}

// ─── Render ───────────────────────────────────────────────────────────────────

/** @param {number} count @param {string} noun @returns {string} */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The one line that notes the queue's own choice, for the case where the human named another
 * bead. It states the disagreement without reopening it: the human's choice stands.
 * @param {QueueRow} row @returns {string}
 */
function topNote(row) {
  return `queue top: ${row.id} · total ${/** @type {number} */ (row.total).toFixed(1)} · ${row.title}`;
}

/**
 * Render one answer. A recommendation is five lines: which bead and its total, its title, the
 * score components and both multipliers, what answering it unblocks, and the strategy line
 * that justifies it. Every other state leads with `No recommendation` and names the condition
 * and the one step that clears it.
 * @param {Recommendation} recommendation @returns {string}
 */
export function renderRecommendation(recommendation) {
  const { state } = recommendation;

  if (state === RECOMMEND_STATE.recommend) {
    const row = /** @type {QueueRow} */ (recommendation.row);
    if (recommendation.why === undefined) {
      throw new UsageError(`--why needs the line of ${recommendation.file} that justifies ${row.id}`);
    }
    const version = recommendation.strategyVersion === undefined
      ? 'strategy unknown'
      : `strategy v${recommendation.strategyVersion}`;
    const lines = [
      `Recommendation · ${row.id} · total ${/** @type {number} */ (row.total).toFixed(1)} · ${version}`,
      row.title,
      formatNumbers(row),
      formatUnblocks(row),
      `why: "${recommendation.why}"${recommendation.whySection === undefined ? '' : ` · ${recommendation.whySection}`}`,
    ];
    if (recommendation.top !== undefined) lines.push(topNote(recommendation.top));
    return `${lines.join('\n')}\n`;
  }

  if (state === RECOMMEND_STATE.noStrategy) {
    return `${
      [
        'No recommendation · no usable strategy',
        `  file: ${recommendation.file}`,
        ...(recommendation.strategyErrors ?? []).map((error) => `  - ${error}`),
        'next: write or fix the strategy with strategise, then run this again',
      ].join('\n')
    }\n`;
  }

  const report = /** @type {QueueReport} */ (recommendation.report);

  if (state === RECOMMEND_STATE.empty) {
    const excluded = formatExcluded(report.counts).trimEnd();
    return `${
      [
        'No recommendation · the queue is empty',
        `  no open ${HITL_LABEL} beads`,
        ...(excluded === '' ? [] : [`  ${excluded}`]),
        'next: file the decision as an execution:hitl bead, or lift a deferral with bd update <id> --status open',
      ].join('\n')
    }\n`;
  }

  if (state === RECOMMEND_STATE.unscored) {
    const named = recommendation.row;
    const subject = named === undefined
      ? `${plural(report.rows.length, `open ${HITL_LABEL} bead`)}, none carrying a RICE score`
      : `${named.id} carries no RICE score (${named.unscoredReason ?? 'no score'})`;
    return `${
      [
        'No recommendation · nothing is scored',
        `  ${subject}`,
        `next: score ${named === undefined ? 'one' : named.id} with score-bead, then run this again`,
      ].join('\n')
    }\n`;
  }

  if (state === RECOMMEND_STATE.blocked) {
    const heldRow = report.withheld.find((each) => each.id === recommendation.named);
    if (heldRow === undefined) {
      return `${
        [
          'No recommendation · nothing is answerable yet',
          `  ${plural(report.withheld.length, 'scored bead')} an open bead blocks`,
          `  ${report.withheld.map((each) => `${each.id} (blocked by ${each.blockedBy.join(', ')})`).join('; ')}`,
          'next: close what blocks one of them, then run this again',
        ].join('\n')
      }\n`;
    }
    return `${
      [
        `No recommendation · ${heldRow.id} is held by an open bead`,
        `  ${heldRow.title} — blocked by ${heldRow.blockedBy.join(', ')}`,
        `next: close ${heldRow.blockedBy.join(', ')}, then run this again`,
      ].join('\n')
    }\n`;
  }

  const named = recommendation.named ?? 'that bead';
  return `${
    [
      `No recommendation · ${named} is not in the queue`,
      `  ${named} is not an open ${HITL_LABEL} bead — check it with bd show ${named}`,
      ...(recommendation.top === undefined ? [] : [`  ${topNote(recommendation.top)}`]),
      'next: name a bead from the queue, or file this one as execution:hitl',
    ].join('\n')
  }\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['recommend']);

const USAGE = `Usage: node recommend.mjs recommend [--why "<strategy line>"] [--bead <id>] [--file <path>]
                                       [--include-ideas] [--cwd <dir>] [--json]

  recommend   Print one recommendation: the queue's top row, the four score components, both
              multipliers, what answering it unblocks, and the line of the strategy that
              justifies it. A missing strategy, no scores, an empty queue, every scored bead
              held by an open bead, or a named bead the queue does not hold each print the
              condition and one next step instead.

Options:
  --why "<line>"    A line of the strategy that justifies the choice; must appear in the file
  --bead <id>       Recommend the bead the human named, with the queue's own top noted
  --file <path>     Strategy file (default: ${DEFAULT_FILE}, relative to the repository root)
  --include-ideas   Rank ${IDEA_LABEL} beads too (they are excluded by default)
  --cwd <dir>       Directory the strategy path and bd resolve from
  --json            Print the answer as JSON
  -h, --help        Show this text

Environment:
  BD_PATH   bd binary (default: bd)
`;

/**
 * Parse the CLI's argv.
 * @param {string[]} argv
 * @returns {{ command: string, file?: string, why?: string, bead?: string, includeIdeas: boolean, cwd: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let command;
  /** @type {string | undefined} */
  let file;
  /** @type {string | undefined} */
  let why;
  /** @type {string | undefined} */
  let bead;
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
    if (arg === '--file' || arg === '--cwd' || arg === '--why' || arg === '--bead') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--cwd') cwd = value;
      else if (arg === '--why') why = value;
      else if (arg === '--bead') bead = value;
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
    ...(why === undefined ? {} : { why }),
    ...(bead === undefined ? {} : { bead }),
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
 * @param {{ bd?: (args: string[]) => Promise<string> }} [options.deps]  Collaborators; injectable for tests.
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
    writeError(`recommend: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }

  const bd = deps.bd ?? makeRunner(BD_PATH, options.cwd);
  try {
    const recommendation = await buildRecommendation({
      bd,
      cwd: options.cwd,
      includeIdeas: options.includeIdeas,
      ...(options.file === undefined ? {} : { file: options.file }),
      ...(options.why === undefined ? {} : { why: options.why }),
      ...(options.bead === undefined ? {} : { bead: options.bead }),
    });
    write(options.json ? `${JSON.stringify(recommendation, null, 2)}\n` : renderRecommendation(recommendation));
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      writeError(`recommend: ${errorMessage(error)}\n`);
      return 2;
    }
    writeError(`recommend failed: ${errorMessage(error)}\n`);
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
