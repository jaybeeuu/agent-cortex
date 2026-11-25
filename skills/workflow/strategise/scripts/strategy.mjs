// @ts-check
// The strategy file: create it, validate it, version it.
//
// The prioritisation strategy is a committed document — the rubric a scorer reads
// before it judges a bead's reach, impact, confidence and effort. It is never a bead
// and never a scratch file: operational state belongs in the bead trail, and durable
// documents that are reviewed, diffed and versioned belong in git.
//
// Four subcommands, and nothing else:
//
//   node strategy.mjs init     [--file <path>]             write the template
//   node strategy.mjs validate [--file <path>]             check the shape, then print it
//   node strategy.mjs bump     [--file <path>] [--today d] raise the version, set the date
//   node strategy.mjs summary  [--file <path>]             the digest a run opens with
//
// `validate` prints the rubric to stdout only after it passes, so a scorer can never
// read a stale or malformed strategy: the file and the proof of its shape arrive
// together. Status goes to stderr, so `validate > rubric.md` captures the rubric alone.
//
// The script reads and writes one file and shells out to nothing — it never calls `bd`.
// A test puts a stub `bd` on PATH and asserts it is never invoked.
//
// Zero runtime dependencies, async fs only. `skills/*/scripts` sits outside the
// check-no-sync scan, and this script stays async anyway so the rule holds everywhere.
//
// `summary` is what the skill prints before it asks anything, and it exists so the digest
// is read off the file rather than re-derived by an agent: it validates first, then reports
// the version, the newest change-log entry, the themes, the two admissibility lists, the
// deadline factors, the theme balance and the four component level tables when the file states
// them — each one read from the file, none restated from elsewhere.
//
// Exit codes: 0 the file is valid or summarised, 1 the file is invalid or the operation
// refused, 2 the caller asked for something malformed, 3 `summary` found no strategy file —
// a first run, which the skill answers with the interview and no digest.

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ─── Contract ─────────────────────────────────────────────────────────────────

/**
 * The sections every strategy must carry, in reading order. One interview question
 * produces each one, so the template, the skill's questions and this list agree.
 * @type {readonly string[]}
 */
export const REQUIRED_SECTIONS = [
  'Current themes',
  'What counts as value',
  'How to judge confidence',
  'Explicitly out of scope',
  'How to calibrate effort',
];

/**
 * The default location, relative to the consuming repository's root: the working-docs
 * root, beside the HITL handoff directories. It is the one file in that directory the
 * repository commits.
 */
export const DEFAULT_FILE = '.agent-cortex/working-docs/strategy.md';

/**
 * The shipped template, resolved from this script rather than from a hardcoded path, so
 * it is found in both install layouts (grouped on pi, flattened on Claude Code).
 */
export const TEMPLATE_FILE = fileURLToPath(new URL('../templates/strategy.md', import.meta.url));

/**
 * The section that records why the rubric changed. Optional in a hand-written file —
 * `bump` adds it when it is absent — so a strategy created before this section existed
 * stays valid.
 */
export const CHANGE_LOG_SECTION = 'Change log';

/**
 * The section that tunes the deadline factor a ranked queue applies. Optional in a
 * hand-written file: a strategy created before the tiers existed ranks on
 * `DEFAULT_DEADLINE_TIERS`, and `init` copies a table the owner can edit.
 */
export const DEADLINE_TIERS_SECTION = 'Deadline tiers';

/**
 * The section that tunes the per-theme multiplier the ranked queue applies. Optional in a
 * hand-written file: a strategy created before the balance existed ranks on
 * `DEFAULT_THEME_BALANCE`, and `init` copies a table the owner can edit.
 */
export const THEME_BALANCE_SECTION = 'Theme balance';

/**
 * The theme balance the queue uses when the strategy carries none. Both numbers live here
 * once, as the documented default, so a caller that never opens the strategy still ranks
 * predictably; a strategy overrides them, so the balance tunes without a code change.
 *
 * `window` is how many of the newest closes are counted, and `decay` is what one serve of a
 * theme costs: a theme served n times in the window keeps `decay ** n` of its weight, and a
 * theme served not at all keeps all of it. `decay: 1` therefore disables the effect, which is
 * the documented way to turn it off without deleting the section.
 */
export const DEFAULT_THEME_BALANCE = /** @type {ThemeBalance} */ ({ window: 5, decay: 0.7 });

/**
 * The four sections that fix a component's scale: one labelled value per level, so two
 * scorers put the same bead on the same figure. Each is optional in a hand-written file, and
 * — unlike the deadline tiers — with no documented default: a default factor only changes a
 * rank, while a default level set would reject a number the owner never ruled on. `init`
 * copies tables the owner can edit, and a file with none accepts any value the component's
 * floor allows.
 *
 * `## Impact levels` shipped first and keeps its name, because a consumer's strategy already
 * carries it. The three siblings follow the same shape.
 */
export const IMPACT_LEVELS_SECTION = 'Impact levels';
export const REACH_LEVELS_SECTION = 'Reach levels';
export const CONFIDENCE_LEVELS_SECTION = 'Confidence levels';
export const EFFORT_LEVELS_SECTION = 'Effort levels';

/**
 * The deadline tiers the queue uses when the strategy carries none. The numbers live here
 * once, as the documented default, so a caller that never opens the strategy still ranks
 * predictably; a strategy overrides them, so the rise tunes without a code change.
 *
 * A boundary belongs to the tier that names it: with exactly one day left a bead earns the
 * `within 1d` factor, and a millisecond more drops it to `within 2d`. A bead whose deadline
 * is exactly now has not slipped yet, so it is not overdue; `overdue` covers the past.
 */
export const DEFAULT_DEADLINE_TIERS = /** @type {DeadlineTier[]} */ ([
  { kind: 'within', minutes: 1440, factor: 4 },
  { kind: 'within', minutes: 2880, factor: 2 },
  { kind: 'within', minutes: 10080, factor: 1.5 },
  { kind: 'beyond', minutes: 10080, factor: 1 },
  { kind: 'overdue', factor: 8 },
]);

/** The shape of a date: four digits, two, two. Whether it exists is a separate question. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A markdown heading, with its title captured. */
const HEADING = /^\s*##\s+(.*?)\s*$/;

/** The version and the date are stored as bold key/value lines, so a reader can grep them. */
const FIELD = /^[ \t]*[-*][ \t]*\*\*([A-Za-z]+):\*\*[ \t]*(\S.*?)[ \t]*$/;

/** The markup in front of a field's value, so a new value replaces the old one whole. */
const FIELD_PREFIX = /^([ \t]*[-*][ \t]*\*\*[A-Za-z]+:\*\*[ \t]*)\S.*?[ \t]*$/;

/** One change-log line: the date it landed, the version it produced, and the reason. */
const CHANGE_LOG_ENTRY = /^[ \t]*[-*][ \t]+(\d{4}-\d{2}-\d{2})[ \t]+v(\d+):[ \t]*(.+?)[ \t]*$/;

/** One row of a two-column table, with the cells the pipes delimit. */
const TABLE_ROW = /^[ \t]*\|(.*)\|[ \t]*$/;

/** The deadline table's header row, skipped as a label rather than read as a tier. */
const TIER_HEADER = /^(remaining|time|when|deadline)$/i;

/** A table's `|---|:--:|` rule, which carries no value. */
const TABLE_RULE = /^:?-{2,}:?$/;

/** The theme-balance table's header row, skipped as a label rather than read as a setting. */
const THEME_HEADER = /^(setting|settings)$/i;

/** A whole number, the only shape a window may take. */
const WHOLE_NUMBER = /^\d+$/;

/** `within 7d` and `<= 7d`: the factor earned at or inside this much time left. */
const TIER_WITHIN = /^(?:within|<=)\s+(\d+)\s*([mhd])$/i;

/** `more than 7d` and `> 7d`: the factor for anything further out. */
const TIER_BEYOND = /^(?:more than|>)\s+(\d+)\s*([mhd])$/i;

/** `overdue`: the factor for a deadline already passed. */
const TIER_OVERDUE = /^overdue$/i;

/** A table's number: a positive value, in the plain form a reader can check. */
const TABLE_NUMBER = /^\d+(?:\.\d+)?$/;

/** How long each unit in a tier row lasts. */
const TIER_UNIT_MINUTES = Object.freeze(/** @type {const} */ ({ m: 1, h: 60, d: 1440 }));

/** How many milliseconds a minute holds, for turning a tier's minutes into a distance. */
const MS_PER_MINUTE = 60_000;

/**
 * One deadline tier: the factor a bead earns at a stated distance from its deadline.
 * @typedef {{ kind: 'overdue', factor: number }
 *   | { kind: 'within', minutes: number, factor: number }
 *   | { kind: 'beyond', minutes: number, factor: number }} DeadlineTier
 */

/**
 * What `parseDeadlineTiers` found.
 * @typedef {object} DeadlineTiersReport
 * @property {boolean} ok
 * @property {DeadlineTier[]} tiers  The parsed tiers, or the documented default when absent.
 * @property {string[]} errors       One line per defect in the table.
 * @property {'file' | 'default'} source  Whether the tiers were read from the file.
 */

/**
 * The per-theme balance: how many of the newest closes are counted, and what one serve of a
 * theme costs. Both are settings the strategy states, so the ranking stays explicable from
 * the file rather than from a constant buried in a script.
 * @typedef {object} ThemeBalance
 * @property {number} window  How many of the newest non-chore closes are counted; 1 or more.
 * @property {number} decay   What one serve costs; more than 0 and at most 1. `1` disables it.
 */

/**
 * What `parseThemeBalance` found.
 * @typedef {object} ThemeBalanceReport
 * @property {boolean} ok
 * @property {ThemeBalance} balance  The parsed settings, or the documented default.
 * @property {string[]} errors       One line per defect in the table.
 * @property {'file' | 'default'} source  Whether the settings were read from the file.
 */

/**
 * One level: the label the strategy gives a step on a component's scale, and the figure it
 * is worth. The label is the word a rationale cites, so it is the reader-facing name.
 * @typedef {{ label: string, value: number }} Level
 */

/**
 * What a level-table parser found.
 * @typedef {object} LevelsReport
 * @property {boolean} ok
 * @property {Level[]} levels  The parsed levels, in the order the table writes them.
 * @property {string[]} errors       One line per defect in the table.
 * @property {'file' | 'none'} source  Whether the file states levels at all.
 */

/** The four RICE components, in the order a score names them.
 * @typedef {'reach' | 'impact' | 'confidence' | 'effort'} Component
 */

/**
 * One component's level table: the section it lives under, the words its header row may use,
 * the rule a value must satisfy, and how that rule reads in an error. The reader is one
 * function; a table is the whole of what a component changes about it.
 * @typedef {object} LevelTable
 * @property {Component} component  The RICE component the table constrains.
 * @property {string} section    The `## <section>` heading the table lives under.
 * @property {RegExp} header     The first cell's words when the row is a header, not a level.
 * @property {(value: number) => boolean} accepts  Whether a value is on the component's scale.
 * @property {string} requirement  The accepted shape, as a refusal names it.
 * @property {(text: string) => LevelsReport} parse  The wrapper that reads this table.
 */

/** A usage mistake: the caller asked for something malformed. Exit code 2. */
export class UsageError extends Error {}

/** The strategy file is absent, or its shape is wrong. Exit code 1. */
export class StrategyError extends Error {}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * What `validate` found.
 * @typedef {object} StrategyReport
 * @property {boolean} ok
 * @property {number} [version]  Present only when the version parses.
 * @property {string} [updated]  Present only when the date parses.
 * @property {string[]} errors   One line per defect, each naming the field or section.
 */

/**
 * What `bump` produced.
 * @typedef {object} BumpReport
 * @property {number} from
 * @property {number} to
 * @property {string} updated
 * @property {string} reason
 * @property {string} line  The change-log line the bump appended.
 * @property {string} text
 */

// ─── Value helpers ────────────────────────────────────────────────────────────

/**
 * Every `**Key:** value` line in the text, keyed by the lower-cased key.
 * @param {string} text @returns {Map<string, string>}
 */
function fields(text) {
  /** @type {Map<string, string>} */
  const found = new Map();
  for (const line of text.split('\n')) {
    const match = FIELD.exec(line);
    if (match === null) continue;
    const key = match[1].toLowerCase();
    if (!found.has(key)) found.set(key, match[2]);
  }
  return found;
}

/**
 * Replace the value of a `**Key:** value` line, keeping its markup and indentation.
 * Throws when the line is absent, because a bump that cannot date the file has nothing
 * honest to write.
 * @param {string} text @param {string} key @param {string} value @returns {string}
 */
function setField(text, key, value) {
  const wanted = key.toLowerCase();
  let replaced = false;
  return text
    .split('\n')
    .map((line) => {
      const match = FIELD.exec(line);
      if (replaced || match === null || match[1].toLowerCase() !== wanted) return line;
      replaced = true;
      return line.replace(FIELD_PREFIX, (_match, prefix) => `${prefix}${value}`);
    })
    .join('\n');
}

/**
 * The body lines of `## <title>`, or null when the heading is absent. The body stops at
 * the next `##` heading; a `###` sub-heading stays body.
 * @param {string[]} lines @param {string} title @returns {string[] | null}
 */
function sectionBody(lines, title) {
  const wanted = title.toLowerCase();
  const start = lines.findIndex((line) => HEADING.exec(line)?.[1].toLowerCase() === wanted);
  if (start === -1) return null;

  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (HEADING.test(line)) break;
    body.push(line);
  }
  return body;
}

/**
 * The minutes a tier row's `<number><unit>` names.
 * @param {string} count @param {string} unit @returns {number}
 */
function tierMinutes(count, unit) {
  const key = /** @type {'m'|'h'|'d'} */ (unit.toLowerCase());
  return Number(count) * TIER_UNIT_MINUTES[key];
}

/**
 * One table row as a tier, or a message naming what the row got wrong.
 * @param {string} when        The "Remaining" cell.
 * @param {string} factorText  The "Factor" cell.
 * @returns {{ tier: DeadlineTier } | { error: string }}
 */
function parseTierRow(when, factorText) {
  const factor = TABLE_NUMBER.test(factorText) ? Number(factorText) : 0;
  if (factor <= 0) return { error: `factor "${factorText}" is not a positive number` };

  if (TIER_OVERDUE.test(when)) return { tier: { kind: 'overdue', factor } };
  const within = TIER_WITHIN.exec(when);
  if (within !== null) return { tier: { kind: 'within', minutes: tierMinutes(within[1], within[2]), factor } };
  const beyond = TIER_BEYOND.exec(when);
  if (beyond !== null) return { tier: { kind: 'beyond', minutes: tierMinutes(beyond[1], beyond[2]), factor } };
  return { error: `"${when}" is not "overdue", "within <time>" or "more than <time>"` };
}

/**
 * Read the deadline tiers out of a strategy: the `## Deadline tiers` table, or the
 * documented default when the section is absent or carries no row.
 *
 * A table that is present must be complete — exactly one `overdue` row, exactly one
 * `more than <time>` row, and at least one `within <time>` row — because a factor that
 * silently fell back to a default would make the rise depend on a file the reader cannot
 * see. Every defect is reported, so one run fixes the whole table.
 * @param {string} text @returns {DeadlineTiersReport}
 */
export function parseDeadlineTiers(text) {
  const body = sectionBody(text.split('\n'), DEADLINE_TIERS_SECTION);
  if (body === null) return { ok: true, tiers: [...DEFAULT_DEADLINE_TIERS], errors: [], source: 'default' };

  /** @type {DeadlineTier[]} */
  const rows = [];
  /** @type {string[]} */
  const errors = [];
  let firstTableLine = true;

  for (const line of body) {
    const cells = TABLE_ROW.exec(line)?.[1].split('|');
    if (cells === undefined || cells.length !== 2) continue;
    const when = cells[0].trim();
    const factorText = cells[1].trim();
    const isFirst = firstTableLine;
    firstTableLine = false;
    if (isFirst && TIER_HEADER.test(when)) continue;
    if (TABLE_RULE.test(when) || TABLE_RULE.test(factorText)) continue;

    const parsed = parseTierRow(when, factorText);
    if ('error' in parsed) {
      errors.push(`${DEADLINE_TIERS_SECTION}: row "| ${when} | ${factorText} |" — ${parsed.error}`);
      continue;
    }
    rows.push(parsed.tier);
  }

  // A heading with no readable row states no tiers, so the default applies and the file is
  // not credited with a table it does not carry.
  if (rows.length === 0 && errors.length === 0) {
    return { ok: true, tiers: [...DEFAULT_DEADLINE_TIERS], errors: [], source: 'default' };
  }

  if (errors.length === 0) {
    const count = (/** @type {DeadlineTier['kind']} */ kind) => rows.filter((tier) => tier.kind === kind).length;
    if (count('overdue') !== 1) errors.push(`${DEADLINE_TIERS_SECTION}: needs exactly one "overdue" row, found ${count('overdue')}`);
    if (count('beyond') !== 1) errors.push(`${DEADLINE_TIERS_SECTION}: needs exactly one "more than <time>" row, found ${count('beyond')}`);
    if (count('within') === 0) errors.push(`${DEADLINE_TIERS_SECTION}: needs at least one "within <time>" row`);
  }

  if (errors.length > 0) return { ok: false, tiers: [...DEFAULT_DEADLINE_TIERS], errors, source: 'file' };

  const within = rows
    .filter((tier) => tier.kind === 'within')
    .sort((a, b) => (a.kind === 'within' && b.kind === 'within' ? a.minutes - b.minutes : 0));
  const beyond = rows.filter((tier) => tier.kind === 'beyond');
  const overdue = rows.filter((tier) => tier.kind === 'overdue');
  return { ok: true, tiers: [...within, ...beyond, ...overdue], errors: [], source: 'file' };
}

/**
 * Read the theme balance out of a strategy: the `## Theme balance` table, or the documented
 * default when the section is absent.
 *
 * A section that is present must be complete — one `window` row and one `decay` row — because
 * a value that silently fell back to a default would make the ranking depend on a setting the
 * reader cannot see. An unknown setting name is a defect rather than a line to skip: a number
 * the author wrote and this reader ignored would leave the balance decided by something the
 * table does not show. Every defect is reported, so one run fixes the whole table.
 *
 * A heading with no readable row states no settings, so the documented default applies and the
 * file is not credited with a table it does not carry — the same rule the deadline tiers use.
 * @param {string} text @returns {ThemeBalanceReport}
 */
export function parseThemeBalance(text) {
  const body = sectionBody(text.split('\n'), THEME_BALANCE_SECTION);
  if (body === null) return { ok: true, balance: { ...DEFAULT_THEME_BALANCE }, errors: [], source: 'default' };

  /** @type {{ window?: number, decay?: number }} */
  const stated = {};
  /** @type {string[]} */
  const errors = [];
  let firstTableLine = true;
  let rows = 0;
  let windowRow = false;
  let decayRow = false;

  for (const line of body) {
    const cells = TABLE_ROW.exec(line)?.[1].split('|');
    if (cells === undefined || cells.length !== 2) continue;
    const name = cells[0].trim();
    const valueText = cells[1].trim();
    const isFirst = firstTableLine;
    firstTableLine = false;
    if (isFirst && THEME_HEADER.test(name)) continue;
    if (TABLE_RULE.test(name) || TABLE_RULE.test(valueText)) continue;
    rows += 1;

    const row = `${THEME_BALANCE_SECTION}: row "| ${name} | ${valueText} |"`;
    const setting = name.toLowerCase();
    if (setting === 'window') windowRow = true;
    else if (setting === 'decay') decayRow = true;
    else {
      errors.push(`${row} — "${name}" is not a setting this table carries; write "window" or "decay"`);
      continue;
    }
    if (setting === 'window') {
      if (stated.window !== undefined) {
        errors.push(`${row} — "window" is already on the table, so one setting carries two values`);
        continue;
      }
      const window = WHOLE_NUMBER.test(valueText) ? Number(valueText) : Number.NaN;
      if (!Number.isInteger(window) || window < 1) {
        errors.push(`${row} — window "${valueText}" is not a positive integer of at least 1`);
        continue;
      }
      stated.window = window;
      continue;
    }
    if (stated.decay !== undefined) {
      errors.push(`${row} — "decay" is already on the table, so one setting carries two values`);
      continue;
    }
    const decay = TABLE_NUMBER.test(valueText) ? Number(valueText) : Number.NaN;
    if (!(decay > 0 && decay <= 1)) {
      errors.push(`${row} — decay "${valueText}" is not more than 0 and at most 1`);
      continue;
    }
    stated.decay = decay;
  }

  // A heading with no readable row states no settings, so the default applies.
  if (rows === 0 && errors.length === 0) {
    return { ok: true, balance: { ...DEFAULT_THEME_BALANCE }, errors: [], source: 'default' };
  }

  if (!windowRow) errors.push(`${THEME_BALANCE_SECTION}: needs a "window" row — how many of the newest closes are counted`);
  if (!decayRow) errors.push(`${THEME_BALANCE_SECTION}: needs a "decay" row — what one serve of a theme costs`);

  if (errors.length > 0) return { ok: false, balance: { ...DEFAULT_THEME_BALANCE }, errors, source: 'file' };

  return {
    ok: true,
    balance: {
      window: stated.window ?? DEFAULT_THEME_BALANCE.window,
      decay: stated.decay ?? DEFAULT_THEME_BALANCE.decay,
    },
    errors: [],
    source: 'file',
  };
}

/**
 * The `## Impact levels` table: a positive number. This is the rule #298 shipped, kept as it
 * was so a consumer's existing table keeps parsing to the same levels.
 * @type {LevelTable}
 */
const IMPACT_TABLE = {
  component: 'impact',
  section: IMPACT_LEVELS_SECTION,
  header: /^(level|impact|impact level)$/i,
  accepts: (value) => value > 0,
  requirement: 'a positive number',
  parse: parseImpactLevels,
};

/** The `## Reach levels` table: reach is a count, so a whole number of zero or more. @type {LevelTable} */
const REACH_TABLE = {
  component: 'reach',
  section: REACH_LEVELS_SECTION,
  header: /^(level|reach|reach level)$/i,
  accepts: (value) => Number.isInteger(value) && value >= 0,
  requirement: 'a whole number of zero or more',
  parse: parseReachLevels,
};

/** The `## Confidence levels` table: a probability, so more than 0 and at most 1. @type {LevelTable} */
const CONFIDENCE_TABLE = {
  component: 'confidence',
  section: CONFIDENCE_LEVELS_SECTION,
  header: /^(level|confidence|confidence level)$/i,
  accepts: (value) => value > 0 && value <= 1,
  requirement: 'more than 0 and at most 1',
  parse: parseConfidenceLevels,
};

/** The `## Effort levels` table: a cost, so greater than zero. @type {LevelTable} */
const EFFORT_TABLE = {
  component: 'effort',
  section: EFFORT_LEVELS_SECTION,
  header: /^(level|effort|effort level)$/i,
  accepts: (value) => value > 0,
  requirement: 'a positive number',
  parse: parseEffortLevels,
};

/**
 * The four level tables, in the order a score names its components. One registry, so a caller
 * that must check every component — `validateStrategy` and `rice.mjs score` — reads the list
 * once instead of naming four parsers and drifting from the fifth. Each table names the wrapper
 * that reads it, so the pair cannot drift apart either.
 * @type {readonly LevelTable[]}
 */
export const LEVEL_TABLES = [REACH_TABLE, IMPACT_TABLE, CONFIDENCE_TABLE, EFFORT_TABLE];

/**
 * Read one level table out of a strategy: the `## <section>` table, in the order the rows are
 * written. One reader for every component; `parseImpactLevels` and its three siblings are the
 * thin wrappers, so a fix here reaches all four.
 *
 * There is no default level set. A missing section leaves the component unconstrained, and
 * `score` says so when it prints the record, because a restriction the owner never wrote must
 * not decide whether a score is accepted. A section that is present but unreadable is a
 * different matter: it is an error rather than a fallback, because a rule the reader cannot
 * see must not decide the outcome either. Every defect is reported, so one run fixes the whole
 * table.
 *
 * A line that opens like a row but is not one is a defect, not a line to skip: a level the
 * author wrote and this reader dropped would leave the allowed set in silence, and the scorer
 * would then be told a value is not on a table that never said so.
 * @param {string} text @param {LevelTable} table @returns {LevelsReport}
 */
function readLevels(text, table) {
  const { section } = table;
  const body = sectionBody(text.split('\n'), section);
  if (body === null) return { ok: true, levels: [], errors: [], source: 'none' };

  /** @type {Level[]} */
  const levels = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {Set<string>} */
  const labels = new Set();
  /** @type {Set<number>} */
  const values = new Set();
  let firstTableLine = true;

  for (const line of body) {
    const cells = TABLE_ROW.exec(line)?.[1].split('|');
    if (cells === undefined) {
      // Prose and blank lines carry no row. A line that opens with a pipe does, and a row the
      // reader cannot close is a row the author wrote.
      if (line.trimStart().startsWith('|')) {
        errors.push(
          `${section}: line "${line.trim()}" is not a "| <level> | <value> |" row — every row needs two cells between two pipes`,
        );
      }
      continue;
    }
    if (cells.length !== 2) {
      errors.push(
        `${section}: line "${line.trim()}" is not a "| <level> | <value> |" row — it divides into ${cells.length} cells`,
      );
      continue;
    }
    const label = cells[0].trim();
    const valueText = cells[1].trim();
    const isFirst = firstTableLine;
    firstTableLine = false;
    if (isFirst && table.header.test(label)) continue;
    if (TABLE_RULE.test(label) || TABLE_RULE.test(valueText)) continue;

    const row = `${section}: row "| ${label} | ${valueText} |"`;
    if (label === '') {
      errors.push(`${row} — every level needs a label a rationale can cite`);
      continue;
    }
    // A value the number shape rejects becomes NaN, so the component's own rule refuses it and
    // the message repeats what the table wrote rather than a number it guessed.
    const value = TABLE_NUMBER.test(valueText) ? Number(valueText) : Number.NaN;
    if (!table.accepts(value)) {
      errors.push(`${row} — value "${valueText}" is not ${table.requirement}`);
      continue;
    }
    if (labels.has(label)) {
      errors.push(`${row} — label "${label}" is already on the table, so it names two levels`);
      continue;
    }
    if (values.has(value)) {
      errors.push(`${row} — value ${value} is already on the table, so two labels are one level`);
      continue;
    }
    labels.add(label);
    values.add(value);
    levels.push({ label, value });
  }

  if (levels.length === 0 && errors.length === 0) {
    errors.push(
      `${section}: carries no "| Level | Value |" row — write one row per level, or remove the section`,
    );
  }

  return errors.length > 0
    ? { ok: false, levels, errors, source: 'file' }
    : { ok: true, levels, errors, source: 'file' };
}

/**
 * Read the impact levels out of a strategy: the `## Impact levels` table.
 * @param {string} text @returns {LevelsReport}
 */
export function parseImpactLevels(text) {
  return readLevels(text, IMPACT_TABLE);
}

/**
 * Read the reach levels out of a strategy: the `## Reach levels` table.
 * @param {string} text @returns {LevelsReport}
 */
export function parseReachLevels(text) {
  return readLevels(text, REACH_TABLE);
}

/**
 * Read the confidence levels out of a strategy: the `## Confidence levels` table.
 * @param {string} text @returns {LevelsReport}
 */
export function parseConfidenceLevels(text) {
  return readLevels(text, CONFIDENCE_TABLE);
}

/**
 * Read the effort levels out of a strategy: the `## Effort levels` table.
 * @param {string} text @returns {LevelsReport}
 */
export function parseEffortLevels(text) {
  return readLevels(text, EFFORT_TABLE);
}

/**
 * What a deadline is worth `remainingMs` from now: the factor from the narrowest `within`
 * tier the remaining time fits inside, the overdue factor once the moment has passed, and
 * the `more than` factor beyond every tier.
 *
 * The boundaries are the whole contract, so each falls on one stated side: with exactly one
 * day left a bead earns the `within 1d` factor, and a millisecond more drops it to
 * `within 2d`; a bead whose deadline is exactly now has not slipped yet, so it is not
 * overdue.
 * @param {number} remainingMs
 * @param {DeadlineTier[]} [tiers]
 * @returns {{ factor: number, overdue: boolean }}
 */
export function deadlineMultiplier(remainingMs, tiers = DEFAULT_DEADLINE_TIERS) {
  /** @type {{ minutes: number, factor: number }[]} */
  const within = [];
  let beyond = 1;
  let overdue = 1;
  for (const tier of tiers) {
    if (tier.kind === 'within') within.push({ minutes: tier.minutes, factor: tier.factor });
    else if (tier.kind === 'beyond') beyond = tier.factor;
    else overdue = tier.factor;
  }
  within.sort((a, b) => a.minutes - b.minutes);

  if (remainingMs < 0) return { factor: overdue, overdue: true };
  for (const tier of within) {
    if (remainingMs <= tier.minutes * MS_PER_MINUTE) return { factor: tier.factor, overdue: false };
  }
  return { factor: beyond, overdue: false };
}

/**
 * Whether a body carries anything a scorer can read. An HTML comment is guidance, not
 * content, so a template copied and never filled in is empty rather than filled.
 * @param {string[]} body @returns {boolean}
 */
function hasContent(body) {
  let inComment = false;
  for (const line of body) {
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true;
      continue;
    }
    if (trimmed !== '') return true;
  }
  return false;
}

/** Today's date in UTC, as the file records it. @returns {string} */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Collapse a value onto one line, so a change-log entry stays one line. @param {string} value @returns {string} */
function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Whether `value` is a calendar date the file can commit to, not merely a date V8 can
 * parse. V8's ISO parser rolls an impossible date into the following month — `2026-02-31`
 * becomes 3 March — so `Date.parse` proves nothing here. Rebuild the date from its parts
 * and compare the round trip instead: a rolled date no longer matches what was written.
 * @param {string} value @returns {boolean}
 */
function isCalendarDate(value) {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Validate a strategy's shape: a positive-integer version, an ISO date, and every
 * required section present and carrying content. Every defect is reported, so one run
 * fixes the whole file.
 * @param {string} text @returns {StrategyReport}
 */
export function validateStrategy(text) {
  /** @type {string[]} */
  const errors = [];
  const found = fields(text);

  const rawVersion = found.get('version');
  /** @type {number | undefined} */
  let version;
  if (rawVersion === undefined) {
    errors.push('missing field: "**Version:**" — the integer this rubric revision carries');
  } else if (!/^\d+$/.test(rawVersion)) {
    errors.push(`version must be an integer, got "${rawVersion}"`);
  } else if (Number(rawVersion) < 1) {
    errors.push(`version must be 1 or more, got "${rawVersion}"`);
  } else {
    version = Number(rawVersion);
  }

  const updated = found.get('updated');
  if (updated === undefined) {
    errors.push('missing field: "**Updated:**" — the date this rubric last changed');
  } else if (!isCalendarDate(updated)) {
    errors.push(`updated must be a calendar date (YYYY-MM-DD), got "${updated}"`);
  }

  const lines = text.split('\n');
  const tiers = parseDeadlineTiers(text);
  if (!tiers.ok) errors.push(...tiers.errors);
  const balance = parseThemeBalance(text);
  if (!balance.ok) errors.push(...balance.errors);
  // Every table is read, so one run names every defect in every table the file carries: a
  // broken reach table must not hide a broken confidence table behind it.
  for (const table of LEVEL_TABLES) {
    const parsed = readLevels(text, table);
    if (!parsed.ok) errors.push(...parsed.errors);
  }

  for (const title of REQUIRED_SECTIONS) {
    const body = sectionBody(lines, title);
    if (body === null) errors.push(`missing required section: "## ${title}"`);
    else if (!hasContent(body)) errors.push(`required section is empty: "## ${title}"`);
  }

  // The change log and the version answer the same question, so they must agree: the
  // newest entry names the version the file carries. A hand-raised version, or a bump
  // whose log line was deleted, leaves the record of *why* the rubric moved missing.
  const changeLog = sectionBody(lines, CHANGE_LOG_SECTION);
  const entries = (changeLog ?? []).map((line) => CHANGE_LOG_ENTRY.exec(line)).filter((match) => match !== null);
  const newest = entries[entries.length - 1];
  if (newest !== null && newest !== undefined && version !== undefined && Number(newest[2]) !== version) {
    errors.push(
      `the newest "## ${CHANGE_LOG_SECTION}" entry names v${newest[2]} but the version is v${version} — ` +
        'run "bump --reason" to move both together, never one alone',
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    ...(version === undefined ? {} : { version }),
    ...(updated === undefined ? {} : { updated }),
  };
}

/**
 * Append one line to the change-log section, adding the section when the file has none.
 * The line lands last, because the log reads oldest first, and the section's own guidance
 * comment stays above it.
 * @param {string} text @param {string} line @returns {string}
 */
function appendChangeLog(text, line) {
  const lines = text.split('\n');
  const start = lines.findIndex((each) => HEADING.exec(each)?.[1].toLowerCase() === CHANGE_LOG_SECTION.toLowerCase());
  if (start === -1) {
    const body = text.endsWith('\n') ? text : `${text}\n`;
    return `${body}\n## ${CHANGE_LOG_SECTION}\n\n${line}\n`;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i])) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
  while (body.length > 0 && body[0].trim() === '') body.shift();
  const tail = lines.slice(end);
  // The log is one contiguous list, so the new line follows the previous one directly — but
  // a guidance comment above it is not a list item, and markdown needs a blank line there.
  const gap = body.length > 0 && body[body.length - 1].trim().endsWith('-->');
  const rebuilt = [
    ...lines.slice(0, start + 1),
    '',
    ...body,
    ...(gap ? [''] : []),
    line,
    ...(tail.length > 0 ? [''] : []),
    ...tail,
  ];
  const joined = rebuilt.join('\n');
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}

/**
 * Raise the version by one, record the date and append the one-line reason, refusing a
 * file that is not valid first: bumping a malformed rubric would only make the
 * malformation look reviewed. A bump with no reason would leave the record of *why* the
 * rubric moved missing, which is the same defect the change log exists to prevent.
 * @param {string} text
 * @param {{ today: string, reason: string }} options
 * @returns {BumpReport}
 */
export function bumpStrategy(text, { today, reason }) {
  const report = validateStrategy(text);
  if (!report.ok) {
    throw new StrategyError(`refusing to bump an invalid strategy:\n${report.errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  const cleanReason = oneLine(reason ?? '');
  if (cleanReason === '') {
    throw new StrategyError(
      'refusing to bump without a reason: pass --reason "<why the rubric changed>" so the change log says why',
    );
  }
  const from = /** @type {number} */ (report.version);
  const to = from + 1;
  const line = `- ${today} v${to}: ${cleanReason}`;
  const bumped = setField(setField(text, 'Version', String(to)), 'Updated', today);
  return { from, to, updated: today, reason: cleanReason, line, text: appendChangeLog(bumped, line) };
}

// ─── Summary ──────────────────────────────────────────────────────────────────

/**
 * How many bullets the digest quotes from each admissibility list. Two keeps the digest a
 * handful of lines; the count of what it left out points the reader back at the file.
 */
const SUMMARY_ITEMS = 2;

/** The longest one bullet may run in the digest, so one answer cannot re-print a section. */
const SUMMARY_ITEM_LENGTH = 100;

/**
 * The items under one heading: each bullet with the continuation lines that belong to it,
 * and the template's HTML-comment guidance skipped. A bullet that wraps over several lines
 * is one item, so a quoting rule is read whole rather than sliced at its first line.
 * @param {string[]} lines @param {string} title @returns {string[]}
 */
function sectionItems(lines, title) {
  const body = sectionBody(lines, title);
  if (body === null) return [];

  /** @type {string[]} */
  const items = [];
  let inComment = false;
  for (const line of body) {
    const trimmed = line.trim();
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true;
      continue;
    }
    const bullet = /^[-*][ \t]+(.+)$/.exec(trimmed);
    if (bullet !== null) {
      items.push(bullet[1].trim());
      continue;
    }
    if (trimmed === '' || items.length === 0) continue;
    items[items.length - 1] = `${items[items.length - 1]} ${trimmed}`;
  }
  return items;
}

/**
 * One item as the digest shows it, cut when it is long. A cut item says so, because a
 * silently shortened rule reads as the whole rule.
 * @param {string} item @returns {string}
 */
function shorten(item) {
  return item.length <= SUMMARY_ITEM_LENGTH ? item : `${item.slice(0, SUMMARY_ITEM_LENGTH).trimEnd()}…`;
}

/**
 * One section as a single digest line: at most `SUMMARY_ITEMS` bullets, then how many the
 * digest left out, so the reader knows the file still says more.
 * @param {string[]} items @returns {string}
 */
function digestLine(items) {
  const shown = items.slice(0, SUMMARY_ITEMS).map(shorten);
  if (shown.length === 0) return '(none written)';
  const hidden = items.length - shown.length;
  return hidden === 0 ? shown.join(' · ') : `${shown.join(' · ')} · (+${hidden} more in the file)`;
}

/**
 * A tier's distance in the largest unit that divides it, so the digest repeats the spelling
 * the table uses: 1440 minutes reads `1d`, and 90 reads `90m`.
 * @param {number} minutes @returns {string}
 */
function spanText(minutes) {
  if (minutes % TIER_UNIT_MINUTES.d === 0) return `${minutes / TIER_UNIT_MINUTES.d}d`;
  if (minutes % TIER_UNIT_MINUTES.h === 0) return `${minutes / TIER_UNIT_MINUTES.h}h`;
  return `${minutes}m`;
}

/**
 * One tier as the digest shows it: the phrase the table's row uses, then the factor.
 * @param {DeadlineTier} tier @returns {string}
 */
function tierText(tier) {
  if (tier.kind === 'overdue') return `overdue ×${tier.factor}`;
  return `${tier.kind === 'within' ? 'within' : 'more than'} ${spanText(tier.minutes)} ×${tier.factor}`;
}

/**
 * The deadline factors as one digest line, narrowest row first. The order is part of the
 * rule — the queue multiplies by the narrowest row the remaining time fits inside — so the
 * whole table prints: a truncated order would summarise a different rule.
 * @param {DeadlineTier[]} tiers @returns {string}
 */
function deadlineLine(tiers) {
  return tiers.map(tierText).join(' · ');
}

/**
 * The theme balance as one digest line. Both numbers print because the row total multiplies by
 * both: a window quoted without its decay would describe half the rule.
 * @param {ThemeBalance} balance @returns {string}
 */
function balanceLine(balance) {
  return `theme balance: window ${balance.window} · decay ${balance.decay}`;
}

/**
 * One level table as one digest line, in the order the table writes them. The order is the
 * owner's scale and the line is short, so the whole table prints: a label plus the figure a
 * scorer must match, which is exactly what a refusal names.
 * @param {Level[]} levels @returns {string}
 */
function levelLine(levels) {
  return levels.map((level) => `${level.label} ${level.value}`).join(' · ');
}

/**
 * When the rubric last changed and why: the newest change-log entry, because the log is
 * written oldest first and `validate` already proves it names the version the file carries.
 * A file with no entry says so rather than borrowing the header date as a reason.
 * @param {string[]} lines @param {string} updated @returns {string}
 */
function lastChange(lines, updated) {
  const entries = (sectionBody(lines, CHANGE_LOG_SECTION) ?? [])
    .map((line) => CHANGE_LOG_ENTRY.exec(line))
    .filter((match) => match !== null);
  const newest = entries[entries.length - 1];
  if (newest === null || newest === undefined) return `${updated} — no change-log entry, so no reason is on file`;
  return `${newest[1]} v${newest[2]}: ${newest[3]}`;
}

/**
 * The digest the skill opens with: the file it read, the version, the newest change-log
 * entry, the themes, the two admissibility lists, and the deadline factors, the theme balance
 * and the level tables when the file states them — a handful of lines, never a re-print.
 *
 * Nothing here is a ranking order, and the labels must not suggest one. `## What counts as
 * value` and `## Explicitly out of scope` are admissibility: the test a bead passes to earn
 * work, and the work the month rules out. What orders the beads that pass them is the
 * scoring rubric — RICE with its multipliers — not this file. The rule sets the file may
 * state are `## Deadline tiers`, printed in its own order, `## Theme balance`, printed as the
 * two settings the queue multiplies by, and the four level tables
 * (`## Reach levels`, `## Impact levels`, `## Confidence levels`, `## Effort levels`), printed
 * as the scale a score must land on; each is omitted entirely when the section is absent,
 * because the file is then silent on it and the documented default or no restriction applies.
 *
 * None of these is a section of its own and none must become one. `validate` gates every
 * strategy already committed, so a new required section would fail all of them.
 * @param {string} text @param {string} file @param {StrategyReport} report  A passing report.
 * @returns {string}
 */
export function summariseStrategy(text, file, report) {
  const lines = text.split('\n');
  const digest = [
    `${file} — strategy v${report.version}`,
    `  last change: ${lastChange(lines, report.updated ?? 'no date recorded')}`,
    `  themes: ${digestLine(sectionItems(lines, 'Current themes'))}`,
    `  admissibility — what counts as value: ${digestLine(sectionItems(lines, 'What counts as value'))}`,
    `  admissibility — out of scope: ${digestLine(sectionItems(lines, 'Explicitly out of scope'))}`,
  ];
  const tiers = parseDeadlineTiers(text);
  if (tiers.source === 'file') digest.push(`  deadline factors: ${deadlineLine(tiers.tiers)}`);
  const balance = parseThemeBalance(text);
  if (balance.source === 'file') digest.push(`  ${balanceLine(balance.balance)}`);
  for (const table of LEVEL_TABLES) {
    const parsed = readLevels(text, table);
    if (parsed.source === 'file') digest.push(`  ${table.component} levels: ${levelLine(parsed.levels)}`);
  }
  return `${digest.join('\n')}\n`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['init', 'validate', 'bump', 'summary']);

const USAGE = `Usage: node strategy.mjs <${COMMANDS.join('|')}> [options]

  init       Write the shipped template to the strategy path. Refuses to overwrite.
  validate   Check the shape and print the file to stdout only when it passes.
  bump       Raise the version by one, record today's date and append the reason.
  summary    Print the digest to open a run with: path, version, last change, admissibility,
             deadline factors, the theme balance, the four level tables. Exits 3 when no
             strategy file exists, so a first run is told apart from a strategy that is
             present but invalid.

Options:
  --file <path>    Strategy file (default: ${DEFAULT_FILE}, relative to the repository root)
  --today <date>   Date to record on init/bump (default: today, UTC; YYYY-MM-DD)
  --reason <text>  Why the rubric changed. Required by "bump": it becomes the change-log line.
  -h, --help       Show this text

The strategy is a committed file in the working-docs root, never a bead. This script
never writes to the tracker.
`;

/**
 * Parse the CLI's argv.
 * @param {string[]} argv
 * @returns {{ command: string, file: string, today?: string, reason?: string }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let command;
  /** @type {string | undefined} */
  let file;
  /** @type {string | undefined} */
  let today;
  /** @type {string | undefined} */
  let reason;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') {
      file = argv[++i];
      if (file === undefined) throw new UsageError('--file needs a value');
      continue;
    }
    if (arg === '--reason') {
      reason = argv[++i];
      if (reason === undefined) throw new UsageError('--reason needs a value');
      if (reason.trim() === '') throw new UsageError('--reason needs a non-empty value');
      continue;
    }
    if (arg === '--today') {
      today = argv[++i];
      if (today === undefined) throw new UsageError('--today needs a value');
      if (!isCalendarDate(today)) {
        throw new UsageError(`--today must be a calendar date (YYYY-MM-DD), got "${today}"`);
      }
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`unexpected argument: ${arg}`);
    if (command !== undefined) throw new UsageError(`unexpected argument: ${arg}`);
    if (!COMMANDS.includes(arg)) throw new UsageError(`unknown command "${arg}"`);
    command = arg;
  }

  if (command === undefined) throw new UsageError(`a command is required: ${COMMANDS.join(', ')}`);
  if (reason !== undefined && command !== 'bump') throw new UsageError('--reason only applies to "bump"');
  if (command === 'bump' && reason === undefined) {
    throw new UsageError('"bump" needs --reason "<why the rubric changed>" — the change log records it');
  }
  return { command, file: file ?? DEFAULT_FILE, ...(today === undefined ? {} : { today }), ...(reason === undefined ? {} : { reason }) };
}

/**
 * The deepest ancestor of `start`, itself included, that carries a `.git` entry — the
 * repository root the default strategy path is documented against. A worktree or submodule
 * carries `.git` as a file, so existence is the whole test. Walks with `node:fs/promises`
 * and never shells out, because this script spawns nothing. Falls back to `start` when no
 * ancestor is a repository, so a run outside one writes where the caller stands.
 *
 * Exported for the same reason as `resolveStrategyPath`: another skill's default path is
 * documented against the repository root, and two walkers would be two answers.
 * @param {string} start @returns {Promise<string>}
 */
export async function findRepositoryRoot(start) {
  const from = resolve(start);
  let directory = from;
  for (;;) {
    const found = await access(join(directory, '.git')).then(
      () => true,
      () => false,
    );
    if (found) return directory;
    const parent = dirname(directory);
    if (parent === directory) return from;
    directory = parent;
  }
}

/**
 * The absolute path of the strategy file for one run. The default path resolves against
 * the repository root, so a caller run from any subdirectory reads the one strategy the
 * repository owns; an explicit `--file` is taken as given, relative to the cwd or
 * absolute. Exported so another skill's script reads the strategy through the same rule
 * rather than re-deriving it — one strategy, one location, one resolver.
 * @param {object} [options]
 * @param {string} [options.file]  Path as the caller supplied it.
 * @param {string} [options.cwd]   Directory a relative path resolves against.
 * @returns {Promise<string>}
 */
export async function resolveStrategyPath({ file = DEFAULT_FILE, cwd = process.cwd() } = {}) {
  const base = file === DEFAULT_FILE ? await findRepositoryRoot(cwd) : cwd;
  return resolve(base, file);
}

/**
 * The one line every subcommand prints when the strategy file is not there yet. Reused so
 * `summary` and `validate` cannot drift into two descriptions of the same absence.
 * @param {string} file @returns {string}
 */
function missingMessage(file) {
  return `${file} does not exist — run "init" and interview the owner, or pass --file <path>`;
}

/**
 * Build the report text for one failed run.
 * @param {string} file @param {string[]} errors @returns {string}
 */
function formatErrors(file, errors) {
  return `${file} is not a valid strategy:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`;
}

/**
 * @param {object} options
 * @param {string[]} options.argv                     CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]    stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError] stderr sink; injectable for tests.
 * @param {string} [options.cwd]                       Directory to resolve from: the default
 *                                                     path's search start, and the base for
 *                                                     a relative --file.
 * @param {string} [options.today]                     Date to record; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({
  argv,
  write = (chunk) => process.stdout.write(chunk),
  writeError = (chunk) => process.stderr.write(chunk),
  cwd = process.cwd(),
  today,
}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return 0;
  }

  /** @type {{ command: string, file: string, today?: string, reason?: string }} */
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeError(`strategy: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  // The default path is documented as relative to the repository root, so `init` run from a
  // subdirectory writes the one strategy the root owns instead of a second one. Any other
  // `--file` — and every absolute path — is taken as given, relative to the cwd.
  const file = await resolveStrategyPath({ file: options.file, cwd });
  const date = today ?? options.today ?? todayIso();

  try {
    if (options.command === 'init') {
      let template;
      try {
        template = await readFile(TEMPLATE_FILE, 'utf8');
      } catch {
        throw new StrategyError(`the shipped template is missing at ${TEMPLATE_FILE}`);
      }
      const existing = await readFile(file, 'utf8').then(
        () => true,
        () => false,
      );
      if (existing) {
        throw new StrategyError(
          `${file} already exists — run "validate" to check it, or "bump" to record an update`,
        );
      }
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, setField(template, 'Updated', date), 'utf8');
      writeError(`✓ wrote ${file} — answer the five questions, then run "validate"\n`);
      return 0;
    }

    // `summary` separates the two states the skill answers differently: no file is a first
    // run, which takes the interview and no digest; a file that fails the shape check is
    // reported as what it is, never as the current strategy.
    if (options.command === 'summary') {
      /** @type {string} */
      let current;
      try {
        current = await readFile(file, 'utf8');
      } catch {
        writeError(`${missingMessage(file)}\n`);
        return 3;
      }
      const currentReport = validateStrategy(current);
      if (!currentReport.ok) {
        writeError(formatErrors(file, currentReport.errors));
        return 1;
      }
      write(summariseStrategy(current, file, currentReport));
      return 0;
    }

    /** @type {string} */
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      throw new StrategyError(missingMessage(file));
    }

    if (options.command === 'bump') {
      const bumped = bumpStrategy(text, { today: date, reason: options.reason ?? '' });
      const check = validateStrategy(bumped.text);
      if (!check.ok) throw new StrategyError(`the bump produced an invalid file — ${check.errors.join('; ')}`);
      await writeFile(file, bumped.text, 'utf8');
      writeError(`✓ ${file}: version ${bumped.from} → ${bumped.to}, updated ${bumped.updated}\n  change log: ${bumped.line}\n`);
      return 0;
    }

    const report = validateStrategy(text);
    if (!report.ok) {
      writeError(formatErrors(file, report.errors));
      return 1;
    }
    writeError(
      `✓ ${file}: version ${report.version}, updated ${report.updated}, ` +
        `${REQUIRED_SECTIONS.length} required sections present\n`,
    );
    write(text.endsWith('\n') ? text : `${text}\n`);
    return 0;
  } catch (error) {
    const kind = error instanceof UsageError ? 'usage' : 'failed';
    writeError(`strategy ${kind}: ${error instanceof Error ? error.message : String(error)}\n`);
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
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
