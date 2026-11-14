// @ts-check
// RICE scoring for one bead: compute the score against a validated strategy, write the
// record into the bead's metadata, and propose a priority band for a reviewer to apply.
//
// Two subcommands, and the split is the point:
//
//   node rice.mjs score <bead-id> --reach <n> --impact <n> --confidence <0..1> \
//     --effort <n> --rationale "<why these numbers>" [--file <strategy>] \
//     [--at <rfc3339>] [--cwd <dir>] [--json]
//
//   node rice.mjs band <bead-id> [--cwd <dir>] [--json]
//
// `score` writes; `band` only reads and prints a proposal. Banding never sets a priority
// itself, because a score is a judgement and the band it implies is reviewed before it
// lands. P0 is an incident, so `band` neither proposes it nor touches a bead already at
// P0 — that bead is refused before any proposal exists.
//
// The rubric is the strategy file owned by the prioritise-work skill. This script reads
// it through that skill's validator and resolver, so there is one definition of a valid
// strategy and one way to find it. A missing or invalid strategy refuses the score before
// the first tracker call, so a refusal writes nothing at all.
//
// Zero runtime dependencies, async fs only, and every child process runs with an argv
// array — never a shell string, so a rationale carrying spaces or quotes reaches `bd`
// unmangled. `skills/*/scripts` sits outside the check-no-sync scan; this script stays
// async anyway so the rule holds everywhere.
//
// Exit codes: 0 the command ran, 1 it refused (bad strategy, bad bead, P0 guard),
// 2 the caller asked for something malformed.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  DEFAULT_FILE,
  resolveStrategyPath,
  validateStrategy,
} from '../../prioritise-work/scripts/strategy.mjs';

// ─── Contract ─────────────────────────────────────────────────────────────────

/** The metadata key the whole record lives under, so a reader greps one key. */
export const RICE_KEY = 'rice';

/** bd's most urgent priority. It means an incident; banding never produces it. */
export const INCIDENT_PRIORITY = 0;

/**
 * The score-to-priority bands, highest first: the first band whose floor the score
 * reaches wins. P0 is deliberately absent — a score can never raise a bead to an
 * incident, and `bandFor` throws if a table ever tries. A band above P1 would make the
 * two highest priorities indistinguishable, so the top band maps to P1.
 * @type {readonly { minScore: number, priority: number }[]}
 */
export const DEFAULT_BANDS = /** @type {const} */ ([
  { minScore: 8, priority: 1 },
  { minScore: 4, priority: 2 },
  { minScore: 1, priority: 3 },
  { minScore: 0, priority: 4 },
]);

/** The prefix that marks one historical score inside the rationale trail. */
const PRIOR_PREFIX = '[prior]';

/** A child-process call that returns stdout. @typedef {(args: string[]) => Promise<string>} Runner */

/**
 * What `score` wrote.
 * @typedef {object} RiceRecord
 * @property {number} reach
 * @property {number} impact
 * @property {number} confidence
 * @property {number} effort
 * @property {number} score
 * @property {number} strategyVersion
 * @property {string} assessedAt
 * @property {string} rationale
 */

/**
 * A record read back from metadata. Every field is optional, because the stored blob is
 * not ours alone: a hand edit or an older writer may have left some out.
 * @typedef {object} StoredRice
 * @property {number} [score]
 * @property {number} [strategyVersion]
 * @property {string} [assessedAt]
 * @property {number} [reach]
 * @property {number} [impact]
 * @property {number} [confidence]
 * @property {number} [effort]
 * @property {string} [rationale]
 */

/**
 * The bead as this script needs it.
 * @typedef {object} Bead
 * @property {string} id
 * @property {number} priority
 * @property {StoredRice | undefined} rice
 */

/**
 * The components as the caller supplied them, before validation.
 * @typedef {object} ComponentInput
 * @property {unknown} reach
 * @property {unknown} impact
 * @property {unknown} confidence
 * @property {unknown} effort
 */

/**
 * What `score` reports.
 * @typedef {object} ScoreReport
 * @property {string} bead
 * @property {RiceRecord} rice
 * @property {{ file: string, version: number }} strategy
 * @property {StoredRice | undefined} previous
 */

/**
 * What `band` reports. `command` is the argv a reviewer runs to apply the band — this
 * script never runs it.
 * @typedef {object} BandReport
 * @property {string} bead
 * @property {number} score
 * @property {number} currentPriority
 * @property {number} proposedPriority
 * @property {boolean} changed
 * @property {string[]} command
 */

/** A usage mistake: the caller asked for something malformed. Exit code 2. */
export class UsageError extends Error {}

/** The run refused: a bad strategy, an unscored bead, a P0 bead. Exit code 1. */
export class RiceError extends Error {}

// ─── Value helpers ────────────────────────────────────────────────────────────

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

/** Collapse a value onto one line, so a rationale never breaks the record's shape.
 * @param {string} value @returns {string} */
export function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/** @param {unknown} value @returns {number | undefined} */
function finiteOrUndefined(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** @param {unknown} value @returns {string | undefined} */
function stringOrUndefined(value) {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Read a number from a flag. A string is parsed, because argv is strings; anything that
 * does not parse is a usage mistake, never a silent NaN in a written record.
 * @param {unknown} value @param {string} flag @returns {number}
 */
function toNumber(value, flag) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`${flag} must be a number (got ${JSON.stringify(value)})`);
  }
  return parsed;
}

// ─── Arithmetic ───────────────────────────────────────────────────────────────

/**
 * RICE: reach × impact × confidence ÷ effort, rounded to one decimal. Rounding happens
 * once, on the total, so the stored components reproduce the stored score exactly.
 * @param {{ reach: number, impact: number, confidence: number, effort: number }} components
 * @returns {number}
 */
export function computeScore({ reach, impact, confidence, effort }) {
  return Math.round(((reach * impact * confidence) / effort) * 10) / 10;
}

/**
 * Check the components before they reach a bead: a confidence outside 0..1 is a claim
 * the caller cannot support, and a zero effort divides by zero. Reach and impact are
 * scaled judgements, so zero is allowed and only a negative value is a mistake.
 * @param {ComponentInput} input
 * @returns {{ reach: number, impact: number, confidence: number, effort: number }}
 */
export function validateComponents({ reach, impact, confidence, effort }) {
  const values = {
    reach: toNumber(reach, '--reach'),
    impact: toNumber(impact, '--impact'),
    confidence: toNumber(confidence, '--confidence'),
    effort: toNumber(effort, '--effort'),
  };
  if (values.reach < 0) throw new UsageError(`--reach must be zero or more (got ${values.reach})`);
  if (values.impact < 0) throw new UsageError(`--impact must be zero or more (got ${values.impact})`);
  if (values.confidence < 0 || values.confidence > 1) {
    throw new UsageError(`--confidence is a probability between 0 and 1 (got ${values.confidence})`);
  }
  if (values.effort <= 0) throw new UsageError(`--effort must be greater than zero (got ${values.effort})`);
  return values;
}

/**
 * The priority a score implies. Never P0: an incident is declared, not computed, and a
 * table that produced P0 fails here rather than quietly filing a bug as an incident.
 * @param {number} score
 * @param {readonly { minScore: number, priority: number }[]} [bands]
 * @returns {number}
 */
export function bandFor(score, bands = DEFAULT_BANDS) {
  const band = bands.find(({ minScore }) => score >= minScore) ?? bands[bands.length - 1];
  if (band === undefined) throw new RiceError('the band table is empty');
  if (band.priority <= INCIDENT_PRIORITY) {
    throw new RiceError(
      `the band table yields P${band.priority} for score ${score} — banding never produces P0`,
    );
  }
  return band.priority;
}

// ─── Rationale trail ──────────────────────────────────────────────────────────

/**
 * One line describing the record a re-score replaces. Everything a reader needs to audit
 * the superseded arithmetic is on it, so the old score stays checkable after the
 * components are overwritten.
 * @param {StoredRice} previous @returns {string}
 */
function priorLine(previous) {
  /** @type {Array<[string, number | undefined]>} */
  const parts = [
    ['reach', previous.reach],
    ['impact', previous.impact],
    ['confidence', previous.confidence],
    ['effort', previous.effort],
  ];
  const components = parts
    .filter((part) => part[1] !== undefined)
    .map(([name, value]) => `${name} ${value}`)
    .join(', ');
  const head = `[prior] score ${previous.score} @ strategy v${previous.strategyVersion ?? '?'}, ` +
    `assessed ${previous.assessedAt ?? 'unknown'}`;
  return components === '' ? head : `${head} (${components})`;
}

/**
 * The new rationale text: the caller's argument for the current numbers, followed by the
 * trail of scores this record replaces, oldest first and ending with the one just
 * replaced.
 *
 * The trail is appended into the rationale rather than kept in a separate field or file.
 * One metadata record then holds both the current argument and its history, `bd show`
 * renders the whole thing, and a re-score cannot drop the old number by forgetting a
 * second store. Lines are prefixed `[prior]` so a reader greps the history out of the
 * prose, and each carries the old score, components, strategy version and date.
 *
 * @param {object} input
 * @param {string} input.rationale
 * @param {StoredRice | undefined} input.previous
 * @returns {string}
 */
export function buildRationale({ rationale, previous }) {
  if (previous === undefined) return rationale;
  const carried = (previous.rationale ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PRIOR_PREFIX));
  // A record with no score is not a score: keep its trail, claim nothing about it.
  const replaced = previous.score === undefined ? [] : [priorLine(previous)];
  return [rationale, ...carried, ...replaced].join('\n');
}

// ─── Tracker ──────────────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile);

// BD_PATH lets a machine where bd is not on PATH pin a location. Nothing here names a
// repository, a branch or a host.
export const BD_PATH = process.env.BD_PATH || 'bd';

/**
 * Build a runner for one binary. argv arrays only, never a shell string.
 * @param {string} bin @param {string} cwd @returns {Runner}
 */
export function makeRunner(bin, cwd) {
  return async (args) => {
    const { stdout } = await execFileAsync(bin, args, { cwd, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  };
}

/**
 * Read a priority in bd's 0..4 scale. A value outside it is a bead this script cannot
 * judge, so it is refused rather than coerced.
 * @param {unknown} value @param {string} beadId @returns {number}
 */
function readPriority(value, beadId) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4) return value;
  if (typeof value === 'string') {
    const match = /^P?([0-4])$/i.exec(value.trim());
    if (match !== null) return Number(match[1]);
  }
  throw new RiceError(
    `bd show ${beadId} --json did not report a priority in P0..P4 (got ${JSON.stringify(value)})`,
  );
}

/**
 * The bead's metadata record, as far as a reader may rely on it.
 * @param {unknown} metadata @returns {StoredRice | undefined}
 */
function storedRice(metadata) {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const value = /** @type {Record<string, unknown>} */ (metadata)[RICE_KEY];
  if (typeof value !== 'object' || value === null) return undefined;
  const record = /** @type {Record<string, unknown>} */ (value);
  return {
    score: finiteOrUndefined(record.score),
    strategyVersion: finiteOrUndefined(record.strategyVersion),
    assessedAt: stringOrUndefined(record.assessedAt),
    reach: finiteOrUndefined(record.reach),
    impact: finiteOrUndefined(record.impact),
    confidence: finiteOrUndefined(record.confidence),
    effort: finiteOrUndefined(record.effort),
    rationale: stringOrUndefined(record.rationale),
  };
}

/**
 * Read one bead. `bd show <id> --json` prints a one-element array; a bare object is
 * accepted too, because the shape is bd's to change.
 * @param {object} options
 * @param {string} options.beadId
 * @param {Runner} options.bd
 * @returns {Promise<Bead>}
 */
export async function readBead({ beadId, bd }) {
  const stdout = await bd(['show', beadId, '--json']);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new RiceError(`bd show ${beadId} --json did not print JSON`);
  }
  const bead = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof bead !== 'object' || bead === null) throw new RiceError(`bd show ${beadId} --json printed no bead`);
  const record = /** @type {Record<string, unknown>} */ (bead);
  return {
    id: stringOrUndefined(record.id) ?? beadId,
    priority: readPriority(record.priority, beadId),
    rice: storedRice(record.metadata),
  };
}

// ─── Score ────────────────────────────────────────────────────────────────────

/**
 * Score one bead: validate the strategy, then read the bead, then write the record.
 *
 * The order is the contract. The strategy is read and validated before the first `bd`
 * call, so a missing or malformed rubric refuses the run with nothing written — not a
 * score, not a note, not a metadata key. Reach * impact * confidence / effort is computed
 * once, and the version recorded is the file's own version, read after it validated.
 *
 * @param {object} options
 * @param {string} options.beadId
 * @param {ComponentInput} options.components
 * @param {string} options.rationale
 * @param {string} [options.file]   Strategy path; defaults to the documented default.
 * @param {string} [options.at]     Assessment timestamp; defaults to now, UTC.
 * @param {string} [options.cwd]    Directory the strategy path and bd resolve from.
 * @param {{ bd?: Runner }} [options.deps]
 * @returns {Promise<ScoreReport>}
 */
export async function scoreBead({
  beadId,
  components,
  rationale,
  file,
  at = new Date().toISOString(),
  cwd = process.cwd(),
  deps = {},
}) {
  const clean = validateComponents(components);
  const cleanRationale = oneLine(rationale);
  if (cleanRationale === '') {
    throw new UsageError('--rationale is required: name the strategy section that justifies each component');
  }

  const strategyFile = await resolveStrategyPath({ ...(file === undefined ? {} : { file }), cwd });
  let strategyText;
  try {
    strategyText = await readFile(strategyFile, 'utf8');
  } catch {
    throw new RiceError(
      `${strategyFile} does not exist — write it with the prioritise-work skill, or pass --file <path>`,
    );
  }
  const strategy = validateStrategy(strategyText);
  if (!strategy.ok || strategy.version === undefined) {
    throw new RiceError(
      `${strategyFile} is not a valid strategy:\n${strategy.errors.map((error) => `  - ${error}`).join('\n')}`,
    );
  }
  const strategyVersion = strategy.version;

  const bd = deps.bd ?? makeRunner(BD_PATH, cwd);
  const bead = await readBead({ beadId, bd });
  const previous = bead.rice;

  /** @type {RiceRecord} */
  const rice = {
    ...clean,
    score: computeScore(clean),
    strategyVersion,
    assessedAt: at,
    rationale: buildRationale({ rationale: cleanRationale, previous }),
  };

  await bd(['update', bead.id, '--metadata', JSON.stringify({ [RICE_KEY]: rice })]);

  return { bead: bead.id, rice, strategy: { file: strategyFile, version: strategyVersion }, previous };
}

// ─── Band ─────────────────────────────────────────────────────────────────────

/**
 * Propose a priority band from the stored score. Read-only by construction: the only
 * tracker call is `bd show`, and the proposal leaves as a command line for a reviewer.
 *
 * A bead at P0 is refused before a proposal exists. P0 means an incident, and an
 * incident is not re-prioritised by a quarterly rubric; the guard sits here rather than
 * only in the band table, so a bead already at P0 cannot be nudged even if the table,
 * the caller or a later edit changes what the score maps to.
 *
 * @param {object} options
 * @param {string} options.beadId
 * @param {readonly { minScore: number, priority: number }[]} [options.bands]
 * @param {string} [options.cwd]    Directory bd resolves from.
 * @param {{ bd?: Runner }} [options.deps]
 * @returns {Promise<BandReport>}
 */
export async function bandBead({ beadId, bands = DEFAULT_BANDS, cwd = process.cwd(), deps = {} }) {
  const bd = deps.bd ?? makeRunner(BD_PATH, cwd);
  const bead = await readBead({ beadId, bd });

  if (bead.priority === INCIDENT_PRIORITY) {
    throw new RiceError(
      `refusing to band ${bead.id}: it is already P0, and score never raises or lowers an incident`,
    );
  }
  const rice = bead.rice;
  if (rice === undefined || rice.score === undefined) {
    throw new RiceError(`no RICE score on ${bead.id} — run "score ${bead.id}" first`);
  }

  const proposedPriority = bandFor(rice.score, bands);
  return {
    bead: bead.id,
    score: rice.score,
    currentPriority: bead.priority,
    proposedPriority,
    changed: proposedPriority !== bead.priority,
    command: ['bd', 'update', bead.id, '-p', String(proposedPriority)],
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['score', 'band']);

const USAGE = `Usage: node rice.mjs score <bead-id> --reach <n> --impact <n> --confidence <0..1> \\
    --effort <n> --rationale "<why these numbers>" [--file <path>] [--at <rfc3339>] \\
    [--cwd <dir>] [--json]
       node rice.mjs band <bead-id> [--cwd <dir>] [--json]

  score   Compute reach × impact × confidence ÷ effort (one decimal) and write it into the
          bead's metadata as {"rice":{…}}. Refuses, writing nothing, without a valid strategy.
  band    Propose a priority from the stored score. Prints the command; never runs it, and
          never touches a bead already at P0.

Options:
  --reach <n>        How much work or how many workflows this changes.
  --impact <n>       How much it matters per unit of reach.
  --confidence <0..1>  How sure the estimate is. A real figure, not a guess dressed as one.
  --effort <n>       Cost, on the strategy's calibration scale. Must be greater than zero.
  --rationale <text> Why these numbers, naming the strategy section that justifies them.
  --file <path>      Strategy file (default: ${DEFAULT_FILE}, relative to the repository root)
  --at <rfc3339>     Assessment timestamp (default: now, UTC)
  --cwd <dir>        Directory the strategy path and bd resolve from
  --json             Print the report as JSON
  -h, --help         Show this text

Environment:
  BD_PATH   bd binary (default: bd)
`;

/**
 * Parse the CLI's argv.
 * @param {string[]} argv
 * @returns {{ command: string, beadId: string, components: ComponentInput, rationale?: string, file?: string, at?: string, cwd: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string | undefined} */
  let command;
  /** @type {string | undefined} */
  let beadId;
  let cwd = process.cwd();
  let json = false;

  const VALUE_FLAGS = new Set(['--reach', '--impact', '--confidence', '--effort', '--rationale', '--file', '--at', '--cwd']);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      if (arg === '--cwd') cwd = value;
      else values[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`unexpected argument: ${arg}`);
    if (command === undefined) {
      if (!COMMANDS.includes(arg)) throw new UsageError(`unknown command "${arg}"`);
      command = arg;
      continue;
    }
    if (beadId !== undefined) throw new UsageError(`unexpected argument: ${arg}`);
    beadId = arg;
  }

  if (command === undefined) throw new UsageError(`a command is required: ${COMMANDS.join(', ')}`);
  if (beadId === undefined) throw new UsageError(`a bead id is required: rice.mjs ${command} <bead-id>`);

  return {
    command,
    beadId,
    cwd,
    json,
    components: {
      reach: values.reach,
      impact: values.impact,
      confidence: values.confidence,
      effort: values.effort,
    },
    ...(values.rationale === undefined ? {} : { rationale: values.rationale }),
    ...(values.file === undefined ? {} : { file: values.file }),
    ...(values.at === undefined ? {} : { at: values.at }),
  };
}

/**
 * @param {object} options
 * @param {string[]} options.argv                        CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]       stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError]  stderr sink; injectable for tests.
 * @param {{ bd?: Runner }} [options.deps]                Collaborators; injectable for tests.
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
    writeError(`rice: ${errorMessage(error)}\n\n${USAGE}`);
    return 2;
  }

  try {
    if (options.command === 'score') {
      const report = await scoreBead({
        beadId: options.beadId,
        components: options.components,
        rationale: options.rationale ?? '',
        cwd: options.cwd,
        deps,
        ...(options.file === undefined ? {} : { file: options.file }),
        ...(options.at === undefined ? {} : { at: options.at }),
      });

      if (options.json) {
        write(`${JSON.stringify(report, null, 2)}\n`);
        return 0;
      }
      const { rice } = report;
      write(
        `✓ ${report.bead}: score ${rice.score} = reach ${rice.reach} × impact ${rice.impact} ` +
          `× confidence ${rice.confidence} ÷ effort ${rice.effort} (strategy v${report.strategy.version})\n`,
      );
      write(`  assessed ${rice.assessedAt}\n`);
      if (report.previous !== undefined) {
        write(
          `  replaced score ${report.previous.score ?? '(none)'} @ strategy ` +
            `v${report.previous.strategyVersion ?? '?'} — kept in the rationale trail\n`,
        );
      }
      write(`  next: band ${report.bead} proposes a priority; a reviewer applies it, never the script\n`);
      return 0;
    }

    const band = await bandBead({ beadId: options.beadId, cwd: options.cwd, deps });
    if (options.json) {
      write(`${JSON.stringify(band, null, 2)}\n`);
      return 0;
    }
    const movement = band.changed ? '' : ', unchanged';
    write(`✓ ${band.bead}: score ${band.score} → P${band.proposedPriority} (currently P${band.currentPriority}${movement})\n`);
    write(`  proposal only — review the components and the rationale, then apply: ${band.command.join(' ')}\n`);
    return 0;
  } catch (error) {
    const kind = error instanceof UsageError ? 'usage' : 'failed';
    writeError(`rice ${kind}: ${errorMessage(error)}\n`);
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
