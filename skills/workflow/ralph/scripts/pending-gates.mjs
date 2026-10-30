// Resolves which beads are waiting on a human, and which are merely parked
// behind their own pipeline.
//
// Ralph schedules new parent features only when nothing is pending human action.
// The distinction that matters is *unblocked*, not *open*: `create-chores`
// pre-creates a `lifecycle:feature-pr` gate for every planned feature, blocked
// behind that feature's own document chore. Such a gate is parked — the feature
// has not reached its PR stage — and must never stop dispatch. Only once the
// document chore closes does the gate unblock, and that is the state in which a
// feature genuinely awaits a human merge.
//
// Zero dependencies: run with `node pending-gates.mjs`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

/** The structural label every feature PR gate carries, whatever its axis. */
export const FEATURE_GATE_LABEL = 'lifecycle:feature-pr';

/** Epics whose PR into `main` awaits a human merge. */
export const EPIC_GATE_LABEL = 'awaiting-epic-pr-merge';

// Two-axis migration: gates created before the `execution:afk/hitl` migration
// carry `implementation-type:hitl`, gates created after carry `execution:hitl`.
// Both mean "a human must act", so the query matches either.
export const HITL_GATE_LABELS = ['execution:hitl', 'implementation-type:hitl'];

/** @typedef {{ id: string, title?: string }} Bead */
/** @typedef {{ id: string, title: string, kind: 'feature-pr' | 'epic-pr' }} PendingAction */

/**
 * @typedef {object} GateState
 * @property {PendingAction[]} pendingHumanAction  Beads a human must act on now — non-empty means "do not schedule new parent features".
 * @property {Array<{ id: string, title: string }>} parked  Open gates still blocked behind their own pipeline; informational only.
 */

/**
 * Split open gates into those awaiting a human now and those still parked.
 *
 * @param {object} input
 * @param {Bead[]} input.readyGates            Open gates with no active blockers.
 * @param {Bead[]} input.openGates             Every open gate, blocked or not.
 * @param {Bead[]} input.epicsAwaitingMerge    Epics tagged `awaiting-epic-pr-merge`.
 * @returns {GateState}
 */
export function resolveGateState({ readyGates, openGates, epicsAwaitingMerge }) {
  const actionable = new Set(readyGates.map((bead) => bead.id));

  const pendingHumanAction = [
    ...readyGates.map((bead) => pendingAction(bead, 'feature-pr')),
    ...epicsAwaitingMerge.map((bead) => pendingAction(bead, 'epic-pr')),
  ];

  const parked = openGates
    .filter((bead) => !actionable.has(bead.id))
    .map((bead) => ({ id: bead.id, title: bead.title ?? '' }));

  return { pendingHumanAction, parked };
}

/**
 * @param {Bead} bead
 * @param {'feature-pr' | 'epic-pr'} kind
 * @returns {PendingAction}
 */
function pendingAction(bead, kind) {
  return { id: bead.id, title: bead.title ?? '', kind };
}

// BD_PATH env override lets machines where bd is not on PATH pin a location.
const BD_PATH = process.env.BD_PATH || 'bd';
const execFileAsync = promisify(execFile);

/** @type {(args: string[]) => Promise<string>} */
async function defaultExec(args) {
  const { stdout } = await execFileAsync(BD_PATH, args, { encoding: 'utf-8' });
  return stdout;
}

/**
 * Query bd for the current gate state.
 *
 * @param {object} [options]
 * @param {(args: string[]) => Promise<string>} [options.exec]  bd runner; injectable for tests.
 * @returns {Promise<GateState>}
 */
export async function fetchGateState({ exec = defaultExec } = {}) {
  const gateFilter = ['-l', FEATURE_GATE_LABEL, '--label-any', HITL_GATE_LABELS.join(',')];

  // `bd ready` is blocker-aware: it returns only gates whose document chore has
  // closed, i.e. the ones genuinely awaiting a human merge.
  const readyGates = JSON.parse(await exec(['ready', '--json', ...gateFilter]));
  const openGates = JSON.parse(await exec(['list', '--json', '--limit', '0', ...gateFilter]));
  const epicsAwaitingMerge = JSON.parse(await exec(['list', '--json', '--limit', '0', '-l', EPIC_GATE_LABEL]));

  return resolveGateState({ readyGates, openGates, epicsAwaitingMerge });
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE = 'Usage: node pending-gates.mjs\n\nPrints { pendingHumanAction, parked } as JSON.\n';

class UsageError extends Error {}

/**
 * @param {object} options
 * @param {string[]} options.argv                              CLI arguments (without node/script).
 * @param {(args: string[]) => Promise<string>} [options.exec]  bd runner; injectable for tests.
 * @param {(chunk: string) => void} [options.write]             stdout sink; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({ argv, exec = defaultExec, write = (chunk) => process.stdout.write(chunk) }) {
  if (argv.includes('--help') || argv.includes('-h')) {
    write(USAGE);
    return 0;
  }
  if (argv.length > 0) throw new UsageError(`unexpected argument: ${argv[0]}`);

  write(`${JSON.stringify(await fetchGateState({ exec }), null, 2)}\n`);
  return 0;
}

// Only run the CLI when invoked directly, so tests can import the pure resolver.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli({ argv: process.argv.slice(2) })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = error instanceof UsageError ? 2 : 1;
    });
}
