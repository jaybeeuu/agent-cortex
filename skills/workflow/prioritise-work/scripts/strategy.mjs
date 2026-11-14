// @ts-check
// The strategy file: create it, validate it, version it.
//
// The prioritisation strategy is a committed document — the rubric a scorer reads
// before it judges a bead's reach, impact, confidence and effort. It is never a bead
// and never a scratch file: operational state belongs in the bead trail, and durable
// documents that are reviewed, diffed and versioned belong in git.
//
// Three subcommands, and nothing else:
//
//   node strategy.mjs init     [--file <path>]             write the template
//   node strategy.mjs validate [--file <path>]             check the shape, then print it
//   node strategy.mjs bump     [--file <path>] [--today d] raise the version, set the date
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
// Exit codes: 0 the file is valid, 1 the file is invalid or the operation refused,
// 2 the caller asked for something malformed.

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

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['init', 'validate', 'bump']);

const USAGE = `Usage: node strategy.mjs <${COMMANDS.join('|')}> [options]

  init       Write the shipped template to the strategy path. Refuses to overwrite.
  validate   Check the shape and print the file to stdout only when it passes.
  bump       Raise the version by one, record today's date and append the reason.

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
 * @param {string} start @returns {Promise<string>}
 */
async function findRepositoryRoot(start) {
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
 * The absolute path a subcommand reads or writes. The default path is documented as
 * relative to the repository root, so a run from a subdirectory reaches the one strategy
 * the root owns instead of writing a second one. Any other `--file` — and every absolute
 * path — is taken as given, relative to `cwd`.
 * @param {{ file?: string, cwd?: string }} options
 * @returns {Promise<string>}
 */
export async function resolveStrategyFile({ file = DEFAULT_FILE, cwd = process.cwd() } = {}) {
  const base = file === DEFAULT_FILE ? await findRepositoryRoot(cwd) : cwd;
  return resolve(base, file);
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

  // The default path resolves against the repository root; an explicit --file does not.
  const file = await resolveStrategyFile({ file: options.file, cwd });
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

    /** @type {string} */
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      throw new StrategyError(
        `${file} does not exist — run "init" and interview the owner, or pass --file <path>`,
      );
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
