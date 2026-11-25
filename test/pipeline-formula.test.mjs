import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createTempRoot } from "./helpers/temp-root.mjs";
import {
  PIPELINE_FORMULA_FILE,
  PIPELINE_FORMULA_ID,
  PIPELINE_FORMULA_SOURCE,
  copyPipelineFormula,
  findBeadsDir,
} from "../scripts/lib/pipeline-formula.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(testDir, "..");

// One temp root per file, removed by the file-level `after()` hook it registers.
const tempRoot = createTempRoot("pipeline-formula-");

/** A project directory the way `bd init` leaves it. */
async function bdProject() {
  const dir = await tempRoot.createWorkspace();
  await mkdir(join(dir, ".beads"), { recursive: true });
  return dir;
}

/** True when `path` exists.
 * @param {string} path
 * @returns {Promise<boolean>} */
async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("copyPipelineFormula", () => {
  it("writes the formula under .beads/formulas/ with the id as its filename", async () => {
    const project = await bdProject();

    const copy = await copyPipelineFormula({ root: REPO_ROOT, projectDir: project });

    assert.equal(copy.action, "written");
    assert.equal(copy.path, join(project, ".beads", "formulas", PIPELINE_FORMULA_FILE));
    assert.equal(await readFile(/** @type {string} */ (copy.path), "utf-8"), await readFile(join(REPO_ROOT, PIPELINE_FORMULA_SOURCE), "utf-8"));
  });

  it("states that the copy is an untracked file in the consumer's repository", async () => {
    const project = await bdProject();

    const copy = await copyPipelineFormula({ root: REPO_ROOT, projectDir: project });

    assert.match(copy.message, /untracked file/);
    assert.match(copy.message, /\.beads\/formulas\/ is not gitignored/);
  });

  it("leaves an identical copy untouched, so a second install does not dirty the file", async () => {
    const project = await bdProject();
    const first = await copyPipelineFormula({ root: REPO_ROOT, projectDir: project });
    const before = await stat(/** @type {string} */ (first.path));

    const second = await copyPipelineFormula({ root: REPO_ROOT, projectDir: project });

    assert.equal(second.action, "unchanged");
    assert.equal(second.path, first.path);
    // Rewriting an identical file would move its mtime; a no-op must not.
    assert.equal((await stat(/** @type {string} */ (second.path))).mtimeMs, before.mtimeMs);
  });

  it("reports a project with no .beads/ and copies nothing", async () => {
    const project = await tempRoot.createWorkspace();

    const copy = await copyPipelineFormula({ root: REPO_ROOT, projectDir: project });

    assert.equal(copy.action, "no-beads-dir");
    assert.equal(copy.path, null);
    assert.match(copy.message, /No \.beads\/ directory/);
    assert.match(copy.message, /bd init/);
    assert.equal(await pathExists(join(project, ".beads")), false, "the install must not invent a .beads/ tree");
  });

  it("finds the project's .beads/ from a nested directory", async () => {
    const project = await bdProject();
    const nested = join(project, "packages", "app");
    await mkdir(nested, { recursive: true });

    const copy = await copyPipelineFormula({ root: REPO_ROOT, projectDir: nested });

    assert.equal(copy.action, "written");
    assert.equal(copy.path, join(project, ".beads", "formulas", PIPELINE_FORMULA_FILE));
    assert.equal(await findBeadsDir(nested), project);
  });

  it("writes nothing on a dry run", async () => {
    const project = await bdProject();

    const copy = await copyPipelineFormula({ root: REPO_ROOT, projectDir: project, dryRun: true });

    assert.equal(copy.action, "planned");
    assert.equal(await pathExists(join(project, ".beads", "formulas", PIPELINE_FORMULA_FILE)), false);
  });

  it("skips the copy for a generate-only run with no project directory", async () => {
    const copy = await copyPipelineFormula({ root: REPO_ROOT, projectDir: null });

    assert.equal(copy.action, "planned");
    assert.equal(copy.path, null);
  });

  it("reports a package that does not ship the formula instead of failing", async () => {
    const project = await bdProject();
    const emptyRoot = await tempRoot.createWorkspace();

    const copy = await copyPipelineFormula({ root: emptyRoot, projectDir: project });

    assert.equal(copy.action, "source-missing");
    assert.equal(copy.path, null);
    assert.match(copy.message, /per-stage path/);
  });
});

describe("the shipped pipeline formula", () => {
  /** @returns {Promise<{ formula: string, pour?: boolean, type?: string, steps: Array<Record<string, unknown>> }>} */
  async function readFormula() {
    return JSON.parse(await readFile(join(REPO_ROOT, PIPELINE_FORMULA_SOURCE), "utf-8"));
  }

  /** @returns {Promise<{ stages: Array<{ id: string, title: string, description: string, dependsOn: string[], labels?: string[] }> }>} */
  async function readPipeline() {
    return JSON.parse(await readFile(join(REPO_ROOT, "skills", "planning", "create-task", "pipeline.json"), "utf-8"));
  }

  it("names itself with the filename the installers write", async () => {
    const formula = await readFormula();

    assert.equal(formula.formula, PIPELINE_FORMULA_ID);
    assert.equal(PIPELINE_FORMULA_FILE, `${formula.formula}.formula.json`);
  });

  it("pours, so every step becomes a child issue instead of an inline step", async () => {
    const formula = await readFormula();

    assert.equal(formula.pour, true);
    assert.equal(formula.type, "workflow");
  });

  it("declares every stage in pipeline.json, with its title, text, labels and stage-to-stage edges", async () => {
    const formula = await readFormula();
    const pipeline = await readPipeline();

    assert.deepEqual(
      formula.steps.map((step) => step.id),
      pipeline.stages.map((stage) => stage.id),
      "the formula and pipeline.json list different stages",
    );

    for (const stage of pipeline.stages) {
      const step = formula.steps.find((candidate) => candidate.id === stage.id);
      assert.ok(step, `the formula has no step for stage ${stage.id}`);
      assert.equal(step.title, `[{{feature}}] ${stage.title}`);
      assert.equal(step.description, stage.description, `${stage.id} text drifted from pipeline.json`);
      assert.deepEqual(step.labels, [`stage:${stage.id}`, ...(stage.labels ?? [])]);
      // The PR gate does not exist at pour time, so create-chores.mjs wires that
      // edge after it creates the gate. Every other edge belongs in the formula.
      assert.deepEqual(step.depends_on ?? [], stage.dependsOn.filter((dep) => dep !== "featurePrReview"));
    }
  });

  it("declares the feature variable the script substitutes", async () => {
    const formula = await readFormula();

    assert.ok(formula.steps.every((step) => String(step.title).includes("{{feature}}")));
    assert.equal((await readFile(join(REPO_ROOT, PIPELINE_FORMULA_SOURCE), "utf-8")).includes('"required": true'), true);
  });
});
