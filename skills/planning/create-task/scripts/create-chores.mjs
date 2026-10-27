// @ts-check
// Pre-create the pipeline stage chores for a task bead, plus the feature PR
// review gate, from `pipeline.json`.
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

// ─── Main ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { parentId, priority } = parseArgs(process.argv.slice(2));

const pipelinePath = resolve(__dirname, '..', 'pipeline.json');
/** @type {Pipeline} */
const pipeline = JSON.parse(readFileSync(pipelinePath, 'utf-8'));

/** @type {Map<string, string>} */
const stageToBeadId = new Map();

for (const stage of pipeline.stages) {
  const title = `[${parentId}] ${stage.title}`;

  const beadId = run([
    'bd', 'create', JSON.stringify(title),
    '--type', 'chore',
    '--description', JSON.stringify(stage.description),
    '--priority', priority,
    '--labels', `stage:${stage.id}`,
    '--parent', parentId,
    '--silent',
  ]);

  stageToBeadId.set(stage.id, beadId);

  for (const depStageId of stage.dependsOn) {
    const depBeadId = stageToBeadId.get(depStageId);
    if (!depBeadId) {
      console.error(`Stage '${stage.id}' depends on '${depStageId}', but it has not been created yet. Check dependsOn ordering in pipeline.json.`);
      process.exit(1);
    }
    run(['bd', 'dep', 'add', beadId, depBeadId, '--type', 'blocks']);
  }
}

const finalStageId = pipeline.stages.at(-1)?.id;
if (!finalStageId) {
  console.error('No pipeline stages found in pipeline.json.');
  process.exit(1);
}

const documentStageBeadId = stageToBeadId.get('document') ?? stageToBeadId.get(finalStageId);
if (!documentStageBeadId) {
  console.error('Could not resolve the final stage bead needed for PR gate dependency.');
  process.exit(1);
}

const prGateBeadId = run([
  'bd', 'create', JSON.stringify(`[${parentId}] PR Review and Merge`),
  '--type', 'task',
  '--description', JSON.stringify(
    'Human review gate: review and merge the agent PR into the feature branch before closing this feature.\n\n## Acceptance Criteria\n\n- [ ] Agent PR reviewed and merged into the feature branch.',
  ),
  // The gate is type `task`, so `--validate` enforces its `## Acceptance Criteria`
  // section. Stage chores require no sections and deliberately omit the flag.
  '--validate',
  '--priority', priority,
  '--labels', 'implementation-type:hitl,lifecycle:feature-pr',
  '--parent', parentId,
  // The gate declares its own labels; opt out of bd's create-time parent-label
  // inheritance so its explicit :hitl is never joined by an inherited :afk.
  // Stage chores deliberately keep inheriting :afk -- do not add this there.
  '--no-inherit-labels',
  '--silent',
]);
run(['bd', 'dep', 'add', prGateBeadId, documentStageBeadId, '--type', 'blocks']);

/** @type {Record<string, string>} */
const result = {
  ...Object.fromEntries(stageToBeadId),
  featurePrReview: prGateBeadId,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
