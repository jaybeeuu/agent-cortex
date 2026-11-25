// @ts-check
// One recommendation, and the list it came from: the queue's top rows, and the line of the
// strategy that justifies the first one.
//
//   node recommend.mjs recommend [--why "<strategy line>"] [--bead <id>] [--file <path>]
//                                [--include-ideas] [--cwd <dir>] [--json]
//   node recommend.mjs shortlist [--top 10] [--why "<strategy line>"] [--file <path>]
//                                [--include-ideas] [--cwd <dir>] [--json]
//
// The queue ranks; this script names one row of that ranking to a session that has to decide,
// and shows the first ten rows to a session that has to challenge it.
// It adds no arithmetic: the total, the four components, every multiplier and the dependent
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
// `shortlist` exists because a single recommendation has no surface to be challenged on. A wrong
// top pick and a right one read identically when the runner-up is hidden, so the shortlist shows
// the first ten rows — one line each, the top one marked — and the order plus the components that
// produced it are the argument. It ranks nothing either: it slices the queue's own rows, so a
// row's position and numbers are exactly what the queue derived. A row a human picks from that
// list is a challenge to the strategy, never a reorder, and the render says so.
//
// Zero runtime dependencies, async fs only, every child process with an argv array.
//
// Exit codes: 0 an answer was printed (a recommendation, a shortlist, or a stated condition), 1 a
// tracker call failed, 2 the caller asked for something malformed.

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
  formatScoreClause,
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

/**
 * How many rows a shortlist shows when the caller names no count. A session says one item; the
 * list it was read from is ten, because a top pick nobody can see the runner-up of cannot be
 * argued with. `--top` moves it, and the render states what it left out.
 */
export const SHORTLIST_DEFAULT_TOP = 10;

/**
 * The command that prints the rows a shortlist left out. The shortlist is a window on the
 * queue, so the whole list is always one documented command away, never a lost row.
 */
export const FULL_QUEUE_COMMAND = 'node <skill-scripts>/queue.mjs queue';

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

/**
 * The whole shortlist: the queue's own first rows, in the queue's own order, with the top one
 * marked as the recommendation.
 * @typedef {object} Shortlist
 * @property {string} state                    One of RECOMMEND_STATE.
 * @property {string} file                     The strategy file the run looked for.
 * @property {string[]} [strategyErrors]       Why no line could be quoted from it.
 * @property {number} [strategyVersion]        The rubric version, when the file parsed.
 * @property {QueueReport} [report]            The queue the answer was read from.
 * @property {QueueRow[]} [rows]               The rows shown, in the queue's order.
 * @property {number} [omitted]                Rows the queue held beyond the rows shown.
 * @property {number} [top]                    How many rows the run was asked to show.
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
 * The strategy and the queue the answer is read from: what every command in this file starts
 * from. A file that cannot be quoted from is returned as its defects, not as a report.
 * @param {object} options
 * @param {(args: string[]) => Promise<string>} options.bd
 * @param {string | undefined} options.file
 * @param {string} options.cwd
 * @param {import("./scopes.mjs").Scope[]} [options.scopes]
 * @param {boolean} [options.includeIdeas]
 * @returns {Promise<{ strategyFile: string, text: string, report: QueueReport } | { strategyFile: string, strategyErrors: string[] }>}
 */
async function readQueue({ bd, file, cwd, includeIdeas, scopes }) {
  const strategyFile = await resolveStrategyPath({ ...(file === undefined ? {} : { file }), cwd });
  const strategy = await readStrategy(strategyFile);
  if ('errors' in strategy) return { strategyFile, strategyErrors: strategy.errors };
  const report = await buildQueue({ bd, cwd, includeIdeas, scopes, ...(file === undefined ? {} : { file }) });
  return { strategyFile, text: strategy.text, report };
}

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
 * @param {import("./scopes.mjs").Scope[]} [options.scopes]
 * @param {boolean} [options.includeIdeas]
 * @returns {Promise<Recommendation>}
 */
export async function buildRecommendation({ bd, file, cwd = process.cwd(), why, bead, includeIdeas = false, scopes }) {
  const loaded = await readQueue({ bd, file, cwd, includeIdeas, scopes });
  if ('strategyErrors' in loaded) {
    return { state: RECOMMEND_STATE.noStrategy, file: loaded.strategyFile, strategyErrors: loaded.strategyErrors };
  }

  const { strategyFile, text, report } = loaded;
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
  const quote = findQuote(text, why);
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

/**
 * Read the queue, then show its first rows with the top one marked as the recommendation.
 *
 * The rows, their order and every number on them are the queue's own: `report.rows` in the
 * order `buildQueue` ranked them, sliced to `top`. Nothing is re-sorted, nothing is recomputed,
 * and no row is promoted — the ranking is the answer and the list is its evidence.
 *
 * The stated conditions are the one-item path's, reached in the same order, so a shortlist
 * never prints a list where the queue has nothing to rank. A shortlist that could not justify
 * its top row still prints the rows, with no `why:` line: the human sees the arithmetic the
 * order rests on, and the missing rubric line is visible as its absence.
 *
 * @param {object} options
 * @param {(args: string[]) => Promise<string>} options.bd
 * @param {string | undefined} [options.file]   Strategy path; defaults to the documented default.
 * @param {string} [options.cwd]
 * @param {string | undefined} [options.why]    The strategy line that justifies the top row.
 * @param {boolean} [options.includeIdeas]
 * @param {import("./scopes.mjs").Scope[]} [options.scopes]
 * @param {number} [options.top]                Rows to show; defaults to SHORTLIST_DEFAULT_TOP.
 * @returns {Promise<Shortlist>}
 */
export async function buildShortlist({
  bd,
  file,
  cwd = process.cwd(),
  why,
  includeIdeas = false,
  top = SHORTLIST_DEFAULT_TOP,
  scopes,
}) {
  const loaded = await readQueue({ bd, file, cwd, includeIdeas, scopes });
  if ('strategyErrors' in loaded) {
    return { state: RECOMMEND_STATE.noStrategy, file: loaded.strategyFile, strategyErrors: loaded.strategyErrors };
  }

  const { strategyFile, text, report } = loaded;
  const strategyVersion = report.strategy.version;

  if (report.counts.ranked === 0 && report.withheld.length > 0) {
    return { state: RECOMMEND_STATE.blocked, file: strategyFile, report, strategyVersion };
  }
  if (report.rows.length === 0) {
    return { state: RECOMMEND_STATE.empty, file: strategyFile, report, strategyVersion };
  }
  if (report.counts.ranked === 0) {
    return { state: RECOMMEND_STATE.unscored, file: strategyFile, report, strategyVersion };
  }

  const rows = report.rows.slice(0, top);
  /** @type {Shortlist} */
  const shortlist = {
    state: RECOMMEND_STATE.recommend,
    file: strategyFile,
    report,
    strategyVersion,
    rows,
    omitted: report.rows.length - rows.length,
    top,
  };
  if (why === undefined || collapse(why) === '') return shortlist;

  const quote = findQuote(text, why);
  if (quote === undefined) {
    throw new UsageError(
      `no line of ${strategyFile} contains "${collapse(why)}" — quote the rubric itself, never a summary of it`,
    );
  }
  return {
    ...shortlist,
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
 * score components and every multiplier, what answering it unblocks, and the strategy line
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

/**
 * The line under the rows: how many the queue held beyond the ones shown, and the command that
 * shows them — or the statement that there was nothing to leave out. A shortlist that cut the
 * list silently would let a reader think the tenth row was the last one.
 * @param {Shortlist} shortlist @returns {string}
 */
export function formatShortlistTail(shortlist) {
  const rows = shortlist.rows ?? [];
  const omitted = shortlist.omitted ?? 0;
  if (omitted > 0) return `${omitted} omitted, see them with ${FULL_QUEUE_COMMAND}`;
  return `the list is complete — all ${plural(rows.length, 'eligible bead')}`;
}

/**
 * Render the shortlist as text: a header naming how many rows of how many it shows, then one
 * line per bead — its rank, scope, id, total, title, score components, what it unblocks — with
 * the top row marked as the recommendation, then the truncation line and the route a different
 * row takes.
 *
 * Every condition other than a list is the one-item path's own text, rendered by the same
 * function, so a degraded shortlist and a degraded recommendation never drift apart.
 * @param {Shortlist} shortlist @returns {string}
 */
export function renderShortlist(shortlist) {
  if (shortlist.state !== RECOMMEND_STATE.recommend) {
    return renderRecommendation(/** @type {Recommendation} */ (shortlist));
  }

  const report = /** @type {QueueReport} */ (shortlist.report);
  const rows = /** @type {QueueRow[]} */ (shortlist.rows);
  const { counts, strategy } = report;
  const version = strategy.version === undefined ? 'strategy unknown' : `strategy v${strategy.version}`;

  const head = [
    `HITL shortlist · ${rows.length} of ${report.rows.length} eligible · ` +
      `${counts.ranked} ranked, ${counts.unscored} unscored · ${version}`,
  ];
  const excluded = formatExcluded(counts).trimEnd();
  if (excluded !== '') head.push(excluded);
  if (shortlist.why !== undefined) {
    const section = shortlist.whySection === undefined ? '' : ` · ${shortlist.whySection}`;
    head.push(`why: "${shortlist.why}"${section}`);
  }

  const rankWidth = Math.max(1, ...rows.map((row) => (row.rank === undefined ? 1 : String(row.rank).length)));
  const scopeWidth = Math.max(...rows.map((row) => row.scope.length));
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const totalWidth = Math.max(...rows.map((row) => (row.total === undefined ? 1 : row.total.toFixed(1).length)));

  const lines = [...head, ''];
  for (const [index, row] of rows.entries()) {
    const rank = row.rank === undefined ? '-' : String(row.rank);
    const total = row.total === undefined ? '—' : row.total.toFixed(1);
    const stale = row.stale ? `  (scored at strategy v${row.scoredAtVersion}, current v${strategy.version})` : '';
    const marker = index === 0 ? '  ·  ← recommendation' : '';
    lines.push(
      `${rank.padStart(rankWidth)}  ${row.scope.padEnd(scopeWidth)}  ${row.id.padEnd(idWidth)}  ` +
        `${total.padStart(totalWidth)}  ${row.title}  ·  ${formatScoreClause(row)}${stale}  ·  ${formatUnblocks(row)}${marker}`,
    );
  }

  lines.push('', formatShortlistTail(shortlist));
  if (rows.length > 1) {
    lines.push('a row other than the top is a priority challenge — run strategise, never a reorder');
  }
  return `${lines.join('\n')}\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['recommend', 'shortlist']);

const USAGE = `Usage: node recommend.mjs recommend [--why "<strategy line>"] [--bead <id>] [--file <path>]
                                       [--include-ideas] [--cwd <dir>] [--json]
       node recommend.mjs shortlist [--top ${SHORTLIST_DEFAULT_TOP}] [--why "<strategy line>"] [--file <path>]
                                       [--include-ideas] [--cwd <dir>] [--json]

  recommend   Print one recommendation: the queue's top row, the four score components, both
              multipliers, what answering it unblocks, and the line of the strategy that
              justifies it. A missing strategy, no scores, an empty queue, every scored bead
              held by an open bead, or a named bead the queue does not hold each print the
              condition and one next step instead.

  shortlist   Print the queue's first ${SHORTLIST_DEFAULT_TOP} eligible beads as one ranked list, one line per
              bead, with the top row marked as the recommendation. Each line carries the rank,
              scope, id, total, title, the four score components, every multiplier, the due
              moment where one exists, and what answering it unblocks. Fewer eligible beads
              than asked for says the list is complete; more states how many were omitted and
              the command that shows them. The rows, their order and every number are the
              queue's own: nothing is recomputed and nothing is re-sorted.

Options:
  --why "<line>"    A line of the strategy that justifies the choice; must appear in the file
  --top <n>         Rows a shortlist shows (default: ${SHORTLIST_DEFAULT_TOP}); a larger number is never
                    needed, because the omission line names the command that shows every row
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
 * @returns {{ command: string, file?: string, why?: string, bead?: string, top?: number, includeIdeas: boolean, cwd: string, json: boolean }}
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
  /** @type {number | undefined} */
  let top;
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
    if (arg === '--top') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError('--top needs a value');
      if (!/^\d+$/.test(value) || Number(value) < 1) throw new UsageError(`--top needs a positive whole number, got "${value}"`);
      top = Number(value);
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
  if (top !== undefined && command !== 'shortlist') {
    throw new UsageError('--top belongs to shortlist, not recommend: recommend prints one row');
  }
  return {
    command,
    ...(file === undefined ? {} : { file }),
    ...(why === undefined ? {} : { why }),
    ...(bead === undefined ? {} : { bead }),
    ...(top === undefined ? {} : { top }),
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
    if (options.command === 'shortlist') {
      const shortlist = await buildShortlist({
        bd,
        cwd: options.cwd,
        includeIdeas: options.includeIdeas,
        ...(options.top === undefined ? {} : { top: options.top }),
        ...(options.file === undefined ? {} : { file: options.file }),
        ...(options.why === undefined ? {} : { why: options.why }),
      });
      write(options.json ? `${JSON.stringify(shortlist, null, 2)}\n` : renderShortlist(shortlist));
      return 0;
    }
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
