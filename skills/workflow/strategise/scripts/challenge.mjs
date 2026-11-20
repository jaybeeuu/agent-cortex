// @ts-check
// Turn a priority challenge into a strategy review, and refuse a silent reorder.
//
// "This should be higher" is a signal that the rubric is wrong, stale or shifted — not an
// instruction to edit one score. The only way an item moves is for the rubric that produces
// its score to change, and a rubric change is a `bump`: a new version, a new date, and one
// line in the change log saying why. This script is that rule made mechanical.
//
// It reads the strategy file, checks the version actually moved, diffs the order before
// against the order after, and prints one bead-trail entry recording the challenge and its
// resolution. It never writes to the tracker and never edits the strategy file: the trail
// entry is appended by the caller with `bd note`.
//
// The entry embeds the words the human used, so it must reach `bd` as data and never as a
// shell string. `--out <path>` writes the entry to a file, and `bd note <bead> --file
// <path>` reads it back verbatim — no quoting, no expansion, nothing to escape.
//
// The trail entry's shape is `run-pipeline-stage/scripts/trail-entry.mjs`'s — the header
// with a content fingerprint, then Outcome, Evidence and What is left. That script is the
// repo's one trail writer, and importing it across skills would break in the flat Claude
// Code install, so the four lines are rendered here instead and a test pins this renderer
// to that one.
//
// Zero runtime dependencies, async fs only. `skills/*/scripts` sits outside the
// check-no-sync scan, and this script stays async anyway so the rule holds everywhere.
//
//   node challenge.mjs record --bead <id> --challenge "<words the human used>" \
//     --resolution <changed|no-change> --reason "<one line>" --from-version <n> \
//     [--before <ids>] [--after <ids>] [--file <path>] [--at <rfc3339>] [--out <path>] \
//     [--json]
//
// Exit codes: 0 recorded, 1 refused, 2 the caller asked for something malformed.

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { DEFAULT_FILE, UsageError, resolveStrategyPath, validateStrategy } from './strategy.mjs';

// ─── Contract ─────────────────────────────────────────────────────────────────

/** The two resolutions a strategy review can reach. @typedef {'changed' | 'no-change'} Resolution */

/**
 * Both are valid outcomes. "no-change" is not a failure: the challenge was answered by the
 * rubric as written, and the trail records that answer.
 * @type {readonly Resolution[]}
 */
export const RESOLUTIONS = /** @type {const} */ (['changed', 'no-change']);

/** The stage this entry carries. The trail reads a stage per entry, so a challenge has one. */
export const STAGE = 'challenge';

/** A resolved challenge ends the same way whether or not the rubric moved. */
export const OUTCOME = /** @type {const} */ ('done');

/** The fingerprint width, matching trail-entry.mjs. */
const FINGERPRINT_LENGTH = 16;

/** A refusal: the recording would hide the thing it exists to expose. Exit code 1. */
export class ChallengeError extends Error {}

/** One item that moved. Positions are 1-based, 1 being the top of the order.
 * @typedef {object} Move
 * @property {string} id
 * @property {number} from
 * @property {number} to
 * @property {number} delta  Positive when the item moved up.
 */

/**
 * What a positional diff found.
 * @typedef {object} OrderDiff
 * @property {Move[]} moved      In both orders, at a different position.
 * @property {{ id: string, to: number }[]} added     Only in the new order.
 * @property {{ id: string, from: number }[]} dropped Only in the old order.
 * @property {boolean} identical
 */

/**
 * A recorded challenge.
 * @typedef {object} ChallengeReport
 * @property {string} bead
 * @property {Resolution} resolution
 * @property {number} fromVersion
 * @property {number} version
 * @property {string} updated
 * @property {string} reason
 * @property {string} evidence
 * @property {string} remaining
 * @property {string} entry
 * @property {string} fingerprint
 * @property {OrderDiff} [order]  Absent when the caller named no order.
 */

// ─── Value helpers ────────────────────────────────────────────────────────────

/** Collapse a value onto one line, so a field never breaks the entry's shape.
 * @param {string} value @returns {string} */
export function oneLine(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Split a comma-separated order into bead ids. A duplicate id would make "where did it
 * move to" ambiguous, so it is rejected rather than silently deduplicated.
 * @param {string} value @returns {string[]}
 */
export function parseOrder(value) {
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (ids.length === 0) throw new UsageError('an order needs at least one bead id');
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new UsageError(`the order names "${id}" twice`);
    seen.add(id);
  }
  return ids;
}

/**
 * Diff two ranked id lists by position. Deterministic: items are reported by their new
 * position, then the arrivals, then the departures by their old position, so two runs over
 * the same input print the same words in the same order.
 *
 * The maps are filled from the lists, so iterating them already yields ascending positions;
 * the sorts keep that order true whatever order the maps were filled in.
 * @param {string[]} before @param {string[]} after @returns {OrderDiff}
 */
export function diffOrder(before, after) {
  /** @type {Map<string, number>} */
  const beforeAt = new Map(before.map((id, index) => [id, index + 1]));
  /** @type {Map<string, number>} */
  const afterAt = new Map(after.map((id, index) => [id, index + 1]));

  /** @type {Move[]} */
  const moved = [];
  /** @type {{ id: string, to: number }[]} */
  const added = [];
  /** @type {{ id: string, from: number }[]} */
  const dropped = [];

  for (const [id, to] of afterAt) {
    const from = beforeAt.get(id);
    if (from === undefined) added.push({ id, to });
    else if (from !== to) moved.push({ id, from, to, delta: from - to });
  }
  for (const [id, from] of beforeAt) {
    if (!afterAt.has(id)) dropped.push({ id, from });
  }

  moved.sort((a, b) => a.to - b.to);
  added.sort((a, b) => a.to - b.to);
  dropped.sort((a, b) => a.from - b.from);

  return { moved, added, dropped, identical: moved.length === 0 && added.length === 0 && dropped.length === 0 };
}

/**
 * Name every movement in one clause, so the trail says what moved rather than that
 * something did.
 * @param {OrderDiff} diff @returns {string}
 */
export function describeMoves(diff) {
  const parts = [
    ...diff.moved.map((move) => `${move.id} #${move.from}→#${move.to}`),
    ...diff.added.map((entry) => `${entry.id} new at #${entry.to}`),
    ...diff.dropped.map((entry) => `${entry.id} dropped from #${entry.from}`),
  ];
  return parts.length === 0 ? 'nothing moved' : parts.join(', ');
}

// ─── The trail entry ──────────────────────────────────────────────────────────

/**
 * The entry's content fingerprint, computed the way trail-entry.mjs computes it: the same
 * fields fired twice are the same entry, so a repeated fire appends no near-duplicate.
 * @param {object} input
 * @param {string} input.beadId
 * @param {string} input.stage
 * @param {string} input.outcome
 * @param {string} input.evidence
 * @param {string} input.remaining
 * @returns {string}
 */
export function fingerprintEntry({ beadId, stage, outcome, evidence, remaining }) {
  const key = [beadId, stage, outcome, evidence, remaining, '', '', '', ''].join('\u0000');
  return createHash('sha256').update(key).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

/**
 * The note text: a timestamped header carrying the fingerprint, then the three mandatory
 * fields. No refs line — a challenge names no commit, branch or pull request.
 * @param {object} input
 * @param {string} input.at
 * @param {string} input.stage
 * @param {string} input.outcome
 * @param {string} input.evidence
 * @param {string} input.remaining
 * @param {string} input.fingerprint
 * @returns {string}
 */
export function buildEntry({ at, stage, outcome, evidence, remaining, fingerprint }) {
  return [
    `[${at}] [${stage}] trail:${fingerprint}`,
    `Outcome: ${outcome}`,
    `Evidence: ${oneLine(evidence)}`,
    `What is left: ${oneLine(remaining)}`,
  ].join('\n');
}

// ─── The review ───────────────────────────────────────────────────────────────

/**
 * Hold one challenge against the strategy file and decide what may be recorded.
 *
 * Three refusals, and each one is a failure mode this skill exists to prevent:
 *  - the strategy is invalid, so no score can honestly be judged against it;
 *  - the resolution says "changed" but the version did not rise, or says "no-change" while
 *    the version rose — the record would contradict the file;
 *  - the order moved while the version stayed put. That is the silent reorder itself.
 *
 * @param {object} input
 * @param {string} input.text        The strategy file's contents.
 * @param {string} input.beadId
 * @param {string} input.challenge   The words the human used.
 * @param {Resolution} input.resolution
 * @param {string} input.reason      Why the rubric did or did not change.
 * @param {number} input.fromVersion The version the challenged order was scored against.
 * @param {string[]} [input.before]
 * @param {string[]} [input.after]
 * @param {string} input.at
 * @returns {ChallengeReport}
 */
export function reviewChallenge({ text, beadId, challenge, resolution, reason, fromVersion, before, after, at }) {
  const strategy = validateStrategy(text);
  if (!strategy.ok) {
    throw new ChallengeError(
      'the strategy is not valid, so no score can be judged against it:\n' +
        strategy.errors.map((error) => `  - ${error}`).join('\n'),
    );
  }
  const version = /** @type {number} */ (strategy.version);
  const updated = /** @type {string} */ (strategy.updated);
  const cleanReason = oneLine(reason);
  if (cleanReason === '') throw new ChallengeError('a challenge is recorded with its reasoning — pass --reason');
  if (oneLine(challenge) === '') throw new ChallengeError('a challenge is recorded with the words that raised it — pass --challenge');

  if (before === undefined !== (after === undefined)) {
    throw new ChallengeError('--before and --after go together: one order to compare is not a comparison');
  }
  const order = before !== undefined && after !== undefined ? diffOrder(before, after) : undefined;

  if (resolution === 'changed') {
    if (version <= fromVersion) {
      throw new ChallengeError(
        `resolution "changed" but the strategy version did not rise (v${fromVersion} → v${version}): ` +
          'edit the rubric, then run "bump --reason", or record "no-change" if the rubric stands',
      );
    }
    if (order === undefined) {
      throw new ChallengeError('resolution "changed" needs --before and --after, so the record names what moved');
    }
  } else if (version !== fromVersion) {
    throw new ChallengeError(
      `the strategy version moved (v${fromVersion} → v${version}), so the resolution is "changed", not "no-change"`,
    );
  }

  // The guard, whichever way round the caller passed the arguments: an order that moved
  // while the version stayed put is a score edited without the rubric moving.
  if (order !== undefined && !order.identical && version === fromVersion) {
    throw new ChallengeError(
      `the order moved (${describeMoves(order)}) but the strategy stayed at v${version}: ` +
        'a reorder without a rubric change is the silent reorder this skill refuses — ' +
        'change the rubric and bump, or leave the order alone',
    );
  }

  const evidence =
    resolution === 'changed'
      ? `challenged "${oneLine(challenge)}"; strategy v${fromVersion} → v${version} (updated ${updated}); ` +
        `rubric reason: ${cleanReason}; order ${/** @type {string[]} */ (after).length} items, ` +
        `${/** @type {OrderDiff} */ (order).moved.length} moved: ${describeMoves(/** @type {OrderDiff} */ (order))}`
      : `challenged "${oneLine(challenge)}" against v${version} (updated ${updated}); ` +
        `no rubric change: ${cleanReason}; the order did not move`;

  const remaining =
    resolution === 'changed'
      ? `nothing — scores are re-ranked against strategy v${version}`
      : `nothing — the queue stands and the challenge is answered`;

  const fingerprint = fingerprintEntry({ beadId, stage: STAGE, outcome: OUTCOME, evidence, remaining });
  return {
    bead: beadId,
    resolution,
    fromVersion,
    version,
    updated,
    reason: cleanReason,
    evidence: oneLine(evidence),
    remaining,
    entry: buildEntry({ at, stage: STAGE, outcome: OUTCOME, evidence, remaining, fingerprint }),
    fingerprint,
    ...(order === undefined ? {} : { order }),
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/** @type {readonly string[]} */
export const COMMANDS = /** @type {const} */ (['record']);

const USAGE = `Usage: node challenge.mjs record [options]

  record   Check the challenge against the strategy and print one bead-trail entry.

Options:
  --bead <id>           The bead whose priority was challenged. Required.
  --challenge <words>   What the human said. Required.
  --resolution <r>      changed | no-change. Required.
  --reason <text>       Why the rubric changed, or why it stands. Required.
  --from-version <n>    Strategy version the challenged order was scored against. Required.
  --before <ids>        The order before the review, highest first, comma-separated.
  --after <ids>         The order after the review, highest first, comma-separated.
  --file <path>         Strategy file (default: ${DEFAULT_FILE}, relative to the repository root)
  --at <rfc3339>        Timestamp for the entry header (default: now, UTC)
  --out <path>          Write the entry to a path, so the tracker reads it as data. Use this.
  --json                Print a machine report instead of the entry text
  -h, --help            Show this text

stdout is the trail entry alone; status goes to stderr. Append it from a file, never as a
shell string: the entry carries the words the human used, and a quote in those words must
not end the quoting.

  node challenge.mjs record … --out /tmp/entry.txt
  bd note <bead> --file /tmp/entry.txt

\`bd note <bead> "$(cat /tmp/entry.txt)"\` is the same thing: a command substitution is data,
not shell code, so nothing in the entry is expanded twice. This script never writes to the
tracker and never edits the strategy file.
`;

/**
 * Parse the CLI's argv.
 * @param {string[]} argv
 * @returns {{ command: string, bead: string, challenge: string, resolution: Resolution,
 *   reason: string, fromVersion: number, before?: string[], after?: string[],
 *   file: string, at?: string, out?: string, json: boolean }}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const values = {};
  /** @type {string | undefined} */
  let command;
  let json = false;

  /** @type {readonly string[]} */
  const flags = ['--bead', '--challenge', '--resolution', '--reason', '--from-version', '--before', '--after', '--file', '--at', '--out'];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (flags.includes(arg)) {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      values[arg] = value;
      continue;
    }
    if (arg.startsWith('-')) throw new UsageError(`unexpected argument: ${arg}`);
    if (command !== undefined) throw new UsageError(`unexpected argument: ${arg}`);
    if (!COMMANDS.includes(arg)) throw new UsageError(`unknown command "${arg}"`);
    command = arg;
  }

  if (command === undefined) throw new UsageError(`a command is required: ${COMMANDS.join(', ')}`);
  for (const required of ['--bead', '--challenge', '--resolution', '--reason', '--from-version']) {
    if (values[required] === undefined) throw new UsageError(`${required} is required`);
  }

  const resolution = values['--resolution'];
  if (!RESOLUTIONS.includes(/** @type {Resolution} */ (resolution))) {
    throw new UsageError(`--resolution must be ${RESOLUTIONS.join(' or ')}, got "${resolution}"`);
  }

  const rawVersion = values['--from-version'];
  if (!/^\d+$/.test(rawVersion)) throw new UsageError(`--from-version must be an integer, got "${rawVersion}"`);

  return {
    command,
    bead: values['--bead'],
    challenge: values['--challenge'],
    resolution: /** @type {Resolution} */ (resolution),
    reason: values['--reason'],
    fromVersion: Number(rawVersion),
    ...(values['--before'] === undefined ? {} : { before: parseOrder(values['--before']) }),
    ...(values['--after'] === undefined ? {} : { after: parseOrder(values['--after']) }),
    file: values['--file'] ?? DEFAULT_FILE,
    ...(values['--at'] === undefined ? {} : { at: values['--at'] }),
    ...(values['--out'] === undefined ? {} : { out: values['--out'] }),
    json,
  };
}

/**
 * @param {object} options
 * @param {string[]} options.argv                      CLI arguments (without node/script).
 * @param {(chunk: string) => void} [options.write]     stdout sink; injectable for tests.
 * @param {(chunk: string) => void} [options.writeError] stderr sink; injectable for tests.
 * @param {string} [options.cwd]                        Directory to resolve from.
 * @param {string} [options.now]                        Timestamp for the entry; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({
  argv,
  write = (chunk) => process.stdout.write(chunk),
  writeError = (chunk) => process.stderr.write(chunk),
  cwd = process.cwd(),
  now,
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
    writeError(`challenge: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  const file = await resolveStrategyPath({ file: options.file, cwd });

  try {
    /** @type {string} */
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      throw new ChallengeError(`${file} does not exist — there is no rubric to challenge; run "strategy.mjs init" and interview the owner`);
    }

    const report = reviewChallenge({
      text,
      beadId: options.bead,
      challenge: options.challenge,
      resolution: options.resolution,
      reason: options.reason,
      fromVersion: options.fromVersion,
      before: options.before,
      after: options.after,
      at: options.at ?? now ?? new Date().toISOString(),
    });

    if (options.out !== undefined) {
      await writeFile(resolve(cwd, options.out), `${report.entry}\n`, 'utf8');
      writeError(`  entry: ${resolve(cwd, options.out)}\n`);
    }

    if (options.json) {
      write(`${JSON.stringify({ file, ...report }, null, 2)}\n`);
    } else {
      write(`${report.entry}\n`);
    }

    // The entry must reach the tracker as data, so the hint names a file and never a quoted
    // string. A caller that passed no --out is told how to get one.
    const next =
      options.out === undefined
        ? `  next: bd note ${report.bead} --file <path> — pass --out <path> to write the entry there`
        : `  next: bd note ${report.bead} --file ${resolve(cwd, options.out)}`;

    writeError(
      `✓ ${report.bead}: resolution=${report.resolution}, strategy v${report.fromVersion} → v${report.version}` +
        (report.order === undefined ? '\n' : `\n  moved: ${describeMoves(report.order)}\n`) +
        `${next}\n`,
    );
    return 0;
  } catch (error) {
    const kind = error instanceof UsageError ? 'usage' : 'refused';
    writeError(`challenge ${kind}: ${error instanceof Error ? error.message : String(error)}\n`);
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
