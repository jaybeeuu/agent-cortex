// @ts-check
// Pre-create the pipeline stage chores for a task bead, plus the feature PR
// review gate, from `pipeline.json`.
//
// Two paths, chosen once per run and stated once on stderr:
//
//   pour  A `bd mol pour` of the shipped `pipeline` formula creates every stage
//         chore with its labels and stage→stage edges in one call. Each step is
//         then reparented onto the parent bead and the inert molecule root is
//         deleted. Budget: 1 `bd children` + 1 `bd show` + 1 pour + one
//         `bd update` per step + 1 `bd delete` + 1 `bd note`, against the loop's
//         1 `bd children` + up to 6 `bd create` + 6 `bd dep add`. A wash on time;
//         the gain is that the DAG is declared once instead of rebuilt by a shell
//         loop.
//
//   loop  The per-stage path: one `bd create` per missing stage, one `bd dep add`
//         per missing edge. Used when the formula is absent (an older install, or
//         a project whose installer has not run since) and when the parent already
//         has stage chores.
//
// Convergence is not inherited from the pour: a second pour silently duplicates
// the whole tree, so the formula is poured only into a parent with no stage chore
// yet. Both paths read the parent's children (`bd children <parent-id> --json`)
// and adopt an existing child by its role label — `stage:<id>` for a stage chore,
// `lifecycle:feature-pr` for the gate — creating only what is missing, so
// re-running after a failed expansion is the recovery path. The children are read
// again before the loop takes over from a failed pour, so a step a partly failed
// rollback left behind is adopted rather than created a second time.
//
// Adoption ignores bead status and reads only labels: a chore a later stage
// already closed is still adopted and reprinted in the mapping, which keeps a
// re-run convergent instead of creating a duplicate. When a role label appears
// twice under one parent the first-listed child wins. Adoption is scoped to that
// parent's children and keyed on labels, never titles, so a stray chore from
// another bead is never adopted.
//
// The parent is an `execution:afk` bead. Stage chores inherit that label from it,
// so create-chores does not classify: a parent that is hitl or unlabelled silently
// yields a chore tree no executor routes. Check the parent's labels before
// invoking this. The pour path adds the parent's labels to each step explicitly,
// because a pour substitutes strings and bd does not substitute `{{var}}` inside a
// step's `labels`.
//
// Zero dependencies: run with `node create-chores.mjs --parent <bead-id>`.

import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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

/**
 * A stage chore that exists or was just created, plus the `blocks` dependencies it
 * carries. The gate wiring pass extends `blocks` as it wires.
 * @typedef {object} StageBead
 * @property {string} id
 * @property {Set<string>} blocks
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

const execFileAsync = promisify(execFile);

/**
 * Run a command with its argv handed straight to the child process. The arguments are
 * never joined into a command line for a shell: a stage description wraps a real command
 * in backticks (`node <ralph-scripts>/post-merge-check.mjs`), and a shell would execute it
 * and splice its output into the description instead of storing the text.
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function run(args) {
  const [command, ...rest] = args[0] === 'bd' ? [BD_PATH, ...args.slice(1)] : args;
  const { stdout } = await execFileAsync(command, rest, { encoding: 'utf-8' });
  return stdout.trim();
}

// ─── Formula discovery ────────────────────────────────────────────────────────

// The formula both installers copy into a consumer's `.beads/formulas/`. This
// script ships inside the create-task skill, which an install copies flat and
// without `scripts/lib/`, so it cannot import the installer's copy of these names
// — they are repeated here, and test/pipeline-formula.test.mjs proves the copy the
// installer writes is the file this script finds.
const FORMULA_ID = 'pipeline';
const FORMULA_FILE = `${FORMULA_ID}.formula.json`;

/**
 * True when `path` is a regular file; false on any error.
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * The project's copy of the formula, found by walking up from `startDir` — the
 * same `.beads/` discovery bd does, so the file found here is the file bd pours.
 * @param {string} startDir
 * @returns {Promise<string | null>}
 */
async function findFormulaPath(startDir) {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, '.beads', 'formulas', FORMULA_FILE);
    if (await isFile(candidate)) { return candidate; }
    const parent = dirname(current);
    if (parent === current) { return null; }
    current = parent;
  }
}

/**
 * State which path ran, once per run. stderr, because stdout is the JSON mapping
 * the caller reads.
 * @param {string} line
 */
function say(line) {
  process.stderr.write(`create-chores: ${line}\n`);
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
 * @returns {Promise<Map<string, Adoptable>>} Keyed by `stage:<id>` or `lifecycle:feature-pr`
 */
async function readAdoptable(parentId) {
  const raw = await run(['bd', 'children', parentId, '--json']);
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
 * The parent's own labels — what `bd create --parent` would copy onto a new child,
 * and what the pour path therefore has to add itself.
 * @param {string} parentId
 * @returns {Promise<string[]>}
 */
async function readParentLabels(parentId) {
  const raw = await run(['bd', 'show', parentId, '--json']);
  /** @type {Array<{ labels?: string[] }>} */
  const shown = raw === '' ? [] : JSON.parse(raw);
  return shown[0]?.labels ?? [];
}

/**
 * Wire a `blocks` dependency unless the bead already carries it. Re-adding an existing
 * dep is the failure mode a re-run must not hit, so existing deps are skipped.
 * @param {string} beadId
 * @param {string} dependsOnId
 * @param {Set<string>} blocks  Dependencies the bead already has; extended in place
 * @returns {Promise<void>}
 */
async function wireBlocks(beadId, dependsOnId, blocks) {
  if (blocks.has(dependsOnId)) { return; }
  await run(['bd', 'dep', 'add', beadId, dependsOnId, '--type', 'blocks']);
  blocks.add(dependsOnId);
}

// ─── Stage chores: the pour path ──────────────────────────────────────────────

// Reserved `dependsOn` target: the PR gate bead. The gate is not a stage — it is
// created after them, so a stage that waits on it is wired in a second pass, and
// the formula cannot declare the edge because the gate does not exist yet.
const GATE_ROLE = 'featurePrReview';

/**
 * The most useful line out of a failed `run`: `bd`'s stderr, else the error's own
 * message. Never a stack trace, because these lines are reported to the operator.
 * @param {unknown} err
 * @returns {string}
 */
function describeError(err) {
  const detail = /** @type {{ stderr?: string, message?: string }} */ (err);
  return detail.stderr?.trim() || detail.message || String(err);
}

/**
 * True when a delete refused because the bead is already gone — bd exits 1 with
 * `issue <id> not found`. The caller wanted the bead absent and it is, so this is
 * the delete succeeding late rather than a bead left behind.
 * @param {unknown} err
 * @returns {boolean}
 */
function isNotFound(err) {
  return /not found/i.test(describeError(err));
}

/**
 * Delete a molecule the pour created, best effort. A step that was already
 * reparented left the root's child list, so each known step is deleted first and
 * the root last. A failure is not thrown — this runs on the error path, where the
 * caller is about to report the original cause — but it is never swallowed either:
 * the surviving ids are named, and the loop adopts whatever reached the parent.
 * @param {string} rootId
 * @param {string[]} [stepIds]
 * @returns {Promise<void>}
 */
async function discardPour(rootId, stepIds = []) {
  /** @type {string[]} */
  const survivors = [];
  for (const id of [...stepIds, rootId]) {
    if (!id) { continue; }
    try {
      await run(['bd', 'delete', id, '--force']);
    } catch (err) {
      // Already absent is the outcome the delete wanted; only a bead that is
      // still there can be adopted by the loop, so only that is reported.
      if (!isNotFound(err)) { survivors.push(id); }
    }
  }
  if (survivors.length > 0) {
    say(`could not delete ${survivors.join(', ')} while rolling the pour back; a step that reached the parent bead is adopted by its stage label, not created again`);
  }
}

/**
 * Delete the molecule root the pour left behind, retrying once. The root is
 * scaffolding only — every step is already reparented when this runs — so the tree
 * is complete whether or not the delete succeeds. A root that truly survives is
 * inert: `bd ready` does not list a molecule root (checked against bd 1.3.1), so
 * it is never addressable, and it is reported by id instead of being silently
 * dropped. A delete that reports the root already gone counts as success — the
 * caller wanted it absent and it is.
 * @param {string} rootId
 * @returns {Promise<boolean>} True when the root is gone
 */
async function deleteMoleculeRoot(rootId) {
  /** @type {unknown} */
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await run(['bd', 'delete', rootId, '--force']);
      if (attempt > 1) { say(`deleted molecule root ${rootId} on retry`); }
      return true;
    } catch (err) {
      if (isNotFound(err)) { return true; }
      lastError = err;
    }
  }
  say(`could not delete molecule root ${rootId} (${describeError(lastError)}); the stage chores are complete and the root is inert — 'bd ready' does not list it — so remove it by hand with 'bd delete ${rootId} --force'`);
  return false;
}

/**
 * Pour the formula, reparent every step onto the parent bead, and delete the
 * molecule root. One pour plus one `bd update` per step, never one create per stage.
 *
 * The formula cannot express the PR gate: the gate bead is created after the
 * stages and declares its own execution class, so the caller wires the stages that
 * wait on it.
 * @param {{ parentId: string, priority: string }} options
 * @returns {Promise<Map<string, StageBead>>} Keyed by stage id
 */
async function pourStages({ parentId, priority }) {
  const inherited = await readParentLabels(parentId);

  /** @type {{ id_mapping?: Record<string, string>, new_epic_id?: string }} */
  const poured = JSON.parse(
    await run(['bd', 'mol', 'pour', FORMULA_ID, '--var', `feature=${parentId}`, '--json']),
  );

  const rootId = poured.new_epic_id ?? poured.id_mapping?.[FORMULA_ID];
  const pouredIds = pipeline.stages.map((stage) => poured.id_mapping?.[`${FORMULA_ID}.${stage.id}`]);
  const absent = pipeline.stages.filter((_, index) => !pouredIds[index]).map((stage) => stage.id);

  if (!rootId || absent.length > 0) {
    await discardPour(rootId ?? '', pouredIds.filter((id) => id !== undefined));
    throw new Error(
      `bd mol pour ${FORMULA_ID} returned no id for ${absent.length > 0 ? `step(s) ${absent.join(', ')}` : 'its molecule root'}`,
    );
  }

  // Every step id is present: the check above covers each index of the same array.
  const stepIds = /** @type {string[]} */ (pouredIds);

  try {
    for (const [index, stage] of pipeline.stages.entries()) {
      await reparentStep(stepIds[index], { parentId, priority, inherited, stage });
    }
  } catch (err) {
    // No half-poured molecule without the reparent: drop what the pour created so
    // the next run starts from the tree the loop would have left.
    await discardPour(rootId, stepIds);
    throw err;
  }

  // Past this point the expansion has succeeded — the parent owns one chore per
  // stage — so nothing here may be reported as a rollback: the root delete and the
  // audit note are cleanup, and a failure in either leaves a tree the next run
  // adopts by its stage labels instead of pouring a second time.
  const rootDeleted = await deleteMoleculeRoot(rootId);

  // What was poured, on the bead the caller reads. Convergence itself is decided
  // from the children's role labels, not from this note; the note is the audit
  // trail that says a molecule ever existed here, and which steps it became.
  try {
    await run([
      'bd', 'note', parentId,
      `[${new Date().toISOString()}] create-chores poured formula '${FORMULA_ID}': ` +
        `${pipeline.stages.map((stage, index) => `${stage.id}=${stepIds[index]}`).join(', ')}; ` +
        (rootDeleted
          ? `molecule root ${rootId} deleted`
          : `molecule root ${rootId} left in place after a failed delete`),
    ]);
  } catch (err) {
    say(`could not record the pour on ${parentId} (${describeError(err)}); adoption reads the step labels, so a re-run still converges`);
  }

  /** @type {Map<string, StageBead>} */
  const stages = new Map();
  for (const [index, stage] of pipeline.stages.entries()) {
    // A pour only runs into a parent with no stage chore, so no step can already
    // carry a wired dependency.
    stages.set(stage.id, { id: stepIds[index], blocks: new Set() });
  }
  return stages;
}

/**
 * Move one poured step under the parent bead, giving it the priority the loop
 * would have passed to `bd create` and the labels the parent would have been
 * inherited from. One call per step.
 * @param {string} stepId
 * @param {{ parentId: string, priority: string, inherited: string[], stage: Stage }} options
 * @returns {Promise<void>}
 */
async function reparentStep(stepId, { parentId, priority, inherited, stage }) {
  const declared = new Set([`stage:${stage.id}`, ...(stage.labels ?? [])]);
  const args = ['bd', 'update', stepId, '--parent', parentId, '--priority', priority];
  for (const label of inherited) {
    if (declared.has(label)) { continue; }
    args.push('--add-label', label);
  }
  await run(args);
}

// ─── Stage chores: the per-stage path ─────────────────────────────────────────

/**
 * Create the missing stage chores one at a time and wire their stage→stage edges.
 * The path used when the formula is absent, and the one that fills the gaps of a
 * partly expanded tree.
 * @param {{ parentId: string, priority: string, adoptable: Map<string, Adoptable> }} options
 * @returns {Promise<Map<string, StageBead>>} Keyed by stage id
 */
async function createStages({ parentId, priority, adoptable }) {
  /** @type {Map<string, StageBead>} */
  const stages = new Map();

  for (const stage of pipeline.stages) {
    const adopted = adoptable.get(`stage:${stage.id}`);

    const beadId = adopted
      ? adopted.id
      : await run([
          // The argv is never joined into a shell command line (see `run`), so the
          // title and description are passed as written. `JSON.stringify` here used to
          // wrap both in double quotes, which bd stored verbatim: the loop's chores read
          // `"[<parent>] Code"` while the formula's read `[<parent>] Code`.
          'bd', 'create', `[${parentId}] ${stage.title}`,
          '--type', 'chore',
          '--description', stage.description,
          '--priority', priority,
          '--labels', [`stage:${stage.id}`, ...(stage.labels ?? [])].join(','),
          '--parent', parentId,
          '--silent',
        ]);

    /** @type {Set<string>} */
    const blocks = adopted ? adopted.blocks : new Set();
    stages.set(stage.id, { id: beadId, blocks });

    for (const depStageId of stage.dependsOn) {
      if (depStageId === GATE_ROLE) { continue; }
      const dep = stages.get(depStageId);
      if (!dep) {
        console.error(`Stage '${stage.id}' depends on '${depStageId}', but it has not been created yet. Check dependsOn ordering in pipeline.json.`);
        process.exit(1);
      }
      await wireBlocks(beadId, dep.id, blocks);
    }
  }

  return stages;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { parentId, priority } = parseArgs(process.argv.slice(2));

const pipelinePath = resolve(__dirname, '..', 'pipeline.json');
/** @type {Pipeline} */
const pipeline = JSON.parse(await readFile(pipelinePath, 'utf-8'));

let adoptable = await readAdoptable(parentId);
const formulaPath = await findFormulaPath(process.cwd());
const alreadyExpanded = [...adoptable.keys()].some((role) => role.startsWith('stage:'));

/** @type {Map<string, StageBead> | null} */
let stageBeads = null;

if (formulaPath === null) {
  say(`per-stage path — no ${FORMULA_FILE} in a .beads/formulas/ directory at or above ${resolve(process.cwd())}`);
} else if (alreadyExpanded) {
  say(`per-stage path — the parent already has stage chores, and a second pour would duplicate them`);
} else {
  try {
    stageBeads = await pourStages({ parentId, priority });
    say(`poured formula '${FORMULA_ID}': 1 pour, ${pipeline.stages.length} reparent(s), 1 molecule-root delete`);
  } catch (err) {
    // The rollback is best effort, so read the children again before the loop
    // takes over: a step that survived it is adopted by its stage label instead of
    // being created a second time under the same parent. The wording claims no
    // revert — whatever the rollback left is finished by the loop, not undone.
    adoptable = await readAdoptable(parentId);
    say(`pour of '${FORMULA_ID}' failed (${describeError(err)}); the per-stage path completes the tree`);
  }
}

stageBeads ??= await createStages({ parentId, priority, adoptable });

/** @type {Map<string, string>} */
const stageToBeadId = new Map(
  [...stageBeads].map(([stageId, bead]) => [stageId, bead.id]),
);

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
  : await run([
      'bd', 'create', `[${parentId}] PR Review and Merge`,
      '--type', 'task',
      '--description',
        'Human review gate: review and merge the agent PR into the feature branch before closing this feature.\n\n## Acceptance Criteria\n\n- [ ] Agent PR reviewed and merged into the feature branch.',
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
await wireBlocks(prGateBeadId, documentStageBeadId, gateBlocks);

// Second pass: the stages that wait on the gate finally get their dep, now that the
// gate bead exists.
for (const stage of pipeline.stages) {
  if (!stage.dependsOn.includes(GATE_ROLE)) { continue; }
  const bead = stageBeads.get(stage.id);
  if (!bead) { continue; }
  await wireBlocks(bead.id, prGateBeadId, bead.blocks);
}

/** @type {Record<string, string>} */
const result = {
  ...Object.fromEntries(stageToBeadId),
  featurePrReview: prGateBeadId,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
