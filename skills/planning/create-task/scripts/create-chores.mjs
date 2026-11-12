// @ts-check
// Pre-create the pipeline stage chores for a task bead, plus the feature PR
// review gate, from `pipeline.json`.
//
// Idempotent: a re-run converges on the tree that already exists instead of adding a
// second chain beside it, so re-running after a failed expansion is the recovery path.
// Existing children are adopted by their role label (`stage:<id>`, `lifecycle:feature-pr`)
// under the given parent — never by title, and never across parents.
//
// The parent is an `execution:afk` bead. Stage chores inherit that label from it, so
// create-chores does not classify: a parent that is hitl or unlabelled silently yields
// a chore tree no executor routes. Check the parent's labels before invoking this.
//
// Zero dependencies: run with `node create-chores.mjs --parent <bead-id>`.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Stage
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} template
 * @property {string[]} dependsOn
 * @property {string[]} [labels]  Labels beside `stage:<id>`; e.g. `lifecycle:housekeeping`
 */

/**
 * @typedef {object} Pipeline
 * @property {number} maxFixRounds
 * @property {Stage[]} stages
 */

// ─── Args ─────────────────────────────────────────────────────────────────────

/**
 * @param {string[]} args
 * @returns {{ parentId: string, priority: string }}
 */
function parseArgs(args) {
  /** @type {string | undefined} */
  let parentId;
  let priority = '2';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--parent' && args[i + 1]) { parentId = args[++i]; }
    else if (args[i] === '--priority' && args[i + 1]) { priority = args[++i]; }
  }

  if (!parentId) {
    console.error('Usage: create-chores.mjs --parent <bead-id> [--priority <0-4>]');
    process.exit(1);
  }

  return { parentId, priority };
}

// ─── Exec ─────────────────────────────────────────────────────────────────────

// BD_PATH env override lets machines where bd is not on PATH pin a location.
// Defaults to `bd`, resolved via PATH.
const BD_PATH = process.env.BD_PATH || 'bd';

/**
 * @param {string[]} args
 * @returns {string}
 */
function run(args) {
  const cmd = args[0] === 'bd' ? [BD_PATH, ...args.slice(1)] : args;
  return execSync(cmd.join(' '), { encoding: 'utf-8' }).trim();
}

// ─── Existing children ────────────────────────────────────────────────────────

/**
 * @typedef {object} Dependency
 * @property {string} depends_on_id
 * @property {string} type
 */

/**
 * A child of the parent that already fills one of this script's roles.
 * @typedef {object} Adoptable
 * @property {string} id
 * @property {Set<string>} blocks  Beads it already depends on with a `blocks` dep
 */

/**
 * Read the parent's children once and index the ones this script owns by their role
 * label. Scoped to that parent's children, so a stray chore belonging to another bead
 * is never adopted. When a role label appears more than once the first-listed child
 * wins, so a converged re-run is deterministic.
 * @param {string} parentId
 * @returns {Map<string, Adoptable>} Keyed by `stage:<id>` or `lifecycle:feature-pr`
 */
function readAdoptable(parentId) {
  const raw = run(['bd', 'children', parentId, '--json']);
  /** @type {Array<{ id: string, labels?: string[], dependencies?: Dependency[] }>} */
  const children = raw === '' ? [] : JSON.parse(raw);

  /** @type {Map<string, Adoptable>} */
  const adoptable = new Map();

  for (const child of children) {
    const blocks = new Set(
      (child.dependencies ?? [])
        .filter((dep) => dep.type === 'blocks')
        .map((dep) => dep.depends_on_id),
    );

    for (const label of child.labels ?? []) {
      if (label !== 'lifecycle:feature-pr' && !label.startsWith('stage:')) { continue; }
      if (!adoptable.has(label)) { adoptable.set(label, { id: child.id, blocks }); }
    }
  }

  return adoptable;
}

/**
 * Wire a `blocks` dependency unless the bead already carries it. Re-adding an existing
 * dep is the failure mode a re-run must not hit, so existing deps are skipped.
 * @param {string} beadId
 * @param {string} dependsOnId
 * @param {Set<string>} blocks  Dependencies the bead already has; extended in place
 */
function wireBlocks(beadId, dependsOnId, blocks) {
  if (blocks.has(dependsOnId)) { return; }
  run(['bd', 'dep', 'add', beadId, dependsOnId, '--type', 'blocks']);
  blocks.add(dependsOnId);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

// Reserved `dependsOn` target: the PR gate bead. The gate is not a stage — it is
// created after them — so a stage that waits on it is wired in a second pass.
const GATE_ROLE = 'featurePrReview';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { parentId, priority } = parseArgs(process.argv.slice(2));

const pipelinePath = resolve(__dirname, '..', 'pipeline.json');
/** @type {Pipeline} */
const pipeline = JSON.parse(readFileSync(pipelinePath, 'utf-8'));

const adoptable = readAdoptable(parentId);

/** @type {Map<string, string>} */
const stageToBeadId = new Map();

/** Stages that wait on the gate rather than on another stage, held until it exists.
 * @type {Array<{ beadId: string, blocks: Set<string> }>} */
const gateDependents = [];

for (const stage of pipeline.stages) {
  const adopted = adoptable.get(`stage:${stage.id}`);

  const beadId = adopted
    ? adopted.id
    : run([
        'bd', 'create', JSON.stringify(`[${parentId}] ${stage.title}`),
        '--type', 'chore',
        '--description', JSON.stringify(stage.description),
        '--priority', priority,
        '--labels', [`stage:${stage.id}`, ...(stage.labels ?? [])].join(','),
        '--parent', parentId,
        '--silent',
      ]);

  stageToBeadId.set(stage.id, beadId);

  /** @type {Set<string>} */
  const blocks = adopted ? adopted.blocks : new Set();

  for (const depStageId of stage.dependsOn) {
    if (depStageId === GATE_ROLE) { continue; }
    const depBeadId = stageToBeadId.get(depStageId);
    if (!depBeadId) {
      console.error(`Stage '${stage.id}' depends on '${depStageId}', but it has not been created yet. Check dependsOn ordering in pipeline.json.`);
      process.exit(1);
    }
    wireBlocks(beadId, depBeadId, blocks);
  }

  if (stage.dependsOn.includes(GATE_ROLE)) { gateDependents.push({ beadId, blocks }); }
}

// The gate waits on the last stage that does not itself wait on the gate, so the
// chain stays acyclic once a stage can follow the gate.
const chainStageIds = pipeline.stages
  .filter((stage) => !stage.dependsOn.includes(GATE_ROLE))
  .map((stage) => stage.id);

const documentStageBeadId = stageToBeadId.get('document') ?? stageToBeadId.get(chainStageIds.at(-1) ?? '');
if (!documentStageBeadId) {
  console.error('Could not resolve the final stage bead needed for PR gate dependency.');
  process.exit(1);
}

const adoptedGate = adoptable.get('lifecycle:feature-pr');

const prGateBeadId = adoptedGate
  ? adoptedGate.id
  : run([
      'bd', 'create', JSON.stringify(`[${parentId}] PR Review and Merge`),
      '--type', 'task',
      '--description', JSON.stringify(
        'Human review gate: review and merge the agent PR into the feature branch before closing this feature.\n\n## Acceptance Criteria\n\n- [ ] Agent PR reviewed and merged into the feature branch.',
      ),
      // The gate is type `task`, so `--validate` enforces its `## Acceptance Criteria`
      // section. Stage chores require no sections and deliberately omit the flag.
      '--validate',
      '--priority', priority,
      '--labels', 'execution:hitl,lifecycle:feature-pr',
      '--parent', parentId,
      // The gate declares its own execution class (it is human-owned review work), so opt
      // out of bd's create-time parent-label inheritance and its explicit :hitl is never
      // joined by an inherited :afk. Stage chores deliberately keep inheriting the parent's
      // :afk -- do not add this flag there.
      '--no-inherit-labels',
      '--silent',
    ]);

/** @type {Set<string>} */
const gateBlocks = adoptedGate ? adoptedGate.blocks : new Set();
wireBlocks(prGateBeadId, documentStageBeadId, gateBlocks);

// Second pass: the stages that wait on the gate finally get their dep, now that the
// gate bead exists.
for (const { beadId, blocks } of gateDependents) {
  wireBlocks(beadId, prGateBeadId, blocks);
}

/** @type {Record<string, string>} */
const result = {
  ...Object.fromEntries(stageToBeadId),
  featurePrReview: prGateBeadId,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
