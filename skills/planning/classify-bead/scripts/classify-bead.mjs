// Deterministic bead classifier — resolves an AFK/HITL classification from
// evidence already present on a bead before any model judgement is spent.
//
// Tier order (see skills/planning/classify-bead/SKILL.md):
//   1. implementation-type label   — an existing decision is authoritative
//   2. legacy ## Type field        — back-compat with pre-label beads
//   3. conservative heuristics     — explicit natural-language signals only
//   4. escalate                    — hand to the rubric (small/cheap model)
//
// Zero dependencies: run with `node classify-bead.mjs <bead-id>`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

/** @typedef {'afk' | 'hitl'} Classification */
/** @typedef {'label' | 'type-field' | 'heuristic'} ResolutionSource */

/**
 * @typedef {object} Resolution
 * @property {Classification | null} classification  Resolved class, or null when the rubric must decide.
 * @property {ResolutionSource | null} source        Which tier produced the resolution.
 * @property {string} reason                         Human-readable justification for the resolution.
 * @property {boolean} escalate                      True when model judgement is required (tier 4).
 */

const AFK_LABEL = 'implementation-type:afk';
const HITL_LABEL = 'implementation-type:hitl';

// Heuristic signals are deliberately conservative: they only fire on explicit
// natural-language phrasing that maps directly onto the rubric's criteria.
// Anything short of that escalates to the rubric rather than guessing.

// Rubric: a human is required to perform or verify the work.
const HITL_SIGNALS = [
  /\brequires? (a )?human\b/i,
  /\bhuman (sign-?off|approval|judgement|decision)\b/i,
  /\bmanual (step|action|intervention)\b/i,
  /\bvisual(ly)? (review|inspect|verify)\b/i,
  /\bstakeholder (sign-?off|approval)\b/i,
  /\b(credential|secret)s? (setup|rotation|provisioning)\b/i,
  /\bprovision(ing)?\b[^.]{0,40}\b(infrastructure|infra|server|cluster)\b/i,
];

// Rubric: the bead explicitly rules out human involvement.
const AFK_EXPLICIT_SIGNALS = [
  /\bno human (action|input|review|intervention|judgement)\b/i,
];

// Rubric: acceptance criteria an agent can check without a human.
const AFK_SIGNALS = [
  /\bmachine-checkable\b/i,
  /\bautomated (test|tests|check|checks|verification)\b/i,
];

/** @param {RegExp[]} patterns @param {string} text */
function matchesAny(patterns, text) {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * @param {Classification} classification
 * @param {ResolutionSource} source
 * @param {string} reason
 * @returns {Resolution}
 */
function resolved(classification, source, reason) {
  return { classification, source, reason, escalate: false };
}

/** @param {string} reason @returns {Resolution} */
function needsRubric(reason) {
  return { classification: null, source: null, reason, escalate: true };
}

/**
 * Read the legacy `## Type` section out of a bead description.
 *
 * Accepts both the block form (`## Type` then a following `AFK`/`HITL` line)
 * and the inline form (`## Type: AFK`). Returns null when the section is absent
 * or carries an unrelated value.
 *
 * @param {string} description
 * @returns {Classification | null}
 */
function extractTypeField(description) {
  const inline = description.match(/^[ \t]*#{1,6}[ \t]*Type[ \t]*:[ \t]*(AFK|HITL)\b/im);
  if (inline) return /** @type {Classification} */ (inline[1].toLowerCase());

  const block = description.match(/^[ \t]*#{1,6}[ \t]*Type[ \t]*\r?\n+[ \t]*(AFK|HITL)[ \t]*(?:\r?\n|$)/im);
  if (block) return /** @type {Classification} */ (block[1].toLowerCase());

  return null;
}

/**
 * Resolve a bead's implementation type from the evidence it already carries,
 * without spending a model call.
 *
 * @param {{ labels?: string[], description?: string }} bead
 * @returns {Resolution}
 */
export function resolveClassification({ labels = [], description = '' }) {
  if (labels.includes(AFK_LABEL)) return resolved('afk', 'label', `${AFK_LABEL} label already present`);
  if (labels.includes(HITL_LABEL)) return resolved('hitl', 'label', `${HITL_LABEL} label already present`);

  const typeField = extractTypeField(description);
  if (typeField) return resolved(typeField, 'type-field', `legacy ## Type field declares ${typeField.toUpperCase()}`);

  // Conservative heuristics: a HITL signal wins over an AFK one, mirroring the
  // rubric's "a human is required if any criterion is true" rule.
  if (matchesAny(HITL_SIGNALS, description)) {
    return resolved('hitl', 'heuristic', 'description states a human-required action or verification');
  }
  if (matchesAny(AFK_EXPLICIT_SIGNALS, description)) {
    return resolved('afk', 'heuristic', 'description explicitly rules out human involvement');
  }
  if (matchesAny(AFK_SIGNALS, description)) {
    return resolved('afk', 'heuristic', 'description states machine-checkable acceptance criteria');
  }

  return needsRubric('no deterministic signal; rubric judgement required');
}

/** @param {Classification} classification */
function labelFor(classification) {
  return classification === 'afk' ? AFK_LABEL : HITL_LABEL;
}

/** @typedef {{ label: number, typeField: number, heuristic: number, rubric: number }} SourceCounts */

/**
 * @typedef {object} AuditSummary
 * @property {number} sampled
 * @property {SourceCounts} bySource
 * @property {number} deterministic     Beads resolved without a model call.
 * @property {number} needsRubric       Beads that would escalate to the rubric.
 * @property {number} deterministicRatio deterministic / sampled (0 when empty).
 */

/**
 * Measure what share of a bead sample the deterministic tiers resolve. This is
 * the "measure first" number that sizes the win over spawning a subagent.
 *
 * @param {Array<{ labels?: string[], description?: string }>} beads
 * @returns {AuditSummary}
 */
export function auditBeads(beads) {
  /** @type {SourceCounts} */
  const bySource = { label: 0, typeField: 0, heuristic: 0, rubric: 0 };

  for (const bead of beads) {
    const { source } = resolveClassification(bead);
    if (source === 'label') bySource.label += 1;
    else if (source === 'type-field') bySource.typeField += 1;
    else if (source === 'heuristic') bySource.heuristic += 1;
    else bySource.rubric += 1;
  }

  const deterministic = bySource.label + bySource.typeField + bySource.heuristic;
  return {
    sampled: beads.length,
    bySource,
    deterministic,
    needsRubric: bySource.rubric,
    deterministicRatio: beads.length === 0 ? 0 : deterministic / beads.length,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USAGE =
  'Usage: node classify-bead.mjs <bead-id> [--dry-run]\n' +
  '       node classify-bead.mjs --audit [--limit <n>]';

const DEFAULT_AUDIT_LIMIT = 100;

// BD_PATH env override lets machines where bd is not on PATH pin a location.
const BD_PATH = process.env.BD_PATH || 'bd';
const execFileAsync = promisify(execFile);

class UsageError extends Error {}

/**
 * @param {string[]} argv
 * @returns {{ beadId: string | null, audit: boolean, limit: number, dryRun: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const options = {
    beadId: /** @type {string | null} */ (null),
    audit: false,
    limit: DEFAULT_AUDIT_LIMIT,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--audit') {
      options.audit = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--limit') {
      const value = Number.parseInt(argv[++i] ?? '', 10);
      if (!Number.isInteger(value) || value <= 0) throw new UsageError('--limit requires a positive integer');
      options.limit = value;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unknown option: ${arg}`);
    } else if (options.beadId) {
      throw new UsageError(`unexpected argument: ${arg}`);
    } else {
      options.beadId = arg;
    }
  }

  return options;
}

/** @type {(args: string[]) => Promise<string>} */
async function defaultExec(args) {
  const { stdout } = await execFileAsync(BD_PATH, args, { encoding: 'utf-8' });
  return stdout;
}

/**
 * @param {object} options
 * @param {string[]} options.argv                      CLI arguments (without node/script).
 * @param {(args: string[]) => Promise<string>} [options.exec]  bd runner; injectable for tests.
 * @param {(chunk: string) => void} [options.write]    stdout sink; injectable for tests.
 * @returns {Promise<number>} process exit code.
 */
export async function runCli({ argv, exec = defaultExec, write = (chunk) => process.stdout.write(chunk) }) {
  const options = parseArgs(argv);

  if (options.help) {
    write(`${USAGE}\n`);
    return 0;
  }

  if (options.audit) {
    const beads = JSON.parse(
      await exec(['list', '--all', '--json', '--limit', String(options.limit), '--sort', 'created']),
    );
    write(`${JSON.stringify(auditBeads(beads), null, 2)}\n`);
    return 0;
  }

  if (!options.beadId) {
    write(`${USAGE}\n`);
    return 2;
  }

  const [bead] = JSON.parse(await exec(['show', options.beadId, '--json']));
  if (!bead) throw new Error(`bead not found: ${options.beadId}`);

  const resolution = resolveClassification(bead);
  const label = resolution.classification ? labelFor(resolution.classification) : null;
  const applied = label !== null && resolution.source !== 'label' && !options.dryRun;

  if (applied) await exec(['tag', options.beadId, /** @type {string} */ (label)]);

  write(
    `${JSON.stringify(
      {
        id: options.beadId,
        classification: resolution.classification,
        source: resolution.source,
        reason: resolution.reason,
        escalate: resolution.escalate,
        applied,
        label,
      },
      null,
      2,
    )}\n`,
  );
  return 0;
}

// Only run the CLI when invoked directly, so tests can import the pure tiers.
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
