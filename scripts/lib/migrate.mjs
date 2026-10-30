// @ts-check
// `agent-cortex migrate` — bring a beads workspace up to the latest
// agent-cortex layout, one versioned step at a time.
//
// The command is repo-agnostic: it talks to the `bd` CLI found on PATH
// (`BD_PATH` overrides), never to a hardcoded install path, and never to
// agent-cortex-specific labels.
//
// The current version is detected from the workspace's own state — the first
// step with pending work is the version boundary — so there is no side-car
// marker file to drift out of sync on a fresh clone, and a re-run after an
// apply is a no-op by construction.
//
// Dry run is the default. `--apply` runs every pending step in order up to the
// latest, verifying each one before moving on.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// `bd export --all` on a large workspace is far bigger than execFile's 1 MiB
// default; the migration reads every bead in the workspace.
const MAX_BUFFER = 32 * 1024 * 1024;

/** Step v1 renames labels in this namespace to the two-axis execution namespace. */
const LEGACY_LABEL_PREFIX = "implementation-type:";
const EXECUTION_LABEL_PREFIX = "execution:";

/** @typedef {(args: string[]) => Promise<string>} BdRunner */
/** @typedef {{ from: string, to: string }} LabelRename */
/** @typedef {{ id: string, renames: LabelRename[] }} PendingBead */

/**
 * One registry entry. `detect` is both the version probe (empty result = the
 * step is already applied) and the input to `apply`, so a step can never plan
 * one thing and write another.
 *
 * @typedef {object} MigrationStep
 * @property {number} version        Version this step migrates the workspace to.
 * @property {string} name           Stable identifier, used in output.
 * @property {string} describe       One-line description of the change.
 * @property {(bd: BdRunner) => Promise<PendingBead[]>} detect  Pending work, empty when applied.
 * @property {(bd: BdRunner, pending: PendingBead[]) => Promise<void>} apply  Write the change.
 */

/**
 * The `bd` runner. Resolved per call so a test or a machine-specific install
 * can override it without a hardcoded path (see the BD_PATH convention shared
 * with the other bd-driving tools in this repo).
 *
 * @returns {BdRunner}
 */
function bdRunner() {
  const bin = process.env.BD_PATH || "bd";
  return async (args) => {
    try {
      const { stdout } = await execFileAsync(bin, args, { encoding: "utf-8", maxBuffer: MAX_BUFFER });
      return stdout;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
        throw new Error(`bd not found (${bin}). Install the beads CLI or set BD_PATH.`);
      }
      const stderr = /** @type {{ stderr?: string }} */ (err).stderr;
      const detail = stderr && stderr.trim() ? stderr.trim() : /** @type {Error} */ (err).message;
      throw new Error(`bd ${args.slice(0, 2).join(" ")} failed: ${detail}`);
    }
  };
}

/**
 * Every issue in the workspace, read from `bd export --all` (JSONL). The export
 * reports each record's labels whatever its status, so closed beads are in
 * scope. A label-filtered `bd list` hides closed beads on some bd builds, and
 * relying on it is how a partially migrated workspace once reported itself as
 * up to date.
 *
 * Non-issue records (memories and other infrastructure beads) are skipped. A
 * line that is not JSON, or an issue without an id, fails loudly instead of
 * shrinking the result set silently.
 *
 * @param {BdRunner} bd
 * @returns {Promise<Array<{ id: string, labels: string[] }>>}
 */
async function exportIssues(bd) {
  const stdout = await bd(["export", "--all"]);
  /** @type {Array<{ id: string, labels: string[] }>} */
  const issues = [];
  const lines = stdout.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line === "") continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`bd export --all returned a non-JSON line at line ${index + 1}`);
    }
    if (typeof record?._type === "string" && record._type !== "issue") continue;
    if (typeof record?.id !== "string") {
      throw new Error(`bd export --all returned an issue without an id at line ${index + 1}`);
    }
    issues.push({ id: record.id, labels: Array.isArray(record.labels) ? record.labels : [] });
  }

  return issues;
}

/**
 * Labels present anywhere in the workspace, closed beads included, from the
 * label index. The migration cross-checks the export against it: a legacy label
 * the index reports but the export cannot attribute to a bead means the export
 * lost data, and the workspace must not be called migrated.
 *
 * @param {BdRunner} bd
 * @returns {Promise<string[]>}
 */
async function listIndexedLabels(bd) {
  const entries = JSON.parse(await bd(["label", "list-all", "--json"]));
  if (!Array.isArray(entries)) throw new Error("bd label list-all --json did not return an array");

  return entries.map((entry) => {
    if (typeof entry?.label !== "string") {
      throw new Error("bd label list-all --json returned an entry without a label");
    }
    return entry.label;
  });
}

/**
 * Find every bead still carrying an `implementation-type:` label, grouped per
 * bead. Closed beads are included: the migration's goal is an empty legacy
 * namespace, so history labels are renamed too.
 *
 * @param {BdRunner} bd
 * @returns {Promise<PendingBead[]>}
 */
async function findLegacyLabelBeads(bd) {
  /** @type {PendingBead[]} */
  const pending = [];

  for (const bead of await exportIssues(bd)) {
    /** @type {LabelRename[]} */
    const renames = [];
    for (const label of bead.labels) {
      if (!label.startsWith(LEGACY_LABEL_PREFIX)) continue;
      const value = label.slice(LEGACY_LABEL_PREFIX.length);
      if (value === "") throw new Error(`cannot migrate malformed label "${label}" on ${bead.id}`);
      renames.push({ from: label, to: `${EXECUTION_LABEL_PREFIX}${value}` });
    }
    if (renames.length > 0) pending.push({ id: bead.id, renames });
  }

  const residual = (await listIndexedLabels(bd)).filter((label) => label.startsWith(LEGACY_LABEL_PREFIX));
  if (pending.length === 0 && residual.length > 0) {
    throw new Error(
      `no bead in bd export --all carries ${residual.join(", ")}, but the label index still does — ` +
        "refusing to report the workspace as migrated",
    );
  }

  return pending.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Apply the label rename in batches: add the target label for a group of beads,
 * then remove the legacy one, so a bead is never left without its axis label.
 *
 * @param {BdRunner} bd
 * @param {PendingBead[]} pending
 * @returns {Promise<void>}
 */
async function renameLegacyLabels(bd, pending) {
  /** @type {Map<string, { to: string, ids: string[] }>} */
  const groups = new Map();
  for (const bead of pending) {
    for (const { from, to } of bead.renames) {
      const group = groups.get(from) ?? { to, ids: [] };
      group.ids.push(bead.id);
      groups.set(from, group);
    }
  }

  for (const from of [...groups.keys()].sort()) {
    const { to, ids } = /** @type {{ to: string, ids: string[] }} */ (groups.get(from));
    await bd(["label", "add", ...ids, to]);
    await bd(["label", "remove", ...ids, from]);
  }
}

/** @type {MigrationStep[]} */
const STEPS = [
  {
    version: 1,
    name: "label-rename",
    describe: `${LEGACY_LABEL_PREFIX}<afk|hitl> → ${EXECUTION_LABEL_PREFIX}<afk|hitl>`,
    detect: findLegacyLabelBeads,
    apply: renameLegacyLabels,
  },
];

const LATEST_VERSION = STEPS[STEPS.length - 1].version;

/**
 * @typedef {object} MigrationState
 * @property {number} version                 Highest contiguous applied version.
 * @property {MigrationStep | null} step      First step with pending work, null when up to date.
 * @property {PendingBead[]} pending          That step's pending work.
 */

/**
 * Detect the workspace's current migration version. Stops at the first step
 * with pending work: later steps assume the earlier ones have run.
 *
 * @param {BdRunner} bd
 * @returns {Promise<MigrationState>}
 */
async function detectVersion(bd) {
  let version = 0;
  for (const step of STEPS) {
    const pending = await step.detect(bd);
    if (pending.length > 0) return { version, step, pending };
    version = step.version;
  }
  return { version, step: null, pending: [] };
}

/** @param {string} chunk */
function write(chunk) {
  process.stdout.write(chunk);
}

/**
 * @param {MigrationStep} step
 * @param {PendingBead[]} pending
 */
function summarize(step, pending) {
  return `    ${pending.length} bead(s) pending for v${step.version} ${step.name}\n`;
}

/**
 * The dry run's deliverable: one line per bead, then the totals.
 *
 * @param {MigrationStep} step
 * @param {PendingBead[]} pending
 */
function writePlan(step, pending) {
  for (const bead of pending) {
    const renames = bead.renames.map(({ from, to }) => `${from} → ${to}`).join(", ");
    write(`    ${bead.id}: ${renames}\n`);
  }
  write(summarize(step, pending));
}

/**
 * Run `agent-cortex migrate`.
 *
 * @param {{ apply: boolean }} options
 * @returns {Promise<void>}
 */
export async function runMigrate({ apply }) {
  const bd = bdRunner();
  const current = await detectVersion(bd);

  if (current.step === null) {
    write(`agent-cortex migrate: already at v${LATEST_VERSION} — nothing to do.\n`);
    return;
  }

  if (!apply) {
    write(`agent-cortex migrate: dry run (workspace at v${current.version}, latest v${LATEST_VERSION})\n`);
    write(`  v${current.step.version} ${current.step.name}: ${current.step.describe}\n`);
    writePlan(current.step, current.pending);
    write("No changes written. Re-run with --apply to write.\n");
    return;
  }

  write(`agent-cortex migrate: v${current.version} → v${LATEST_VERSION}\n`);
  let state = current;
  while (state.step !== null) {
    const step = state.step;
    write(`  v${step.version} ${step.name}: ${step.describe}\n`);
    write(summarize(step, state.pending));

    await step.apply(bd, state.pending);

    const remaining = await step.detect(bd);
    if (remaining.length > 0) {
      const ids = remaining.map((bead) => bead.id).join(", ");
      throw new Error(
        `v${step.version} ${step.name} verification failed — ${remaining.length} bead(s) still pending: ${ids}`,
      );
    }
    write(`  ✓ v${step.version} ${step.name} verified\n`);

    const next = await detectVersion(bd);
    if (next.step !== null && next.step.version <= step.version) {
      throw new Error(`migration did not advance past v${step.version}`);
    }
    state = next;
  }
  write(`agent-cortex migrate: now at v${LATEST_VERSION}.\n`);
}
